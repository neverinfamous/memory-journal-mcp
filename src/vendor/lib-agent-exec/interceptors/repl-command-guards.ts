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
import { AGENT_EXEC_README_URL, hasTailFollowFlag } from './utils.js';

const REPL_COMMAND_SET: ReadonlySet<string> = new Set(REPL_COMMANDS);
const TUI_COMMAND_SET: ReadonlySet<string> = new Set(TUI_COMMANDS);
const SSH_CLIENT_SET: ReadonlySet<string> = new Set(['ssh', 'ssh.exe', 'sftp', 'sftp.exe']);

function blockExecution(hint: string, details: readonly string[] = []): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  for (const line of details) console.error(`   ${line}`);
  process.exit(1);
}

const DB_CLIENTS: ReadonlySet<string> = new Set([
  'mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe',
  'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe',
]);
const SSH_TELNET_CLIENTS: ReadonlySet<string> = new Set(['ssh', 'ssh.exe', 'sftp', 'sftp.exe', 'ftp', 'ftp.exe', 'telnet', 'telnet.exe']);
const NON_V_DB_CLIENTS: ReadonlySet<string> = new Set([
  'mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe',
  'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe',
]);
const HELP_VER_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...NODE_VALUE_FLAGS, ...SSH_VALUE_FLAGS, ...REDIS_OPTION_WITH_ARG,
  '-c', '--command', '-e', '--eval', '--execute', '-f', '--file', '-p', '--port',
  '-u', '--user', '-U', '-d', '--dbname', '-D', '--database', '--host',
]);

function isHelpOrVersion(cmdBasename: string, args: readonly string[]): boolean {
  const lowerCmd = cmdBasename.toLowerCase();
  const isDb = DB_CLIENTS.has(lowerCmd);
  const vMeansVersion = !['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'].includes(lowerCmd)
    && !SSH_TELNET_CLIENTS.has(lowerCmd)
    && !NON_V_DB_CLIENTS.has(lowerCmd);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    const lower = arg.toLowerCase();
    if (['--version', '-version', '--help', '-help', '-?', '/?'].includes(lower) || ['-V', '-VV'].includes(arg)) return true;
    if (arg === '-h' && !isDb) return true;
    if (lower === '-v' && vMeansVersion) return true;
    if (HELP_VER_VALUE_FLAGS.has(arg) || (isDb && arg === '-h') || ((lowerCmd === 'psql' || lowerCmd === 'psql.exe') && arg === '-v')) i++;
  }
  return false;
}

const SQLITE_VALUE_FLAGS = new Set(['-separator', '-nullvalue', '-newline', '-init', '-cmd']);

function matchesFlagWithOptionalEqOrPrefix(arg: string, exactFlags: readonly string[], allowShortPrefix = false): boolean {
  for (const flag of exactFlags) {
    if (arg === flag || arg.startsWith(`${flag}=`)) return true;
    if (allowShortPrefix && flag.length === 2 && flag.startsWith('-') && !flag.startsWith('--') && arg.startsWith(flag) && arg.length > 2) {
      return true;
    }
  }
  return false;
}

function countSqlitePositionals(args: readonly string[]): number {
  let count = 0;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && a.startsWith('-')) {
      if (SQLITE_VALUE_FLAGS.has(a)) i++;
      continue;
    }
    count++;
  }
  return count;
}

function isDbNonInteractive(cmd: string, args: readonly string[]): boolean {
  const base = cmd.replace(/\.exe$/, '');
  if (base === 'sqlite3' || base === 'sqlite') {
    if (args.some(arg => matchesFlagWithOptionalEqOrPrefix(arg, ['-cmd', '-batch', '--batch'], false))) return true;
    return countSqlitePositionals(args) >= 2;
  }
  if (base === 'psql') {
    return args.some(arg => matchesFlagWithOptionalEqOrPrefix(arg, ['-c', '--command', '-f', '--file'], true));
  }
  if (base === 'mysql') {
    return args.some(arg => matchesFlagWithOptionalEqOrPrefix(arg, ['-e', '--execute'], true));
  }
  if (base === 'mongo' || base === 'mongosh') {
    return args.some(arg => matchesFlagWithOptionalEqOrPrefix(arg, ['--eval', '-f', '--file'], false));
  }
  if (base === 'redis-cli') {
    if (args.some(arg => matchesFlagWithOptionalEqOrPrefix(arg, ['--eval'], false))) return true;
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') return false;
    if (arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print') return false;
    if (
      arg === '--inspect' || arg.startsWith('--inspect=') ||
      arg === '--inspect-brk' || arg.startsWith('--inspect-brk=') ||
      arg === '--inspect-wait' || arg.startsWith('--inspect-wait=')
    ) return true;
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

const SKIP_INTERACTIVE_STRIP_SET: ReadonlySet<string> = new Set([
  ...SSH_CLIENT_SET, 'perl', 'perl.exe', 'perl.cmd', 'redis-cli', 'redis-cli.exe',
]);
const INTERP_VALUE_FLAGS_STRIP: ReadonlySet<string> = new Set([
  ...NODE_VALUE_FLAGS, '-W', '-X',
]);

function stripNonSshInteractiveFlags(cmdBasename: string, args: string[]): void {
  const lower = cmdBasename.toLowerCase();
  if (SKIP_INTERACTIVE_STRIP_SET.has(lower)) return;
  const usesPosixShortFlags = !['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'].includes(lower);
  const isInteractiveTarget = ['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(lower);

  let stripped = false;
  const newArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--' || ['-c', '-e', '-m', '--command', '--eval'].includes(arg.toLowerCase()) || !arg.startsWith('-')) {
      newArgs.push(...args.slice(i));
      break;
    }
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
    if (!arg.startsWith('-') || !INTERP_VALUE_FLAGS_STRIP.has(arg) || i + 1 >= args.length) continue;
    const valArg = args[i + 1];
    if (valArg !== undefined) newArgs.push(valArg);
    i++;
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
    .with({ lower: P.union('cmd', 'cmd.exe'), args: P.when(a => !helpOrVer && a.some(arg => arg.toLowerCase() === '/k')) }, () => 'with interactive /k switch')
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
  if (['tail', 'tail.exe'].includes(lower) && hasTailFollowFlag(args)) {
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

  let cIndex = -1;
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    if (low === '--' || low === '-file' || low === '-f' || low === '-encodedcommand' || low === '-ec' || low === '-en') break;
    if (low === '-c' || low === '-command') { cIndex = i; break; }
  }
  if (cIndex !== -1 && cIndex + 1 < args.length) {
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
    payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Intercepted inline PowerShell command. Converting to Base64 -EncodedCommand to prevent quote parsing failures... (Frictionless Recovery)`);
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
