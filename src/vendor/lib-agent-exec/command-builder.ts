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

function resolveWindowsCommand(cmd: string, cwd: string): string {
  if (process.platform !== 'win32') return cmd;
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd;
  
  const hasExt = ['.exe', '.cmd', '.bat', '.com', '.ps1'].some(ext => cmd.toLowerCase().endsWith(ext));
  const extsToCheck = hasExt ? [''] : ['.exe', '.cmd', '.bat', '.com', '.ps1'];

  let pathEnv = process.env.PATH;
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
  
  if (payload.type === 'command') {
    cmd = payload.command;
    args = [...(payload.args || [])];
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
  } else {
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
      if (ext === '.ps1') {
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
  }

  cmd = resolveWindowsCommand(cmd, cwd);

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

  const cmdBasename = path.basename(cmd).toLowerCase();
  const ctx: ExecutionContext = { cmdBasename, args, envOverrides, payload };

  // Apply Interceptors Pipeline
  systemInterceptor(ctx);
  gitInterceptor(ctx);
  dockerInterceptor(ctx);
  packageManagerInterceptor(ctx);
  cloudCliInterceptor(ctx);
  replTuiInterceptor(ctx);

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
    console.error(`\n   💡 AGENT HINT: Arguments wrapped in quotes were detected.`);
    console.error(`   Because 'shell: false' is used, quotes are NOT needed for spaces. Auto-healing by stripping wrapping quotes...`);
  }

  // Format arguments correctly for cmd.exe to prevent quote stripping and shell injection
  if (['cmd', 'cmd.exe'].includes(path.basename(cmd).toLowerCase()) && args[0]?.toLowerCase() === '/c') {
    const originalCmdAndArgs = args.slice(1);
    const commandLine = originalCmdAndArgs.map(arg => {
      if (/[ \t&|<>^"]/.test(arg)) {
        if (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2) return arg;
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
    if (isWinBatch) {
      console.error(`\n   💡 AGENT HINT: Intercepted Windows batch file execution. Routing through pwsh to prevent spawn failures and quote vulnerabilities.`);
      const escapedCmd = cmd.replace(/'/g, "''");
      const escapedArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(' ');
      const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}`;
      const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
      args = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded];
      cmd = 'pwsh.exe';
    }
  }

  return { cmd, args, tempScriptPath, envOverrides };
}
