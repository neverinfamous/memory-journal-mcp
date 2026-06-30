// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { match, P } from 'ts-pattern';
import { ExecPayload } from './schema.js';
import { 
  ExecutionContext, 
  gitInterceptor, 
  dockerInterceptor, 
  packageManagerInterceptor, 
  cloudCliInterceptor, 
  replTuiInterceptor, 
  systemInterceptor 
} from './interceptors/index.js';

export const customInterceptors: Array<(ctx: ExecutionContext) => void> = [];

function escapeUnixArg(arg: string, allowGlobs = false): string {
  if (allowGlobs && /^[a-zA-Z0-9_\-./:*?]+$/.test(arg)) {
    return arg;
  }
  if (!allowGlobs && /^[a-zA-Z0-9_\-./:]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function tokenizeArgs(str: string): string[] {
  const args: string[] = [];
  let currentArg = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escapeNext) {
      currentArg += char;
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      currentArg += char;
      escapeNext = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentArg += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentArg += char;
      continue;
    }
    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }
  if (currentArg.length > 0) {
    args.push(currentArg);
  }
  return args;
}

function resolveWindowsCommand(cmd: string, cwd: string, payloadEnv?: Record<string, string>): string {
  if (process.platform !== 'win32') return cmd;
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd;
  
  const hasExt = ['.exe', '.cmd', '.bat', '.com', '.ps1'].some(ext => cmd.toLowerCase().endsWith(ext));
  const extsToCheck = hasExt ? [''] : ['.exe', '.cmd', '.bat', '.com', '.ps1'];

  let pathEnv = payloadEnv?.PATH || payloadEnv?.path || process.env.PATH;
  if (!pathEnv && process.platform === 'win32') {
    for (const key of Object.keys(process.env)) {
      if (key.toUpperCase() === 'PATH') {
        pathEnv = process.env[key];
        break;
      }
    }
  }
  const paths = (pathEnv || '').split(path.delimiter);
  
  for (const p of paths) {
    if (!p) continue;
    for (const ext of extsToCheck) {
      const fullPath = path.join(p, cmd + ext);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return cmd;
}

export function buildCommand(payload: ExecPayload, cwd: string): { cmd: string; args: string[]; tempScriptPath: string | null; envOverrides: Record<string, string> } {
  let cmd: string;
  let args: string[];
  let tempScriptPath: string | null = null;
  const envOverrides: Record<string, string> = {};

  match({ platform: process.platform, target: payload.target })
    .with({ platform: 'win32', target: P.not('wsl2') }, () => {
      const hasPipeCommand = 'command' in payload && typeof payload.command === 'string' && (payload.command.includes(' && ') || payload.command.includes(' || ') || payload.command.includes(' | ') || payload.command.includes(' > '));
      const hasPipeArg = payload.args?.some(a => typeof a === 'string' && (a.trim() === '&&' || a.trim() === '||' || a.trim() === '|' || a.trim() === '>'));
      if (hasPipeCommand || hasPipeArg) {
        console.error(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.\x1b[0m`);
        process.exit(1);
      }
    })
    .otherwise(() => {});

  const replaceTemplates = (str: string) => {
    if (!('integrationContext' in payload) || !payload.integrationContext) return str;
    const contextStr = JSON.stringify(payload.integrationContext);
    return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
      if (!pathStr) return contextStr;
      let current: unknown = payload.integrationContext;
      const keys = pathStr.split('.');
      for (const key of keys) {
        if (current == null || typeof current !== 'object' || !(key in current)) return match;
        current = (current as Record<string, unknown>)[key];
      }
      return typeof current === 'object' ? JSON.stringify(current) : (typeof current === 'string' ? JSON.stringify(current).slice(1, -1) : String(current));
    });
  };

  if ('integrationContext' in payload && payload.integrationContext) {
    const contextStr = JSON.stringify(payload.integrationContext);
    if (contextStr.length > 32000) {
      console.error('❌ Error: integrationContext stringified size exceeds 32KB limit on Windows.');
      process.exit(1);
    }
    // SEC-FIX: Removed integrationContext from envOverrides to prevent data boundary leak

    if (payload.args) {
      payload.args = payload.args.map(a => typeof a === 'string' ? replaceTemplates(a) : a);
    }
    if (payload.env) {
      const newEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.env)) {
        newEnv[k] = typeof v === 'string' ? replaceTemplates(v) : String(v);
      }
      payload.env = newEnv;
    }
    if ('command' in payload && typeof payload.command === 'string') {
      payload.command = replaceTemplates(payload.command);
    }
    if ('templateOverride' in payload && typeof payload.templateOverride === 'string') {
      payload.templateOverride = replaceTemplates(payload.templateOverride);
    }
    if ('scriptPath' in payload && typeof payload.scriptPath === 'string') {
      payload.scriptPath = replaceTemplates(payload.scriptPath);
    }
    if ('code' in payload && typeof payload.code === 'string') {
      payload.code = replaceTemplates(payload.code);
    }
    if ('webhookHeaders' in payload && payload.webhookHeaders) {
      const newHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.webhookHeaders)) {
        newHeaders[k] = typeof v === 'string' ? replaceTemplates(v) : String(v);
      }
      payload.webhookHeaders = newHeaders;
    }
  }

  if ('command' in payload && typeof payload.command === 'string') {
    const c = payload.command.trim();
    const doubleQuoteMatch = c.match(/^"([^"]+)"(?:\s+(.*))?$/);
    const singleQuoteMatch = c.match(/^'([^']+)'(?:\s+(.*))?$/);

    if (doubleQuoteMatch) {
      payload.command = doubleQuoteMatch[1];
      if (doubleQuoteMatch[2]) {
        payload.args = [...tokenizeArgs(doubleQuoteMatch[2]), ...(payload.args || [])];
      }
    } else if (singleQuoteMatch) {
      payload.command = singleQuoteMatch[1];
      if (singleQuoteMatch[2]) {
        payload.args = [...tokenizeArgs(singleQuoteMatch[2]), ...(payload.args || [])];
      }
    }
  }
  
  const parsedCmdArgs = match(payload)
    .with({ type: 'command' }, (p) => {
      let localCmd: string = p.command;
      let localArgs: string[] = [...(p.args || [])];

      const builtIns = ['echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
      const hasShellMeta = /[|&;<>$`{}()]/.test(p.command) || (p.args && p.args.some(a => /[|&;<>$`{}()]/.test(a)));

      if (builtIns.includes(p.command.toLowerCase()) || (p.target === 'wsl2' && hasShellMeta)) {
        console.error(`\n   💡 AGENT HINT: '${p.command}' is a shell built-in or contains shell metacharacters.`);
        console.error(`   🛠️ AUTONOMOUS HEALING: Automatically routing through system shell to prevent execution failure...`);
        
        if (process.platform === 'win32' && p.target !== 'wsl2') {
          // SEC-FIX: Route builtins through pwsh.exe instead of cmd.exe to prevent quote escaping injection vectors
          const escapedCmd = p.command.replace(/'/g, "''");
          const escapedArgs = (p.args || []).map(a => `'${a.replace(/'/g, "''")}'`).join(' ');
          const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Continue';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}\nexit $LASTEXITCODE`;
          const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
          localCmd = 'pwsh.exe';
          localArgs = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded];
        } else {
          const originalCmd = [
            /[|&;<>$`{}()]/.test(p.command) ? p.command : escapeUnixArg(p.command, false),
            ...(p.args || []).map(a => escapeUnixArg(a, false))
          ].join(' ');
          localCmd = 'sh';
          localArgs = ['-c', originalCmd];
        }
      }

      if ('templateOverride' in p && typeof p.templateOverride === 'string' && p.templateOverride) {
        const innerCmdStr = [p.command, ...(p.args || [])]
          .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)
          .join(' ');
        
        const fullOverride = p.templateOverride.includes('{{code}}') 
          ? p.templateOverride.replace('{{code}}', innerCmdStr)
          : `${p.templateOverride} ${innerCmdStr}`;
          
        const allArgs = tokenizeArgs(fullOverride).map(a => replaceTemplates(a));
        if (allArgs.length > 0) {
          localCmd = allArgs[0];
          localArgs = allArgs.slice(1);
        }
      }
      return { cmd: localCmd, args: localArgs };
    })
    .with({ type: 'script' }, (p) => {
      let localCmd: string;
      let localArgs: string[];
      let scriptFile = path.resolve(p.scriptPath);
      if (!fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile()) {
        console.error(`❌ Error: The script file '${scriptFile}' does not exist or is not a file.`);
        process.exit(1);
      }
      if (p.interpreter) {
        localCmd = p.interpreter;
      } else {
        const ext = path.extname(scriptFile).toLowerCase();
        localCmd = match(ext)
          .with('.py', () => 'python')
          .with('.js', '.mjs', () => 'node')
          .with('.ts', () => 'bun')
          .with('.sh', () => 'bash')
          .with('.ps1', () => 'pwsh')
          .with('.bat', '.cmd', () => 'cmd.exe')
          .otherwise(() => 'bun');
      }
      const isPwsh = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(localCmd.toLowerCase());
      const isCmd = ['cmd', 'cmd.exe'].includes(localCmd.toLowerCase());
      
      // Auto-heal CRLF for bash scripts in WSL
      if (payload.target === 'wsl2' && ['bash', 'sh'].includes(localCmd.toLowerCase())) {
        const content = fs.readFileSync(scriptFile, 'utf-8');
        if (content.includes('\r\n')) {
          tempScriptPath = path.join(os.tmpdir(), `agent-exec-wsl-${crypto.randomUUID()}.sh`);
          fs.writeFileSync(tempScriptPath, content.replace(/\r\n/g, '\n'), 'utf-8');
          scriptFile = tempScriptPath;
        }
      }
      if (isPwsh) {
        localArgs = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      } else if (isCmd) {
        localArgs = ['/c', scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      } else {
        localArgs = [scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      }

      if ('templateOverride' in p && typeof p.templateOverride === 'string' && p.templateOverride) {
        const innerCmdStr = [localCmd, ...localArgs]
          .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)
          .join(' ');
        
        const fullOverride = p.templateOverride.includes('{{code}}') 
          ? p.templateOverride.replace('{{code}}', innerCmdStr)
          : `${p.templateOverride} ${innerCmdStr}`;
          
        const allArgs = tokenizeArgs(fullOverride).map(a => replaceTemplates(a));
        if (allArgs.length > 0) {
          localCmd = allArgs[0];
          localArgs = allArgs.slice(1);
        }
      }
      return { cmd: localCmd, args: localArgs };
    })
    .with({ type: 'eval' }, (p) => {
      const uniqueId = crypto.randomUUID();
      const scratchDir = path.join(os.tmpdir(), 'agent-exec-scratch');
      if (!fs.existsSync(scratchDir)) {
        fs.mkdirSync(scratchDir, { recursive: true });
      }
      let ext = p.target === 'wsl2' ? '.sh' : '.ts';
      if (p.interpreter) {
        const interp = p.interpreter.toLowerCase();
        ext = match(interp)
          .when(i => i.includes('python'), () => '.py')
          .when(i => i.includes('pwsh') || i.includes('powershell'), () => '.ps1')
          .when(i => i.includes('bash') || i.includes('sh') || i.includes('zsh'), () => '.sh')
          .when(i => i.includes('cmd') || i.includes('bat'), () => '.bat')
          .when(i => i.includes('node'), () => '.js')
          .otherwise(() => ext);
      }
      tempScriptPath = path.join(scratchDir, `agent-eval-${uniqueId}${ext}`);
      try {
        let codeToExecute = p.code;
        if ('templateOverride' in p && p.templateOverride) {
          if (p.templateOverride.includes('{{code}}')) {
            codeToExecute = p.templateOverride.replace('{{code}}', p.code);
          } else {
            codeToExecute = `${p.templateOverride}\n${p.code}`;
          }
        }
        if (ext === '.ps1') {
          codeToExecute = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
        }
        fs.writeFileSync(tempScriptPath, codeToExecute, 'utf-8');
      } catch (err) {
        console.error(`❌ Error: Failed to write eval code to temporary file ${tempScriptPath}`);
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      const localCmd = p.interpreter || (p.target === 'wsl2' ? 'bash' : 'bun');
      const localArgs = match(localCmd.toLowerCase())
        .when(cmd => ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmd), () => [
          '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ])
        .when(cmd => ['cmd', 'cmd.exe'].includes(cmd), () => [
          '/c', tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ])
        .when(cmd => process.platform === 'win32' && ['bash', 'sh', 'zsh'].includes(cmd), () => {
          const wslPath = tempScriptPath!.replace(/\\/g, '/').replace(/^([a-zA-Z]):\//, (m, drive) => `/mnt/${drive.toLowerCase()}/`);
          return [wslPath, ...(p.args || [])];
        })
        .otherwise(() => [
          tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ]);

      return { cmd: localCmd, args: localArgs };
    })
    .exhaustive();

  cmd = parsedCmdArgs.cmd;
  args = parsedCmdArgs.args;

  if (payload.target !== 'wsl2') {
    cmd = resolveWindowsCommand(cmd, cwd, payload.env as Record<string, string>);
  }

  envOverrides['NPM_CONFIG_YES'] = 'true'; // Automatically answer yes to npx/pnpx install prompts
  envOverrides['DEBIAN_FRONTEND'] = 'noninteractive'; // Prevent apt prompts
  envOverrides['YARN_NON_INTERACTIVE'] = '1'; // Prevent yarn interactive prompts
  envOverrides['GIT_TERMINAL_PROMPT'] = '0'; // Prevent credential/passphrase prompt hanging globally
  envOverrides['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'; // Prevent SSH prompt hanging globally
  envOverrides['GIT_EDITOR'] = 'true'; // Prevent git from hanging when it opens an editor
  envOverrides['GIT_SEQUENCE_EDITOR'] = 'true'; // Prevent git rebase from hanging
  envOverrides['GCM_INTERACTIVE'] = 'false'; // Prevent Git Credential Manager GUI from hanging on Windows
  envOverrides['DENO_NO_PROMPT'] = '1'; // Prevent deno prompt hanging globally
  envOverrides['HOMEBREW_NO_INTERACTIVE'] = '1'; // Prevent brew interactive prompts globally
  envOverrides['PAGER'] = 'cat'; // Prevent any CLI tool from spawning an interactive pager
  envOverrides['GIT_PAGER'] = 'cat'; // Prevent git from spawning an interactive pager
  envOverrides['CI'] = '1'; // Instruct compliant CLI tools to run in non-interactive/headless mode
  envOverrides['npm_config_audit'] = 'false'; // Prevent npm audit noise/prompts
  envOverrides['npm_config_fund'] = 'false'; // Prevent npm fund noise/prompts

  if (cmd === 'find' || cmd === 'find.exe') {
    const isUnixFind = args.some(a => a.startsWith('-name') || a.startsWith('-type') || a.startsWith('-exec') || a.startsWith('-mtime') || a === '.' || a === '..');
    if (isUnixFind) {
       const originalArgs = args.map(a => escapeUnixArg(a, false)).join(' ');
       console.error(`\n   💡 AGENT HINT: Detected Unix-style 'find' command. Forwarding to 'sh -c' to bypass Windows find.exe limits.`);
       cmd = 'sh';
       args = ['-c', `find ${originalArgs}`];
    }
  }

  // Handle glob expansion for Unix utilities running on Windows without a shell
  const cmdBasenameForGlob = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const unixUtilsForGlob = ['grep', 'ls', 'rm', 'cp', 'mv', 'cat', 'rg'];
  if (unixUtilsForGlob.includes(cmdBasenameForGlob)) {
    const hasGlobs = args.some(a => (a.includes('*') || a.includes('?')) && !a.startsWith('-'));
    if (hasGlobs) {
       const originalArgs = args.map(a => escapeUnixArg(a, true)).join(' ');
       console.error(`\n   💡 AGENT HINT: Detected Unix utility '${cmdBasenameForGlob}' with glob patterns (* or ?).`);
       console.error(`   🛠️ AUTONOMOUS HEALING: Because 'shell: false' is used, globs are not expanded automatically. Routing through 'sh -c' to expand globs...`);
       cmd = 'sh';
       args = ['-c', `${cmdBasenameForGlob} ${originalArgs}`];
    }
  }

  // integrationContext processed at the start of buildCommand

  const cmdBasename = path.basename(cmd).toLowerCase();
  const ctx: ExecutionContext = { cmdBasename, args, envOverrides, payload };

  // Apply Interceptors Pipeline
  if (!payload.bypassInterceptors) {
    systemInterceptor(ctx);
    gitInterceptor(ctx);
    dockerInterceptor(ctx);
    packageManagerInterceptor(ctx);
    cloudCliInterceptor(ctx);
    replTuiInterceptor(ctx);
    for (const interceptor of customInterceptors) {
      interceptor(ctx);
    }
  }

  // Sync back args and cmd references if modified completely
  if (ctx.cmdBasename !== path.basename(cmd).toLowerCase()) { cmd = ctx.cmdBasename; }
  args = ctx.args;

  let strippedQuotes = false;
  args = args.map(arg => {
    if (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2 && !arg.slice(1, -1).includes('"')) {
      strippedQuotes = true;
      return arg.slice(1, -1);
    }
    if (arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2 && !arg.slice(1, -1).includes("'")) {
      strippedQuotes = true;
      return arg.slice(1, -1);
    }
    return arg;
  });

  if (strippedQuotes) {
    console.error(`\n   💡 AGENT HINT: Arguments wrapped in quotes were detected.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'shell: false' is used, quotes are NOT needed for spaces. Auto-healing by stripping wrapping quotes...`);
  }

  // Format arguments correctly for cmd.exe to prevent quote stripping and shell injection
  if (['cmd', 'cmd.exe'].includes(path.basename(cmd).toLowerCase()) && args[0]?.toLowerCase() === '/c') {
    const originalCmdAndArgs = args.slice(1);
    
    // Algorithm:
    // 1. Format each argument for C runtime (CommandLineToArgvW).
    // 2. Escape cmd.exe metacharacters (^ & | < >) that fall OUTSIDE of cmd.exe's quote state.
    const commandLine = originalCmdAndArgs.map(arg => {
      // Step 1: C runtime escaping
      let crtArg = arg;
      if (/[ \t\n\v"]/.test(arg) || arg.length === 0) {
        // Escape backslashes that precede a quote
        crtArg = arg.replace(/(\\+)(")/g, '$1$1$2');
        // Escape quotes
        crtArg = crtArg.replace(/"/g, '\\"');
        // Wrap in quotes
        crtArg = `"${crtArg}"`;
      }
      
      // Step 2: cmd.exe escaping
      let cmdArg = '';
      let inQuotes = false;
      for (let i = 0; i < crtArg.length; i++) {
        const char = crtArg[i];
        if (char === '"') {
          inQuotes = !inQuotes;
          cmdArg += char;
        } else if (!inQuotes && /[&|<>^]/.test(char)) {
          cmdArg += '^' + char;
        } else {
          cmdArg += char;
        }
      }
      // Note: % environment variables are not escaped by ^ in cmd.exe. 
      // We assume payload arguments do not intentionally contain %VAR% unless meant to be expanded,
      // which is standard behavior.
      
      return cmdArg;
    }).join(' ');
    
    // Pass the entire command line wrapped in quotes, with /s to strip them.
    args = ['/d', '/s', '/c', `"${commandLine}"`];
  }

  if (payload.type === 'command') {
    const isWinBatch = cmd.toLowerCase().endsWith('.bat') || cmd.toLowerCase().endsWith('.cmd');
    if (isWinBatch && payload.target !== 'wsl2') {
      console.error(`\n   💡 AGENT HINT: Intercepted Windows batch file execution. Routing through pwsh to prevent spawn failures and quote vulnerabilities.`);
      const escapedCmd = cmd.replace(/'/g, "''");
      const escapedArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(' ');
      const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Continue';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}\nexit $LASTEXITCODE`;
      const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
      args = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded];
      cmd = 'pwsh.exe';
    }
  }

  if (payload.target === 'wsl2') {
    const convertToWslPath = (winPath: string) => {
      // 1. Pure path (e.g. C:\path\to\file.txt)
      if (/^[a-zA-Z]:[/\\]/.test(winPath)) {
        return winPath.replace(/^([a-zA-Z]):[/\\](.*)/, (match, drive, rest) => {
          return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
        });
      }
      
      // 2. Flag with unquoted path (e.g. --file=C:\path\to\file.txt)
      if (/^[a-zA-Z0-9_-]+[=:][a-zA-Z]:[/\\]/.test(winPath)) {
        return winPath.replace(/^([a-zA-Z0-9_-]+[=:])([a-zA-Z]):[/\\](.*)/, (match, prefix, drive, rest) => {
           return `${prefix}/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
        });
      }

      // 3. Flag with double-quoted path (e.g. --file="C:\path")
      if (/^[a-zA-Z0-9_-]+[=:]"([a-zA-Z]):[/\\](.*)"$/.test(winPath)) {
        return winPath.replace(/^([a-zA-Z0-9_-]+[=:])"([a-zA-Z]):[/\\](.*)"$/, (match, prefix, drive, rest) => {
           return `${prefix}"/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}"`;
        });
      }
      
      // 4. Flag with single-quoted path (e.g. --file='C:\path')
      if (/^[a-zA-Z0-9_-]+[=:]'([a-zA-Z]):[/\\](.*)'$/.test(winPath)) {
        return winPath.replace(/^([a-zA-Z0-9_-]+[=:])'([a-zA-Z]):[/\\](.*)'$/, (match, prefix, drive, rest) => {
           return `${prefix}'/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}'`;
        });
      }

      // 5. Fallback for embedded paths (e.g. regex ^C:\path). 
      // Stop at spaces to avoid corrupting trailing regex characters.
      return winPath.replace(/([a-zA-Z]):[/\\]([^"';=,\s]*)/g, (match, drive, rest) => {
        return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
      });
    };

    const wslCwd = convertToWslPath(cwd);
    
    const wslEnvArgs: string[] = [];
    const wslUuid = crypto.randomUUID();
    wslEnvArgs.push(`AGENT_EXEC_WSL_UUID=${wslUuid}`);
    const payloadEnv = payload.env || {};
    for (const [k, v] of Object.entries(payloadEnv)) {
      if (v !== undefined) {
        wslEnvArgs.push(`${k}=${convertToWslPath(String(v))}`);
      }
    }
    for (const [k, v] of Object.entries(envOverrides)) {
      wslEnvArgs.push(`${k}=${convertToWslPath(v)}`);
    }

    const wslArgs = args.map(arg => {
      if (/[a-zA-Z]:[/\\]/.test(arg)) {
        return convertToWslPath(arg);
      }
      return arg;
    });

    let wslCmd = cmd;
    if (/[a-zA-Z]:[/\\]/.test(wslCmd)) {
      wslCmd = convertToWslPath(wslCmd);
    } else if (wslCmd === 'python') {
      wslCmd = 'python3';
    }

    // Auto-heal CRLF boundary issues for text-processing tools reading Windows files
    if (wslCmd === 'diff' || wslCmd === 'diff.exe') {
      if (!wslArgs.includes('--strip-trailing-cr')) {
        wslArgs.unshift('--strip-trailing-cr');
      }
    } else if (['grep', 'grep.exe', 'egrep', 'fgrep'].includes(wslCmd)) {
      const nonFlagIdx = wslArgs.findIndex(a => !a.startsWith('-'));
      if (nonFlagIdx !== -1) {
        if (!wslArgs.includes('-E') && !wslArgs.includes('-P')) {
          wslArgs.unshift('-P');
          const newNonFlagIdx = wslArgs.findIndex(a => !a.startsWith('-'));
          wslArgs[newNonFlagIdx] = wslArgs[newNonFlagIdx].replace(/\$$/, '\\r?$');
        } else {
          wslArgs[nonFlagIdx] = wslArgs[nonFlagIdx].replace(/\$$/, '\\r?$');
        }
      }
    }

    args = ['--cd', wslCwd, '-e', 'env', ...wslEnvArgs, wslCmd, ...wslArgs];
    cmd = 'wsl.exe';
  }

  return { cmd, args, tempScriptPath, envOverrides };
}
