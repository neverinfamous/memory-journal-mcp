// @ts-nocheck
import { escapePwshSingleQuoted } from '../command-utils.js';
import { match, P } from 'ts-pattern';
import {
  NODE_VALUE_FLAGS,
  PWSH_UI_REGEX,
  REDIS_OPTION_WITH_ARG,
  REPL_COMMANDS,
  SSH_VALUE_FLAGS,
  TUI_COMMANDS,
  collectSshPositionals,
  isDbNonInteractive,
} from './repl-tui-constants.js';
import { stripCommentAndQuoteSpansForShellScan } from './repl-script-scanner.js';
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
const DB_HELP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...REDIS_OPTION_WITH_ARG, '-separator', '-nullvalue', '-newline', '-init', '-cmd',
  '-h', '-p', '-P', '-u', '-U', '-d', '-D', '--dbname', '--database', '--user', '--password', '--host', '--port',
  '-c', '--command', '-e', '--execute', '-f', '--file',
]);
const NODE_HELP_VALUE_FLAGS: ReadonlySet<string> = new Set([...NODE_VALUE_FLAGS, '-e', '--eval', '-p', '--print']);
const PYTHON_HELP_VALUE_FLAGS: ReadonlySet<string> = new Set(['-c', '-m', '-W', '-X', '-Q']);
const SHELL_HELP_VALUE_FLAGS: ReadonlySet<string> = new Set(['-c', '-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const PWSH_HELP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-command', '-c', '-file', '-f',
  '-encodedcommand', '-ec', '-en', '-configurationname', '-settingsfile', '-custompipename',
]);
const OTHER_REPL_HELP_VALUE_FLAGS: ReadonlySet<string> = new Set(['-e', '-E', '-r', '-I', '-C', '-F', '-c', '--command', '--eval', '-f', '--file']);

function resolveHelpValueFlags(lowerCmd: string): ReadonlySet<string> {
  if (DB_CLIENTS.has(lowerCmd)) return DB_HELP_VALUE_FLAGS;
  if (SSH_TELNET_CLIENTS.has(lowerCmd)) return SSH_VALUE_FLAGS;
  if (['node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe', 'tsx', 'tsx.exe', 'tsx.cmd', 'ts-node'].includes(lowerCmd)) {
    return NODE_HELP_VALUE_FLAGS;
  }
  if (['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(lowerCmd)) return PYTHON_HELP_VALUE_FLAGS;
  if (['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'].includes(lowerCmd)) return SHELL_HELP_VALUE_FLAGS;
  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(lowerCmd)) return PWSH_HELP_VALUE_FLAGS;
  return OTHER_REPL_HELP_VALUE_FLAGS;
}

function isShellOptionWithArg(lowerCmd: string, arg: string): boolean {
  return ['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'].includes(lowerCmd) && /^[-+][a-zA-Z]*[oO]$/.test(arg);
}

function isHelpOrVersion(cmdBasename: string, args: readonly string[]): boolean {
  const lowerCmd = cmdBasename.toLowerCase();
  const isDb = DB_CLIENTS.has(lowerCmd);
  const isPwshCmd = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(lowerCmd);
  const valueFlags = resolveHelpValueFlags(lowerCmd);
  const vMeansVersion = !['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'].includes(lowerCmd)
    && !SSH_TELNET_CLIENTS.has(lowerCmd)
    && !NON_V_DB_CLIENTS.has(lowerCmd);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    const lower = arg.toLowerCase();
    if (isPwshCmd && lower === '-version' && /^\d+(?:\.\d+)*$/.test(args[i + 1] ?? '')) { i++; continue; }
    if (['--version', '-version', '--help', '-help', '-?', '/?'].includes(lower) || ['-V', '-VV'].includes(arg)) return true;
    if (arg === '-h' && !isDb) return true;
    if (lower === '-v' && vMeansVersion) return true;
    const checkArg = isPwshCmd ? lower : arg;
    if (valueFlags.has(checkArg) || isShellOptionWithArg(lowerCmd, arg) || (isDb && arg === '-h') || ((lowerCmd === 'psql' || lowerCmd === 'psql.exe') && arg === '-v')) i++;
  }
  return false;
}

function hasNodeDebuggerArg(args: readonly string[], allowInspectSubcmd = true): boolean {
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
    return allowInspectSubcmd && arg === 'inspect';
  }
  return false;
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

  const isPosixShell = ['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'].includes(lower);
  let stripped = false;
  const newArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (isPosixShell && !arg.startsWith('--') && /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/.test(arg) && i + 1 < args.length) {
      const hasInteractiveFlag = isInteractiveTarget && arg.startsWith('-') && /[ti]/.test(arg);
      const outFlag = hasInteractiveFlag ? arg.replace(/[ti]/g, '') : arg;
      if (hasInteractiveFlag) stripped = true;
      if (outFlag !== '-') newArgs.push(outFlag);
      newArgs.push(args[++i] ?? '');
      if (arg.startsWith('-') && arg.slice(1).includes('c')) {
        newArgs.push(...args.slice(i + 1));
        break;
      }
      continue;
    }
    if (arg === '--' || ['-c', '-e', '-m', '-p', '--command', '--eval', '--print'].includes(arg.toLowerCase()) || !arg.startsWith('-')) {
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
    args.length = 0;
    args.push(...newArgs);
    console.error(`\n   💡 AGENT HINT: Stripping interactive/TTY flags from ${cmdBasename} to prevent hanging... (Frictionless Recovery)`);
  }
}

function matchesAttachedRuntimeExec(low: string, execFlags: readonly string[], useColonBoundary = false): boolean {
  return execFlags.some((f) => {
    if (low === f) return true;
    if (f.startsWith('--') || useColonBoundary) return low.startsWith(`${f}=`) || (useColonBoundary && low.startsWith(`${f}:`));
    return low.startsWith(f) && low.length > f.length;
  });
}

function hasRuntimeExecutionArg(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
  execFlags: readonly string[],
  options: { isSlashSwitch?: boolean; caseSensitiveShort?: boolean; useColonBoundary?: boolean } = {},
): boolean {
  const { isSlashSwitch = false, caseSensitiveShort = false, useColonBoundary = false } = options;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') return i + 1 < args.length;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const isCombinedShellO = valueFlags === SHELL_VALUE_FLAGS && /^[-+][a-zA-Z]*[oO]$/.test(arg);
    if ((eq === -1 && (valueFlags.has(key) || valueFlags.has(key.toLowerCase()))) || isCombinedShellO) {
      i++;
      continue;
    }
    const candidate = caseSensitiveShort ? arg : arg.toLowerCase();
    if (matchesAttachedRuntimeExec(candidate, execFlags, useColonBoundary)) return true;
    if (!arg.startsWith('-') && !(isSlashSwitch && arg.startsWith('/'))) return true;
  }
  return false;
}

const PY_VALUE_FLAGS: ReadonlySet<string> = new Set(['-W', '-X', '--check-hash-based-pycs']);
const SHELL_VALUE_FLAGS: ReadonlySet<string> = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const PWSH_EXEC_FLAGS: ReadonlySet<string> = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if',
  '-outputformat', '-of', '-configurationname', '-settingsfile', '-custompipename', '-version',
]);
const RUBY_PERL_VALUE_FLAGS: ReadonlySet<string> = new Set(['-r', '-I', '-F', '-C', '-K', '-x']);
const PHP_VALUE_FLAGS: ReadonlySet<string> = new Set(['-d', '-c', '-z']);

function getReplBlockReason(cmdBasename: string, args: readonly string[]): string | null {
  const lower = cmdBasename.toLowerCase();
  const helpOrVer = isHelpOrVersion(cmdBasename, args);
  return match({ lower, args })
    .with({ args: [] }, () => 'without arguments or stdin')
    .with({ lower: P.union('node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe'), args: P.when(a => hasNodeDebuggerArg(a, lower.startsWith('node'))) }, () => 'with a debugging flag')
    .with({ lower: P.union('mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe', 'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe'), args: P.when(a => !helpOrVer && !isDbNonInteractive(lower, a)) }, () => 'as a DB client without execution flags')
    .with({ lower: P.union('ssh', 'ssh.exe', 'sftp', 'sftp.exe'), args: P.when(a => !helpOrVer && collectSshPositionals(a).length < 2) }, () => 'as a naked shell/connection without commands')
    .with({ lower: P.union('ftp', 'ftp.exe', 'telnet', 'telnet.exe'), args: P.when(() => !helpOrVer) }, () => 'as a naked shell/connection without commands')
    .with({ lower: P.union('node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, NODE_VALUE_FLAGS, ['-e', '--eval', '-p', '--print'])) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, PY_VALUE_FLAGS, ['-c', '-m'])) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, SHELL_VALUE_FLAGS, ['-c'], { caseSensitiveShort: true })) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, PWSH_EXEC_FLAGS, ['-c', '-command', '-file', '-f', '-ec', '-encodedcommand', '-en'], { useColonBoundary: true })) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, RUBY_PERL_VALUE_FLAGS, ['-e', '-E'], { caseSensitiveShort: true })) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('php', 'php.exe'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, PHP_VALUE_FLAGS, ['-r'])) }, () => 'with only flags and no script execution flags')
    .with({ lower: P.union('cmd', 'cmd.exe'), args: P.when(a => !helpOrVer && a.some(arg => arg.toLowerCase() === '/k')) }, () => 'with interactive /k switch')
    .with({ lower: P.union('cmd', 'cmd.exe'), args: P.when(a => !helpOrVer && !hasRuntimeExecutionArg(a, new Set(), ['/c'], { isSlashSwitch: true, useColonBoundary: true })) }, () => 'with only flags and no script execution flags')
    .otherwise(() => null);
}

const RUNNER_CMDS_FOR_WATCH = new Set(['node', 'bun', 'deno', 'npx', 'pnpx', 'bunx', 'pnpm', 'npm', 'yarn', 'tsx', 'vitest', 'jest']);
const RUNNER_PRE_FLAGS: ReadonlySet<string> = new Set([
  ...NODE_VALUE_FLAGS, '-C', '--dir', '--cwd', '--prefix', '--filter', '-F', '-c', '--config', '--tsconfig', '--tsconfig-override', '--userconfig', '-w', '--workspace',
]);
function scanRunnerWatchContext(baseNoExt: string, args: readonly string[]): { positionals: string[]; sawPreWatch: boolean } {
  const positionals: string[] = [];
  let sawPreWatch = false;
  let pastDoubleDash = false;
  const isDirectTestRunner = baseNoExt === 'vitest' || baseNoExt === 'jest';
  const isExecRunner = ['npx', 'pnpx', 'bunx'].includes(baseNoExt);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!pastDoubleDash && a === '--') { pastDoubleDash = true; continue; }
    if (pastDoubleDash) {
      const canForwardTestWatch = isDirectTestRunner || isExecRunner || positionals.some(p => ['test', 'vitest', 'jest'].includes(p.toLowerCase()));
      if (!canForwardTestWatch) break;
      const lowPost = a.toLowerCase();
      if (lowPost === '--watch' || lowPost === '--watch=true' || lowPost === '--watch-path' || lowPost.startsWith('--watch-path=')) {
        sawPreWatch = true;
        break;
      }
      continue;
    }
    if (a.startsWith('-')) {
      const low = a.toLowerCase();
      if (low === '--watch' || low === '--watch=true' || low === '--watch-path' || low.startsWith('--watch-path=')) sawPreWatch = true;
      if (low === '-e' || low === '--eval' || low === '-p' || low === '--print' || /^--(?:eval|print)=/.test(low)) break;
      if (!a.includes('=') && RUNNER_PRE_FLAGS.has(a)) i++;
      continue;
    }
    positionals.push(a);
    const nextAfter = args[i + 1]?.toLowerCase();
    if (a.toLowerCase() === 'tsx' && (nextAfter === 'watch' || nextAfter === '--watch')) sawPreWatch = true;
    if (baseNoExt === 'node' && positionals.length === 1) break;
  }
  return { positionals, sawPreWatch };
}

function checkPriorityWatchAndShellGuards(ctx: ExecutionContext): void {
  const { cmdBasename, args, envOverrides, payload } = ctx;
  const lower = cmdBasename.toLowerCase();
  const baseNoExt = lower.replace(/\.(?:exe|cmd)$/, '');

  if (['nodemon', 'nodemon.cmd', 'nodemon.exe', 'ts-node-dev', 'ts-node-dev.cmd', 'ts-node-dev.exe'].includes(lower)) {
    blockExecution(`'${cmdBasename}' runs indefinitely in watch mode. Blocking execution.`);
  }
  if (RUNNER_CMDS_FOR_WATCH.has(baseNoExt)) {
    const { positionals, sawPreWatch } = scanRunnerWatchContext(baseNoExt, args);
    const [pos0, pos1] = positionals;
    if (baseNoExt === 'tsx' && (pos0 === 'watch' || sawPreWatch)) {
      blockExecution(`'tsx ${sawPreWatch ? '--watch' : 'watch'}' runs indefinitely. Blocking execution.`);
    }
    if (payload.type === 'command') {
      const delegated = ['npx', 'pnpx', 'bunx'].includes(baseNoExt) ? pos0 : (pos0 !== undefined && ['exec', 'dlx', 'x'].includes(pos0) ? pos1 : pos0);
      if (delegated === 'nodemon' || delegated === 'ts-node-dev') {
        blockExecution(`'${delegated}' runs indefinitely in watch mode. Blocking execution to prevent hanging.`);
      }
      if (sawPreWatch) {
        blockExecution(`'${cmdBasename} --watch' runs indefinitely.`, ['Because \'agent-exec.ts\' is non-interactive, this will hang until timeout.', 'Please use standard execution without watch mode.']);
      }
    }
    if ((baseNoExt === 'bun' || baseNoExt === 'deno') && pos0 === 'repl') blockExecution(`'${baseNoExt} repl' is interactive and will hang indefinitely. Blocking execution.`);
  }
  if (['cmd', 'cmd.exe'].includes(lower) && args.some(a => a.toLowerCase() === 'pause')) {
    blockExecution(`'pause' in cmd.exe waits for a keypress and will hang indefinitely. Blocking execution.`);
  }
  if (baseNoExt === 'pm2') {
    const ddIdx = args.indexOf('--');
    const pre = ddIdx === -1 ? args : args.slice(0, ddIdx);
    const firstPm2Sub = pre.find(a => !a.startsWith('-'));
    if (firstPm2Sub !== undefined && ['logs', 'monit', 'dash'].includes(firstPm2Sub)) {
      blockExecution(`'pm2 ${firstPm2Sub}' is interactive/runs indefinitely. Blocking execution.`);
    }
  }
  if (['watch', 'watch.exe'].includes(lower)) blockExecution(`'watch' runs indefinitely. Blocking execution.`);
  if (['tail', 'tail.exe'].includes(lower) && hasTailFollowFlag(args)) {
    blockExecution(`'tail -f' runs indefinitely. Blocking execution.`);
  }
  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(lower)) {
    envOverrides['POWERSHELL_TELEMETRY_OPTOUT'] = '1';
    envOverrides['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1';
    const { cmdIdx, boundary } = findPwshCommandIndex(args);
    if (args.slice(0, boundary).some(a => a.toLowerCase() === '-noexit')) blockExecution(`'pwsh -NoExit' prevents the shell from exiting and will hang indefinitely. Blocking execution.`);
    if (cmdIdx !== -1) {
      const cmdTok = args[cmdIdx] ?? '';
      const inlineBody = cmdTok.includes(':') ? [cmdTok.slice(cmdTok.indexOf(':') + 1), ...args.slice(cmdIdx + 1)].join(' ') : args.slice(cmdIdx + 1).join(' ');
      if (inlineBody.length > 0 && PWSH_UI_REGEX.test(stripCommentAndQuoteSpansForShellScan(inlineBody))) blockExecution(`PowerShell UI cmdlets like Get-Credential or Out-GridView will hang headlessly. Blocking execution.`);
    }
  }
}

const PWSH_BOUNDARY_FLAGS = new Set(['--', '-file', '-f', '-encodedcommand', '-ec', '-en']);

function findPwshCommandIndex(args: readonly string[]): { cmdIdx: number; boundary: number } {
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    const head = low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
    if (PWSH_BOUNDARY_FLAGS.has(head)) return { cmdIdx: -1, boundary: i };
    if (head === '-c' || head === '-command') return { cmdIdx: i, boundary: i };
    if (!low.includes(':') && PWSH_EXEC_FLAGS.has(low)) i++;
  }
  return { cmdIdx: -1, boundary: args.length };
}

function hasPythonPdbArg(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--' || a === '-c' || (a.startsWith('-c') && !a.startsWith('--'))) return false;
    if (!a.startsWith('--') && (/^-[a-zA-Z]*mpdb$/i.test(a) || (/^-[a-zA-Z]*m$/.test(a) && args[i + 1] === 'pdb'))) {
      return true;
    }
    if (PY_VALUE_FLAGS.has(a)) { i++; continue; }
    if (!a.startsWith('-')) return false;
  }
  return false;
}

export function guardDirectCommandMode(ctx: ExecutionContext): void {
  checkPriorityWatchAndShellGuards(ctx);
  const { cmdBasename, args, payload } = ctx;
  const lowerCmd = cmdBasename.toLowerCase();

  if (TUI_COMMAND_SET.has(cmdBasename) || TUI_COMMAND_SET.has(lowerCmd)) {
    blockExecution(`You attempted to start an interactive TUI application (${cmdBasename}).`, [
      `Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`,
      `Please use standard terminal commands (e.g. cat, grep, list_dir, view_file) instead.`,
    ]);
  }
  if (payload.type === 'command' && ['node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe'].includes(lowerCmd) && hasNodeDebuggerArg(args, lowerCmd.startsWith('node'))) {
    blockExecution(`You attempted to start ${cmdBasename} with a debugging flag.`, [`Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`]);
  }
  if (payload.type === 'command' && ['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(lowerCmd) && hasPythonPdbArg(args)) {
    blockExecution(`You attempted to start Python with a debugger (-m pdb).`, [`Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`]);
  }
  const isReplCmd = REPL_COMMAND_SET.has(cmdBasename) || REPL_COMMAND_SET.has(lowerCmd);
  if (payload.type !== 'command' || payload.stdin || !isReplCmd) return;

  stripNonSshInteractiveFlags(cmdBasename, args);
  payload.args = args;
  const blockReason = getReplBlockReason(cmdBasename, args);
  if (blockReason !== null) {
    blockExecution(`You attempted to start an interactive REPL (${cmdBasename} ${blockReason}).`, [
      `Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`,
      `If you meant to execute code, use the 'eval' payload type, provide a script, or pass 'stdin'.`,
    ]);
  }
}

export function encodeInlinePwshInvocation(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  if (payload.type !== 'command' || payload.target === 'wsl2') return;
  if (!['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmdBasename.toLowerCase())) return;

  const { cmdIdx: cIndex } = findPwshCommandIndex(args);
  const cmdTok = cIndex !== -1 ? (args[cIndex] ?? '') : '';
  const colonBody = cmdTok.includes(':') ? cmdTok.slice(cmdTok.indexOf(':') + 1) : '';
  if (cIndex !== -1 && (colonBody.length > 0 || cIndex + 1 < args.length)) {
    const scriptArgs = colonBody.length > 0 ? [colonBody, ...args.slice(cIndex + 1)] : args.slice(cIndex + 1);
    const safeArgs = scriptArgs.map((a) => (!/[ \t]/.test(a) || (a.startsWith("'") && a.endsWith("'")) || (a.startsWith('"') && a.endsWith('"')) || a.startsWith('$(') || a.startsWith('@(') ? a : `'${escapePwshSingleQuoted(a)}'`));
    const scriptBody = scriptArgs.length === 1 ? (scriptArgs[0] ?? '') : safeArgs.join(' ');
    const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n` + scriptBody;
    const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
    args.splice(cIndex, args.length - cIndex, '-EncodedCommand', encoded);
    payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Intercepted inline PowerShell command. Converting to Base64 -EncodedCommand to prevent quote parsing failures... (Frictionless Recovery)`);
  }

  const { boundary: flagBoundary } = findPwshCommandIndex(args);
  const lowerHeads = args.slice(0, flagBoundary).map((a) => {
    const low = a.toLowerCase();
    return low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
  });
  const newArgs: string[] = [];
  if (!lowerHeads.includes('-executionpolicy') && !lowerHeads.includes('-ep')) newArgs.push('-ExecutionPolicy', 'Bypass');
  if (!lowerHeads.includes('-noninteractive')) newArgs.push('-NonInteractive');
  if (!lowerHeads.includes('-noprofile')) newArgs.push('-NoProfile');
  if (newArgs.length > 0) {
    args.unshift(...newArgs);
    payload.args = args;
    console.error(`\n   💡 AGENT HINT: Automatically injected [${newArgs.join(', ')}] into ${cmdBasename} command to prevent hanging.`);
  }
}
