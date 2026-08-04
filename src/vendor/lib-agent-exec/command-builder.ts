import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { match } from 'ts-pattern';
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
import { replaceIntegrationContext, BUILT_INS, recordAgentIssue } from './utils.js';
import { DEFAULT_ENV_VARS } from './environment.js';


export const isPwsh = (cmd: string) => ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmd.toLowerCase());
export const isCmd = (cmd: string) => ['cmd', 'cmd.exe'].includes(cmd.toLowerCase());

export function formatForCmdExe(args: string[]): string[] {
  if (args[0]?.toLowerCase() !== '/c') return args;
  const originalCmdAndArgs = args.slice(1);
  const commandLine = originalCmdAndArgs.map(arg => {
    let crtArg = arg;
    if (/[ \t\n\v"]/.test(arg) || arg.length === 0) {
      crtArg = arg.replace(/(\\+)(")/g, '$1$1$2');
      crtArg = crtArg.replace(/"/g, '\\"');
      crtArg = `"${crtArg}"`;
    }
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
    return cmdArg;
  }).join(' ');
  return ['/d', '/s', '/c', `"${commandLine}"`];
}

export function convertToWslPath(winPath: string): string {
  const transform = (p: string) => {
    return p.replace(/^([a-zA-Z]):[/\\](.*)/, (match, drive, rest) => `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`);
  };

  if (path.win32.isAbsolute(winPath)) {
    return transform(winPath);
  }

  const doubleQuoteMatch = winPath.match(/^"(.+)"$/);
  const singleQuoteMatch = winPath.match(/^'(.+)'$/);
  if (doubleQuoteMatch && path.win32.isAbsolute(doubleQuoteMatch[1])) {
    return `"${transform(doubleQuoteMatch[1])}"`;
  }
  if (singleQuoteMatch && path.win32.isAbsolute(singleQuoteMatch[1])) {
    return `'${transform(singleQuoteMatch[1])}'`;
  }

  const kvMatch = winPath.match(/^([a-zA-Z0-9_-]+[=:])(.+)$/);
  if (kvMatch) {
    const prefix = kvMatch[1];
    const value = kvMatch[2];
    
    const doubleQuoteMatchValue = value.match(/^"(.+)"$/);
    const singleQuoteMatchValue = value.match(/^'(.+)'$/);
    
    if (doubleQuoteMatchValue && path.win32.isAbsolute(doubleQuoteMatchValue[1])) {
      return `${prefix}"${transform(doubleQuoteMatchValue[1])}"`;
    }
    if (singleQuoteMatchValue && path.win32.isAbsolute(singleQuoteMatchValue[1])) {
      return `${prefix}'${transform(singleQuoteMatchValue[1])}'`;
    }
    if (path.win32.isAbsolute(value)) {
      return `${prefix}${transform(value)}`;
    }
    if (value.includes('\\')) {
      return `${prefix}${value.replace(/\\/g, '/')}`;
    }
  }

  if (!winPath.startsWith('-') && winPath.includes('\\')) {
    return winPath.replace(/\\/g, '/');
  }

  return winPath;
}

function buildPwshWrapper(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const escapedCmd = cmd.replace(/'/g, "''");
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(' ');
  const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Continue';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}\nexit $LASTEXITCODE`;
  const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
  return {
    cmd: 'pwsh.exe',
    args: ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded]
  };
}

function applyTemplateOverride(templateOverride: string, baseCmd: string, baseArgs: string[], replaceTemplates: (str: string) => string): { cmd: string; args: string[] } {
  const innerCmdStr = [baseCmd, ...baseArgs]
    .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)
    .join(' ');
  
  const fullOverride = templateOverride.includes('{{code}}') 
    ? templateOverride.replace('{{code}}', innerCmdStr)
    : `${templateOverride} ${innerCmdStr}`;
    
  const allArgs = tokenizeArgs(fullOverride).map(a => replaceTemplates(a));
  return allArgs.length > 0 
    ? { cmd: allArgs[0], args: allArgs.slice(1) }
    : { cmd: baseCmd, args: baseArgs };
}

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

function sanitizeWslRegex(regexArg: string): string {
  let sanitized = regexArg;
  if (sanitized.startsWith('"') && sanitized.endsWith('"') && sanitized.length >= 2) {
    sanitized = sanitized.slice(1, -1);
  } else if (sanitized.startsWith("'") && sanitized.endsWith("'") && sanitized.length >= 2) {
    sanitized = sanitized.slice(1, -1);
  }
  return sanitized;
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

function resolveWindowsCommand(cmd: string, cwd: string, payloadEnv?: Record<string, string | undefined>): string {
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

export function buildCommand(payload: ExecPayload, cwd: string, isJson: boolean = false): { cmd: string; args: string[]; tempScriptPath: string | null; envOverrides: Record<string, string> } {
  const exitWithError = (message: string) => {
    recordAgentIssue('FATAL_EXECUTION_ERROR', message);
    if (isJson) {
      console.log(JSON.stringify({ status: "error", message }));
      process.exit(1);
    } else {
      console.error(`❌ Error: ${message}`);
      process.exit(1);
    }
  };

  let cmd: string;
  let args: string[];
  let tempScriptPath: string | null = null;
  const envOverrides: Record<string, string> = {};

  if (process.platform === 'win32' && payload.target !== 'wsl2') {
    const hasPipeCommand = payload.type === 'command' && (payload.command.includes(' && ') || payload.command.includes(' || ') || payload.command.includes(' | ') || payload.command.includes(' > '));
    const hasPipeArg = payload.args?.some(a => a.trim() === '&&' || a.trim() === '||' || a.trim() === '|' || a.trim() === '>');
    if (hasPipeCommand || hasPipeArg) {
      recordAgentIssue('POSIX_PIPES_IN_POWERSHELL', 'Native PowerShell does NOT support && or ||', { payload });
      if (isJson) {
        exitWithError(`Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.`);
      } else {
        console.error(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.\x1b[0m`);
        process.exit(1);
      }
    }
  }

  const replaceTemplates = (str: string) => replaceIntegrationContext(str, payload);

  if ('integrationContext' in payload && payload.integrationContext) {
    const contextStr = JSON.stringify(payload.integrationContext);
    const MAX_WINDOWS_ENV_SIZE = 32000;
    if (contextStr.length > MAX_WINDOWS_ENV_SIZE) {
      exitWithError(`integrationContext stringified size exceeds ${MAX_WINDOWS_ENV_SIZE} bytes limit on Windows.`);
    }
    // SEC-FIX: Removed integrationContext from envOverrides to prevent data boundary leak

    if (payload.args) {
      payload.args = payload.args.map(a => replaceTemplates(a));
    }
    if (payload.env) {
      const newEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.env)) {
        newEnv[k] = replaceTemplates(v);
      }
      payload.env = newEnv;
    }
    match(payload)
      .with({ type: 'command' }, (p) => {
        p.command = replaceTemplates(p.command);
      })
      .with({ type: 'script' }, (p) => {
        p.scriptPath = replaceTemplates(p.scriptPath);
      })
      .with({ type: 'eval' }, (p) => {
        p.code = replaceTemplates(p.code);
      })
      .exhaustive();

    if (payload.templateOverride) {
      payload.templateOverride = replaceTemplates(payload.templateOverride);
    }
    if (payload.webhookHeaders) {
      const newHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.webhookHeaders)) {
        newHeaders[k] = replaceTemplates(v);
      }
      payload.webhookHeaders = newHeaders;
    }
  }

  match(payload)
    .with({ type: 'command' }, (p) => {
      const c = p.command.trim();
      const doubleQuoteMatch = c.match(/^"([^"]+)"(?:\s+(.*))?$/);
      const singleQuoteMatch = c.match(/^'([^']+)'(?:\s+(.*))?$/);

      if (doubleQuoteMatch) {
        p.command = doubleQuoteMatch[1];
        if (doubleQuoteMatch[2]) {
          p.args = [...tokenizeArgs(doubleQuoteMatch[2]), ...(p.args || [])];
        }
      } else if (singleQuoteMatch) {
        p.command = singleQuoteMatch[1];
        if (singleQuoteMatch[2]) {
          p.args = [...tokenizeArgs(singleQuoteMatch[2]), ...(p.args || [])];
        }
      }
    })
    .with({ type: 'script' }, () => {})
    .with({ type: 'eval' }, () => {})
    .exhaustive();
  
  const parsedCmdArgs = match(payload)
    .with({ type: 'command' }, (p) => {
      let localCmd: string = p.command;
      let localArgs: string[] = [...(p.args || [])];

      if (p.target === 'wsl2') {
        localCmd = convertToWslPath(localCmd);
        
        let patternExprIdx = -1;
        if (['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'awk.exe', 'gawk', 'gawk.exe'].includes(localCmd.toLowerCase())) {
          patternExprIdx = localArgs.findIndex(a => !a.startsWith('-'));
        }

        localArgs = localArgs.map((a, idx) => {
          if (idx === patternExprIdx) return a;
          return convertToWslPath(a);
        });

        if (localCmd.toLowerCase() === 'diff' || localCmd.toLowerCase() === 'diff.exe') {
          if (!localArgs.includes('--strip-trailing-cr')) {
            localArgs.unshift('--strip-trailing-cr');
          }
        } else if (['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'].includes(localCmd.toLowerCase())) {
          const nonFlagIdx = localArgs.findIndex(a => !a.startsWith('-'));
          if (nonFlagIdx !== -1) {
            localArgs[nonFlagIdx] = sanitizeWslRegex(localArgs[nonFlagIdx]);
            if (localArgs[nonFlagIdx].endsWith('$')) {
              if (localArgs.includes('-E')) {
                localArgs[localArgs.indexOf('-E')] = '-P';
                localArgs[nonFlagIdx] = localArgs[nonFlagIdx].replace(/\$$/, '\\r?$');
              } else if (!localArgs.includes('-P')) {
                localArgs.unshift('-P');
                const newNonFlagIdx = localArgs.findIndex(a => !a.startsWith('-'));
                localArgs[newNonFlagIdx] = localArgs[newNonFlagIdx].replace(/\$$/, '\\r?$');
              } else {
                localArgs[nonFlagIdx] = localArgs[nonFlagIdx].replace(/\$$/, '\\r?$');
              }
            }
          }
        }
      }

      const hasShellMeta = /[|&;<>$`{}()]/.test(localCmd) || localCmd.includes(' ') || localArgs.some(a => /[|&;<>$`{}()]/.test(a));

      if (BUILT_INS.includes(localCmd.toLowerCase()) || (p.target === 'wsl2' && hasShellMeta)) {
        console.error(`\n   💡 AGENT HINT: '${localCmd}' is a shell built-in or contains shell metacharacters.`);
        console.error(`   🛠️ AUTONOMOUS HEALING: Automatically routing through system shell to prevent execution failure...`);
        
        if (process.platform === 'win32' && p.target !== 'wsl2') {
          // SEC-FIX: Route builtins through pwsh.exe instead of cmd.exe to prevent quote escaping injection vectors
          const wrapped = buildPwshWrapper(localCmd, localArgs);
          localCmd = wrapped.cmd;
          localArgs = wrapped.args;
        } else {
          const originalCmd = [
            /[|&;<>$`{}()]/.test(localCmd) ? localCmd : escapeUnixArg(localCmd, false),
            ...localArgs.map(a => escapeUnixArg(a, false))
          ].join(' ');
          localCmd = 'sh';
          localArgs = ['-c', originalCmd];
        }
      }

      if (p.templateOverride) {
        const updated = applyTemplateOverride(p.templateOverride, localCmd, localArgs, replaceTemplates);
        localCmd = updated.cmd;
        localArgs = updated.args;
      }
      return { cmd: localCmd, args: localArgs };
    })
    .with({ type: 'script' }, (p) => {
      let localCmd: string;
      let localArgs: string[];
      let scriptFile = path.resolve(cwd, p.scriptPath);
      if (!fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile()) {
        exitWithError(`The script file '${scriptFile}' does not exist or is not a file.`);
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
      // Auto-heal CRLF for bash scripts in WSL
      if (payload.target === 'wsl2' && ['bash', 'sh'].includes(localCmd.toLowerCase())) {
        const content = fs.readFileSync(scriptFile, 'utf-8');
        if (content.includes('\r\n')) {
          tempScriptPath = path.join(os.tmpdir(), `agent-exec-wsl-${crypto.randomUUID()}.sh`);
          fs.writeFileSync(tempScriptPath, content.replace(/\r\n/g, '\n'), 'utf-8');
          scriptFile = tempScriptPath;
        }
      }
      if (isPwsh(localCmd)) {
        localArgs = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      } else if (isCmd(localCmd)) {
        localArgs = ['/c', scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      } else {
        localArgs = [scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      }

      if (p.templateOverride) {
        const updated = applyTemplateOverride(p.templateOverride, localCmd, localArgs, replaceTemplates);
        localCmd = updated.cmd;
        localArgs = updated.args;
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
        if (p.templateOverride) {
          if (p.templateOverride.includes('{{code}}')) {
            codeToExecute = p.templateOverride.replace('{{code}}', p.code);
          } else {
            codeToExecute = `${p.templateOverride}\n${p.code}`;
          }
        }
        if (ext === '.ps1') {
          codeToExecute = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
        } else if (p.target === 'wsl2' && ext === '.sh') {
          codeToExecute = codeToExecute.replace(/\r\n/g, '\n');
        }
        fs.writeFileSync(tempScriptPath, codeToExecute, 'utf-8');
      } catch (err) {
        exitWithError(`Failed to write eval code to temporary file ${tempScriptPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const localCmd = p.interpreter || (p.target === 'wsl2' ? 'bash' : 'bun');
      const localArgs = match(localCmd)
        .when(isPwsh, () => [
          '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ])
        .when(isCmd, () => [
          '/c', tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ])
        .when(cmd => process.platform === 'win32' && ['bash', 'sh', 'zsh'].includes(cmd.toLowerCase()), () => {
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
    if (['bunx', 'bunx.cmd', 'bunx.exe'].includes(cmd.toLowerCase())) {
      cmd = 'bun';
      args = ['x', ...args];
    }
    cmd = resolveWindowsCommand(cmd, cwd, payload.env);
  }

  Object.assign(envOverrides, DEFAULT_ENV_VARS);

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
    recordAgentIssue('UNNECESSARY_QUOTES', 'Arguments wrapped in quotes were detected', { args: ctx.args });
    console.error(`\n   💡 AGENT HINT: Arguments wrapped in quotes were detected.`);
    console.error(`   Because 'shell: false' is used, quotes are NOT needed for spaces. Auto-healing by stripping wrapping quotes...`);
  }

  if (isCmd(path.basename(cmd)) && args[0]?.toLowerCase() === '/c') {
    args = formatForCmdExe(args);
  }

  if (payload.type === 'command') {
    const isWinBatch = cmd.toLowerCase().endsWith('.bat') || cmd.toLowerCase().endsWith('.cmd');
    if (isWinBatch && payload.target !== 'wsl2') {
      console.error(`\n   💡 AGENT HINT: Intercepted Windows batch file execution. Routing through pwsh to prevent spawn failures and quote vulnerabilities.`);
      const wrapped = buildPwshWrapper(cmd, args);
      cmd = wrapped.cmd;
      args = wrapped.args;
    }
  }

  if (payload.target === 'wsl2') {
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

    let patternExprIdx = -1;
    if (['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'awk.exe', 'gawk', 'gawk.exe'].includes(path.basename(cmd).toLowerCase())) {
      patternExprIdx = args.findIndex(a => !a.startsWith('-'));
    }

    const wslArgs = args.map((arg, idx) => {
      if (idx === patternExprIdx) return arg;
      return convertToWslPath(arg);
    });

    let wslCmd = cmd;
    if (/[a-zA-Z]:[/\\]/.test(wslCmd)) {
      wslCmd = convertToWslPath(wslCmd);
    } else if (wslCmd === 'python') {
      wslCmd = 'python3';
    }

    // Auto-heal CRLF boundary issues for text-processing tools reading Windows files handled earlier before sh -c wrapper

    args = ['--cd', wslCwd, '-e', 'env', ...wslEnvArgs, wslCmd, ...wslArgs];
    cmd = 'wsl.exe';
  }

  return { cmd, args, tempScriptPath, envOverrides };
}
