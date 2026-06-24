// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
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

function tokenizeArgs(str: string): string[] {
  const args: string[] = [];
  const regex = /("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s]+)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    args.push(match[1]);
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
  const paths = [cwd, ...(pathEnv || '').split(path.delimiter)];
  
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

  if ('integrationContext' in payload && payload.integrationContext) {
    const contextStr = JSON.stringify(payload.integrationContext);
    if (contextStr.length > 32000) {
      console.error('❌ Error: integrationContext stringified size exceeds 32KB limit on Windows.');
      process.exit(1);
    }
    envOverrides['integrationContext'] = contextStr;

    const replaceTemplates = (str: string) => {
      return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
        if (!pathStr) return contextStr;
        let current: unknown = payload.integrationContext;
        const keys = pathStr.split('.');
        for (const key of keys) {
          if (current == null || typeof current !== 'object') return match;
          current = (current as Record<string, unknown>)[key];
        }
        return typeof current === 'object' ? JSON.stringify(current) : String(current);
      });
    };

    if ('templateOverride' in payload && typeof payload.templateOverride === 'string' && payload.templateOverride) {
      payload.templateOverride = replaceTemplates(payload.templateOverride);
    }
    if (payload.args) {
      payload.args = payload.args.map(a => typeof a === 'string' ? replaceTemplates(a) : a);
    }
  }
  
  if (payload.type === 'command') {
    const builtIns = ['dir', 'echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
    if (builtIns.includes(payload.command.toLowerCase())) {
      console.error(`\n   💡 AGENT HINT: '${payload.command}' is a shell built-in, not an executable file.`);
      console.error(`   🛠️ AUTONOMOUS HEALING: Automatically routing through system shell (cmd.exe/sh) to prevent execution failure...`);
      
      const originalCmd = [payload.command, ...(payload.args || [])]
        .map(a => /[ \t&|<>^"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
        .join(' ');
        
      if (process.platform === 'win32' && payload.target !== 'wsl2') {
        payload.command = 'cmd.exe';
        payload.args = ['/d', '/s', '/c', `"${originalCmd}"`];
      } else {
        payload.command = 'sh';
        payload.args = ['-c', originalCmd];
      }
    }

    if ('templateOverride' in payload && typeof payload.templateOverride === 'string' && payload.templateOverride) {
      const innerCmdStr = [payload.command, ...(payload.args || [])]
        .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)
        .join(' ');
      
      const fullOverride = payload.templateOverride.includes('{{code}}') 
        ? payload.templateOverride.replace('{{code}}', innerCmdStr)
        : `${payload.templateOverride} ${innerCmdStr}`;
        
      const allArgs = tokenizeArgs(fullOverride);
      if (allArgs.length > 0) {
        cmd = allArgs[0];
        args = allArgs.slice(1);
      } else {
        cmd = payload.command;
        args = [...(payload.args || [])];
      }
    } else {
      cmd = payload.command;
      args = [...(payload.args || [])];
    }
  } else if (payload.type === 'script') {
    const scriptFile = path.resolve(payload.scriptPath);
    if (!fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile()) {
      console.error(`❌ Error: The script file '${scriptFile}' does not exist or is not a file.`);
      process.exit(1);
    }
    if (payload.interpreter) {
      cmd = payload.interpreter;
    } else {
      const ext = path.extname(scriptFile).toLowerCase();
      if (ext === '.py') cmd = 'python';
      else if (ext === '.js' || ext === '.mjs') cmd = 'node';
      else if (ext === '.ts') cmd = 'bun';
      else if (ext === '.sh') cmd = 'bash';
      else if (ext === '.ps1') cmd = 'pwsh';
      else if (ext === '.bat' || ext === '.cmd') cmd = 'cmd.exe';
      else cmd = 'bun';
    }
    const isPwsh = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmd.toLowerCase());
    const isCmd = ['cmd', 'cmd.exe'].includes(cmd.toLowerCase());
    if (isPwsh) {
      args = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', scriptFile.replace(/\\/g, '/'), ...(payload.args || [])];
    } else if (isCmd) {
      args = ['/c', scriptFile.replace(/\\/g, '/'), ...(payload.args || [])];
    } else {
      args = [scriptFile.replace(/\\/g, '/'), ...(payload.args || [])];
    }

    if ('templateOverride' in payload && typeof payload.templateOverride === 'string' && payload.templateOverride) {
      const innerCmdStr = [cmd, ...args]
        .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)
        .join(' ');
      
      const fullOverride = payload.templateOverride.includes('{{code}}') 
        ? payload.templateOverride.replace('{{code}}', innerCmdStr)
        : `${payload.templateOverride} ${innerCmdStr}`;
        
      const allArgs = tokenizeArgs(fullOverride);
      if (allArgs.length > 0) {
        cmd = allArgs[0];
        args = allArgs.slice(1);
      }
    }
  } else if (payload.type === 'eval') {
    // payload.type === 'eval'
    const uniqueId = crypto.randomUUID().split('-')[0];
    const scratchDir = path.join(os.tmpdir(), 'agent-exec-scratch');
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    let ext = '.ts';
    if (payload.interpreter) {
      const interp = payload.interpreter.toLowerCase();
      if (interp.includes('python')) ext = '.py';
      else if (interp.includes('pwsh') || interp.includes('powershell')) ext = '.ps1';
      else if (interp.includes('bash') || interp.includes('sh') || interp.includes('zsh')) ext = '.sh';
      else if (interp.includes('cmd') || interp.includes('bat')) ext = '.bat';
      else if (interp.includes('node')) ext = '.js';
    }
    tempScriptPath = path.join(scratchDir, `agent-eval-${uniqueId}${ext}`);
    try {
      let codeToExecute = payload.code;
      if (payload.type === 'eval' && 'templateOverride' in payload && payload.templateOverride) {
        if (payload.templateOverride.includes('{{code}}')) {
          codeToExecute = payload.templateOverride.replace('{{code}}', payload.code);
        } else {
          codeToExecute = `${payload.templateOverride}\n${payload.code}`;
        }
      } else if (ext === '.ps1') {
        codeToExecute = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
      }
      fs.writeFileSync(tempScriptPath, codeToExecute, 'utf-8');
    } catch (err) {
      console.error(`❌ Error: Failed to write eval code to temporary file ${tempScriptPath}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    cmd = payload.interpreter || 'bun';
    const isPwsh = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmd.toLowerCase());
    const isCmd = ['cmd', 'cmd.exe'].includes(cmd.toLowerCase());
    if (isPwsh) {
      args = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', tempScriptPath.replace(/\\/g, '/'), ...(payload.args || [])];
    } else if (isCmd) {
      args = ['/c', tempScriptPath.replace(/\\/g, '/'), ...(payload.args || [])];
    } else {
      args = [tempScriptPath.replace(/\\/g, '/'), ...(payload.args || [])];
    }
  } else {
    const p = payload as Record<string, unknown>;
    console.error(`❌ Error: Unsupported payload type '${String(p.type)}'.`);
    process.exit(1);
  }

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
       const originalArgs = args.map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ');
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
       const originalArgs = args.map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ');
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

  // Sync back args references if modified completely
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
    console.error(`\n   💡 AGENT HINT: Arguments wrapped in quotes were detected.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
    console.error(`   Because 'shell: false' is used, quotes are NOT needed for spaces. Auto-healing by stripping wrapping quotes...`);
  }

  // Format arguments correctly for cmd.exe to prevent quote stripping and shell injection
  if (['cmd', 'cmd.exe'].includes(path.basename(cmd).toLowerCase()) && args[0]?.toLowerCase() === '/c') {
    const originalCmdAndArgs = args.slice(1);
    const commandLine = originalCmdAndArgs.map(arg => {
      if (/[ \t&|<>^"]/.test(arg)) {
        // Properly escape inner double quotes by replacing " with \" so cmd.exe toggle state isn't confused,
        // while also wrapping the argument in quotes for cmd.exe.
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    }).join(' ');
    args = ['/d', '/s', '/c', `"${commandLine}"`];
  }

  if (payload.type === 'command') {
    const isWinBatch = cmd.toLowerCase().endsWith('.bat') || cmd.toLowerCase().endsWith('.cmd');
    if (isWinBatch && payload.target !== 'wsl2') {
      console.error(`\n   💡 AGENT HINT: Intercepted Windows batch file execution. Routing through pwsh to prevent spawn failures and quote vulnerabilities.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      const escapedCmd = cmd.replace(/'/g, "''");
      const escapedArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(' ');
      const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Continue';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}\nexit $LASTEXITCODE`;
      const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
      args = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded];
      cmd = 'pwsh.exe';
    }
  }

  if (payload.target === 'wsl2') {
    const convertToWslPath = (winPath: string): string => {
      if (!winPath) return winPath;
      let converted = winPath;
      if (/[a-zA-Z]:[/\\]/.test(winPath)) {
        converted = winPath.replace(/([a-zA-Z]):[/\\]([^"';=,\s]*)/g, (match, drive, rest) => {
          return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
        });
      }
      return converted.replace(/\\/g, '/');
    };

    const wslCwd = convertToWslPath(cwd);
    
    const wslEnvArgs: string[] = [];
    const wslUuid = crypto.randomUUID();
    wslEnvArgs.push(`AGENT_EXEC_WSL_UUID=${wslUuid}`);
    const payloadEnv = payload.env || {};
    for (const [k, v] of Object.entries(payloadEnv)) {
      wslEnvArgs.push(`${k}=${convertToWslPath(v as string)}`);
    }
    for (const [k, v] of Object.entries(envOverrides)) {
      wslEnvArgs.push(`${k}=${convertToWslPath(v)}`);
    }

    const wslArgs = args.map(arg => {
      if (/^[a-zA-Z]:[/\\]/.test(arg)) {
        return convertToWslPath(arg);
      }
      return arg;
    });

    let wslCmd = cmd;
    if (/^[a-zA-Z]:[/\\]/.test(wslCmd)) {
      wslCmd = convertToWslPath(wslCmd);
    } else if (wslCmd === 'python') {
      wslCmd = 'python3';
    }

    args = ['--cd', wslCwd, '-e', 'env', ...wslEnvArgs, wslCmd, ...wslArgs];
    cmd = 'wsl.exe';
  }

  return { cmd, args, tempScriptPath, envOverrides };
}
