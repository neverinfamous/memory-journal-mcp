// @ts-nocheck
import { escapePwshSingleQuoted } from '../command-utils.js';
import { match, P } from 'ts-pattern';
import {
  NODE_VALUE_FLAGS,
  PWSH_UI_CMDLETS,
  REDIS_OPTION_WITH_ARG,
  REPL_COMMANDS,
  SSH_VALUE_FLAGS,
  TUI_COMMANDS,
} from './repl-tui-constants.js';
import type { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';

const REPL_COMMAND_SET: ReadonlySet<string> = new Set(REPL_COMMANDS);
const TUI_COMMAND_SET: ReadonlySet<string> = new Set(TUI_COMMANDS);
const SSH_CLIENT_SET: ReadonlySet<string> = new Set(['ssh', 'ssh.exe', 'sftp', 'sftp.exe']);

function blockExecution(hint: string, details: readonly string[] = []): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  for (const line of details) console.error(`   ${line}`);
  process.exit(1);
}

function isHelpOrVersion(cmdBasename: string, args: readonly string[]): boolean {
  const lowerCmd = cmdBasename.toLowerCase();
  const vMeansVersion = !['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'].includes(lowerCmd);
  return args.some((arg) => {
    const lower = arg.toLowerCase();
    return ['--version', '-version', '--help', '-help', '-?', '/?'].includes(lower) ||
      ['-V', '-VV', '-h'].includes(arg) ||
      (lower === '-v' && vMeansVersion);
  });
}

function isDbNonInteractive(cmd: string, args: readonly string[]): boolean {
  if (args.some(arg => ['-c', '--command', '-e', '--execute', '--eval'].includes(arg))) return true;
  if (args.some(arg => arg === '-f' || arg === '--file' || arg.startsWith('--file='))) return true;
  if (['sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe'].includes(cmd)) {
    if (args.some(arg => arg === '-cmd' || arg === '-batch' || arg === '--batch')) return true;
    return args.filter(arg => !arg.startsWith('-')).length >= 2;
  }
  if (['redis-cli', 'redis-cli.exe'].includes(cmd)) {
    const nonOptionArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const curr = args[i];
      if (curr === undefined) continue;
      if (curr.startsWith('-')) {
        if (REDIS_OPTION_WITH_ARG.has(curr) && i + 1 < args.length) i++;
        continue;
      }
      nonOptionArgs.push(curr);
    }
    return nonOptionArgs.length > 0;
  }
  return false;
}

function hasNodeDebuggerArg(args: readonly string[]): boolean {
  if (args.some(arg => arg.startsWith('--inspect'))) return true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') return false;
    if (arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print') return false;
    if (arg.startsWith('-')) {
      if (NODE_VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    return arg === 'inspect';
  }
  return false;
}

function collectSshPositionals(args: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-')) {
      if (SSH_VALUE_FLAGS.has(arg) && i + 1 < args.length) i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

function stripNonSshInteractiveFlags(cmdBasename: string, args: string[]): void {
  const lower = cmdBasename.toLowerCase();
  if (SSH_CLIENT_SET.has(lower)) return;
  const usesPosixShortFlags = !['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'].includes(lower);
  const isInteractiveTarget = ['docker', 'docker.exe', 'podman', 'podman.exe', 'kubectl', 'kubectl.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(lower);

  let stripped = false;
  const newArgs: string[] = [];
  for (const arg of args) {
    if (arg === '-i' || arg === '--interactive' || (lower === 'php' && arg === '-a')) {
      stripped = true;
      continue;
    }
    if (isInteractiveTarget && usesPosixShortFlags && /^-([a-zA-Z]*[ti][a-zA-Z]*)$/.test(arg)) {
      const nextArg = arg.replace(/[ti]/g, '');
      if (nextArg !== '-') newArgs.push(nextArg);
      stripped = true;
      continue;
    }
    newArgs.push(arg);
  }
  if (stripped) {
    console.error(`\n   💡 AGENT HINT: Stripping interactive/TTY flags from ${cmdBasename} to prevent hanging... (Frictionless Recovery)`);
    args.length = 0;
    args.push(...newArgs);
  }
}

function getReplBlockReason(cmdBasename: string, args: readonly string[]): string | null {
  const lower = cmdBasename.toLowerCase();
  const helpOrVer = isHelpOrVersion(cmdBasename, args);
  return match({ lower, args })
    .with({ args: [] }, () => 'without arguments or stdin')
    .with({ lower: P.union('node', 'node.exe', 'node.cmd'), args: P.when(a => hasNodeDebuggerArg(a)) }, () => 'with a debugging flag')
    .with({ lower: P.union('mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe', 'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe'), args: P.when(a => !helpOrVer && !isDbNonInteractive(lower, a)) }, () => 'as a DB client without execution flags')
    .with({ lower: P.union('ssh', 'ssh.exe', 'sftp', 'sftp.exe'), args: P.when(a => !helpOrVer && collectSshPositionals(a).length < 2) }, () => 'as a naked shell/connection without commands')
    .with({ lower: P.union('ftp', 'ftp.exe', 'telnet', 'telnet.exe'), args: P.when(a => !helpOrVer && a.filter(arg => !arg.startsWith('-') && !arg.includes('@')).length === 0) }, () => 'as a naked shell/connection without commands')
    .with({ lower: P.union('node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('-')) && !a.some(arg => ['-e', '--eval', '--print', '-p'].includes(arg))) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('-')) && !a.some(arg => arg === '-c' || arg === '-m')) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('-')) && !a.some(arg => arg === '-c')) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('-')) && !a.some(arg => ['-c', '-command', '-file'].includes(arg.toLowerCase()))) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('-')) && !a.some(arg => arg === '-e' || arg === '-E')) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('php', 'php.exe'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('-')) && !a.some(arg => arg === '-r')) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('cmd', 'cmd.exe'), args: P.when(a => !helpOrVer && a.every(arg => arg.startsWith('/')) && !a.some(arg => arg.toLowerCase() === '/c')) }, () => 'with only flags and no script execution flags')
    .otherwise(() => null);
}

function checkPriorityWatchAndShellGuards(ctx: ExecutionContext): void {
  const { cmdBasename, args, envOverrides, payload } = ctx;
  const lower = cmdBasename.toLowerCase();

  if (['tsx', 'tsx.cmd', 'tsx.exe'].includes(lower) && args.includes('watch')) {
    blockExecution(`'tsx watch' runs indefinitely. Blocking execution.`);
  }
  if (['nodemon', 'nodemon.cmd', 'nodemon.exe', 'ts-node-dev', 'ts-node-dev.cmd', 'ts-node-dev.exe'].includes(lower)) {
    blockExecution(`'${cmdBasename}' runs indefinitely in watch mode. Blocking execution.`);
  }
  if (payload.type === 'command' && ['node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe', 'bunx', 'bunx.cmd', 'bunx.exe', 'yarn', 'yarn.cmd', 'yarn.exe'].includes(lower)) {
    const usedWatchTool = args.find(a => a === 'nodemon' || a === 'ts-node-dev');
    if (usedWatchTool) blockExecution(`'${usedWatchTool}' runs indefinitely in watch mode. Blocking execution to prevent hanging.`);
    if (args.includes('--watch')) blockExecution(`'${cmdBasename} --watch' runs indefinitely.`, ['Because \'agent-exec.ts\' is non-interactive, this will hang until timeout.', 'Please use standard execution without watch mode.']);
  }
  if (['bun', 'bun.exe', 'bun.cmd'].includes(lower) && args.includes('repl')) {
    blockExecution(`'bun repl' is interactive and will hang indefinitely. Blocking execution.`);
  }
  if (['cmd', 'cmd.exe'].includes(lower) && args.some(a => a.toLowerCase() === 'pause')) {
    blockExecution(`'pause' in cmd.exe waits for a keypress and will hang indefinitely. Blocking execution.`);
  }
  if (['pm2', 'pm2.cmd', 'pm2.exe'].includes(lower)) {
    const badSub = args.find(a => ['logs', 'monit', 'dash'].includes(a));
    if (badSub !== undefined) blockExecution(`'pm2 ${badSub}' is interactive/runs indefinitely. Blocking execution.`);
  }
  if (['watch', 'watch.exe'].includes(lower)) blockExecution(`'watch' runs indefinitely. Blocking execution.`);
  if (['tail', 'tail.exe'].includes(lower) && (args.includes('-f') || args.includes('--follow'))) {
    blockExecution(`'tail -f' runs indefinitely. Blocking execution.`);
  }
  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(lower)) {
    envOverrides['POWERSHELL_TELEMETRY_OPTOUT'] = '1';
    envOverrides['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1';
    if (args.some(a => a.toLowerCase() === '-noexit')) {
      blockExecution(`'pwsh -NoExit' prevents the shell from exiting and will hang indefinitely. Blocking execution.`);
    }
    if (args.some(a => PWSH_UI_CMDLETS.some(c => a.includes(c)))) {
      blockExecution(`PowerShell UI cmdlets like Get-Credential or Out-GridView will hang headlessly. Blocking execution.`);
    }
  }
}

export function guardDirectCommandMode(ctx: ExecutionContext): void {
  checkPriorityWatchAndShellGuards(ctx);
  const { cmdBasename, args, payload } = ctx;

  if (TUI_COMMAND_SET.has(cmdBasename)) {
    blockExecution(`You attempted to start an interactive TUI application (${cmdBasename}).`, [
      `Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`,
      `Please use standard terminal commands (e.g. cat, grep, list_dir, view_file) instead.`,
    ]);
  }
  if (payload.type !== 'command' || payload.stdin || !REPL_COMMAND_SET.has(cmdBasename)) return;

  stripNonSshInteractiveFlags(cmdBasename, args);
  const blockReason = getReplBlockReason(cmdBasename, args);
  if (blockReason !== null) {
    blockExecution(`You attempted to start an interactive REPL (${cmdBasename} ${blockReason}).`, [
      `Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`,
      `If you meant to execute code, use the 'eval' payload type, provide a script, or pass 'stdin'.`,
    ]);
  }
  if (['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(cmdBasename.toLowerCase())) {
    if (args.some((a, i) => a === '-m' && args[i + 1] === 'pdb')) {
      blockExecution(`You attempted to start Python with a debugger (-m pdb).`, [`Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`]);
    }
  }
}

export function encodeInlinePwshInvocation(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  if (payload.type !== 'command' || payload.target === 'wsl2') return;
  if (!['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmdBasename.toLowerCase())) return;

  const cIndex = args.findIndex(a => a.toLowerCase() === '-c' || a.toLowerCase() === '-command');
  if (cIndex !== -1 && cIndex + 1 < args.length) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Intercepted inline PowerShell command. Converting to Base64 -EncodedCommand to prevent quote parsing failures... (Frictionless Recovery)`);
    const scriptArgs = args.slice(cIndex + 1);
    const safeArgs = scriptArgs.map((a) => {
      if (!/[ \t]/.test(a)) return a;
      if ((a.startsWith("'") && a.endsWith("'")) || (a.startsWith('"') && a.endsWith('"'))) return a;
      if (a.startsWith('$(') || a.startsWith('@(')) return a;
      return `'${escapePwshSingleQuoted(a)}'`;
    });
    const scriptBody = scriptArgs.length === 1 ? (scriptArgs[0] ?? '') : safeArgs.join(' ');
    const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n` + scriptBody;
    const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
    args.splice(cIndex, args.length - cIndex, '-EncodedCommand', encoded);
  }

  const lowerArgs = args.map(a => a.toLowerCase());
  const newArgs: string[] = [];
  if (!lowerArgs.includes('-executionpolicy') && !lowerArgs.includes('-ep')) newArgs.push('-ExecutionPolicy', 'Bypass');
  if (!lowerArgs.includes('-noninteractive')) newArgs.push('-NonInteractive');
  if (!lowerArgs.includes('-noprofile')) newArgs.push('-NoProfile');
  if (newArgs.length > 0) {
    args.unshift(...newArgs);
    console.error(`\n   💡 AGENT HINT: Automatically injected [${newArgs.join(', ')}] into ${cmdBasename} command to prevent hanging.`);
  }
}
