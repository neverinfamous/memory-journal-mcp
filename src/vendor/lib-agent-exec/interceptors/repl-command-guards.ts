// @ts-nocheck
import {
  NODE_VALUE_FLAGS, PWSH_EXEC_FLAGS, PY_VALUE_FLAGS, REDIS_OPTION_WITH_ARG, REPL_COMMANDS,
  SSH_VALUE_FLAGS, TUI_COMMANDS, collectSshPositionals, hasCmdInteractiveKSwitch,
  hasNodeDebuggerArg, hasPythonPdbArg, isDbNonInteractive, isPythonValueShortCluster,
  isSshConsumingShortArg, isWslNonInteractive,
} from './repl-tui-constants.js';
import { checkPriorityWatchAndShellGuards, encodeInlinePwshInvocation } from './repl-watch-pwsh-guards.js';
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

const JS_RUNTIME_CLI_SET: ReadonlySet<string> = new Set([
  'node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe', 'tsx', 'tsx.exe', 'tsx.cmd', 'ts-node',
]);
const DEBUGGABLE_JS_CLI_SET: ReadonlySet<string> = new Set([
  'node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'deno', 'deno.exe',
]);
const PYTHON_CLI_SET: ReadonlySet<string> = new Set(['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe']);
const POSIX_SHELL_CLI_SET: ReadonlySet<string> = new Set([
  'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'ash', 'ash.exe', 'dash', 'dash.exe',
]);
const PWSH_CLI_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe']);
const NON_POSIX_SHORT_SHELL_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe']);
const INTERACTIVE_STRIP_TARGET_SET: ReadonlySet<string> = new Set([
  ...POSIX_SHELL_CLI_SET, ...PYTHON_CLI_SET,
]);
const RUBY_PERL_CLI_SET: ReadonlySet<string> = new Set(['ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd']);
const HELP_LOWER_FLAG_SET: ReadonlySet<string> = new Set(['--version', '-version', '--help', '-help', '-?', '/?']);
const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

function resolveHelpValueFlags(lowerCmd: string): ReadonlySet<string> {
  if (DB_CLIENTS.has(lowerCmd)) return DB_HELP_VALUE_FLAGS;
  if (SSH_TELNET_CLIENTS.has(lowerCmd)) return SSH_VALUE_FLAGS;
  if (JS_RUNTIME_CLI_SET.has(lowerCmd)) return NODE_HELP_VALUE_FLAGS;
  if (PYTHON_CLI_SET.has(lowerCmd)) return PYTHON_HELP_VALUE_FLAGS;
  if (POSIX_SHELL_CLI_SET.has(lowerCmd)) return SHELL_HELP_VALUE_FLAGS;
  if (PWSH_CLI_SET.has(lowerCmd)) return PWSH_HELP_VALUE_FLAGS;
  return OTHER_REPL_HELP_VALUE_FLAGS;
}

const POSIX_O_CLUSTER_RE = /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/;
const CMD_SLASH_CK_RE = /^\/[ck](?:$|[=:])/;
const PWSH_VERSION_VAL_RE = /^\d+(?:\.\d+)*$/;
const SHORT_TI_FLAGS_RE = /[ti]/;
const SHORT_TI_FLAGS_GLOBAL_RE = /[ti]/g;
const SHORT_TI_CLUSTER_RE = /^-([a-zA-Z]*[ti][a-zA-Z]*)$/;

function isShellOptionWithArg(lowerCmd: string, arg: string): boolean {
  return POSIX_SHELL_CLI_SET.has(lowerCmd) && POSIX_O_CLUSTER_RE.test(arg);
}

function isHelpOrVersion(cmdBasename: string, args: readonly string[]): boolean {
  const lowerCmd = cmdBasename.toLowerCase();
  const isDb = DB_CLIENTS.has(lowerCmd);
  const isCmdShell = lowerCmd === 'cmd' || lowerCmd === 'cmd.exe';
  const isPwshCmd = PWSH_CLI_SET.has(lowerCmd);
  const isPosixShell = POSIX_SHELL_CLI_SET.has(lowerCmd);
  const valueFlags = resolveHelpValueFlags(lowerCmd);
  const vMeansVersion = !isPosixShell && !PYTHON_CLI_SET.has(lowerCmd)
    && !SSH_TELNET_CLIENTS.has(lowerCmd)
    && !NON_V_DB_CLIENTS.has(lowerCmd);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    const lower = arg.toLowerCase();
    if (isCmdShell) {
      if (CMD_SLASH_CK_RE.test(lower)) break;
      if (lower === '/?') return true;
      continue;
    }
    if (isPwshCmd && lower === '-version' && PWSH_VERSION_VAL_RE.test(args[i + 1] ?? '')) { i++; continue; }
    if (HELP_LOWER_FLAG_SET.has(lower) || arg === '-V' || arg === '-VV') return true;
    if (arg === '-h' && !isDb && !isPosixShell) return true;
    if (lower === '-v' && vMeansVersion) return true;
    const checkArg = isPwshCmd ? lower : arg;
    if (
      valueFlags.has(checkArg) ||
      isShellOptionWithArg(lowerCmd, arg) ||
      (isDb && arg === '-h') ||
      ((lowerCmd === 'psql' || lowerCmd === 'psql.exe') && arg === '-v') ||
      (lowerCmd.startsWith('python') && isPythonValueShortCluster(arg)) ||
      (SSH_TELNET_CLIENTS.has(lowerCmd) && isSshConsumingShortArg(arg))
    ) {
      i++;
    }
  }
  return false;
}

const SKIP_INTERACTIVE_STRIP_SET: ReadonlySet<string> = new Set([
  ...SSH_CLIENT_SET, 'perl', 'perl.exe', 'perl.cmd', 'redis-cli', 'redis-cli.exe',
  'ruby', 'ruby.exe', 'ruby.cmd', 'mysql', 'mysql.exe',
]);
const INTERP_VALUE_FLAGS_STRIP: ReadonlySet<string> = new Set([
  ...NODE_VALUE_FLAGS, '-W', '-X', '--rcfile', '--init-file',
]);

function stripPythonShortFlag(arg: string): { nextArg: string | null; stopAfter: boolean; stripped: boolean; consumesNext: boolean } {
  let prefix = '';
  let stripped = false;
  for (let j = 1; j < arg.length; j++) {
    const ch = arg[j] ?? '';
    if (ch === 'c' || ch === 'm' || ch === 'W' || ch === 'X') {
      return {
        nextArg: `-${prefix}${arg.slice(j)}`,
        stopAfter: ch === 'c' || ch === 'm',
        stripped,
        consumesNext: (ch === 'W' || ch === 'X') && j + 1 === arg.length,
      };
    }
    if (ch === 'i' || ch === 't') {
      stripped = true;
      continue;
    }
    prefix += ch;
  }
  return { nextArg: prefix.length > 0 ? `-${prefix}` : null, stopAfter: false, stripped, consumesNext: false };
}

const PWSH_STOP_FLAG_SET: ReadonlySet<string> = new Set(['-c', '-command', '-f', '-file', '-ec', '-encodedcommand', '-en']);

function isStopFlagForRuntime(lower: string, isPosixShell: boolean, arg: string): boolean {
  if (arg === '--') return true;
  if (!arg.startsWith('-')) return !(isPosixShell && arg.startsWith('+') && arg.length > 1);
  if (isPosixShell) return arg === '-c' || arg === '--command';
  if (lower.startsWith('python')) return arg === '-c' || arg === '-m';
  if (lower === 'php' || lower === 'php.exe') return arg === '-r';
  if (PWSH_CLI_SET.has(lower)) {
    const low = arg.toLowerCase();
    const colonIdx = low.indexOf(':');
    const head = colonIdx !== -1 ? low.slice(0, colonIdx) : low;
    return PWSH_STOP_FLAG_SET.has(head);
  }
  if ((lower === 'perl' || lower === 'perl.exe') && arg === '-E') return true;
  return arg === '-e' || arg === '-p' || arg === '--eval' || arg === '--print' || arg === '-c' || arg === '--command';
}

function stripNonSshInteractiveFlags(cmdBasename: string, args: string[]): void {
  const lower = cmdBasename.toLowerCase();
  if (SKIP_INTERACTIVE_STRIP_SET.has(lower)) return;
  const usesPosixShortFlags = !NON_POSIX_SHORT_SHELL_SET.has(lower);
  const isInteractiveTarget = INTERACTIVE_STRIP_TARGET_SET.has(lower);
  const isPosixShell = POSIX_SHELL_CLI_SET.has(lower);
  let stripped = false;
  const newArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (isPosixShell && !arg.startsWith('--') && POSIX_O_CLUSTER_RE.test(arg) && i + 1 < args.length) {
      const hasInteractiveFlag = isInteractiveTarget && arg.startsWith('-') && SHORT_TI_FLAGS_RE.test(arg);
      const outFlag = hasInteractiveFlag ? arg.replace(SHORT_TI_FLAGS_GLOBAL_RE, '') : arg;
      if (hasInteractiveFlag) stripped = true;
      if (outFlag !== '-') newArgs.push(outFlag);
      newArgs.push(args[++i] ?? '');
      if (arg.startsWith('-') && arg.slice(1).includes('c')) {
        newArgs.push(...args.slice(i + 1));
        break;
      }
      continue;
    }
    if (isStopFlagForRuntime(lower, isPosixShell, arg)) {
      newArgs.push(...args.slice(i));
      break;
    }
    if (arg === '-i' || arg === '--interactive' || ((lower === 'php' || lower === 'php.exe') && arg === '-a')) {
      stripped = true;
      continue;
    }
    if (lower.startsWith('python') && arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      const pyRes = stripPythonShortFlag(arg);
      if (pyRes.stripped) stripped = true;
      if (pyRes.nextArg !== null) newArgs.push(pyRes.nextArg);
      if (pyRes.stopAfter) {
        newArgs.push(...args.slice(i + 1));
        break;
      }
      if (pyRes.consumesNext && i + 1 < args.length) {
        const valArg = args[++i];
        if (valArg !== undefined) newArgs.push(valArg);
      }
      continue;
    }
    if (isInteractiveTarget && usesPosixShortFlags && SHORT_TI_CLUSTER_RE.test(arg)) {
      const nextArg = arg.replace(SHORT_TI_FLAGS_GLOBAL_RE, '');
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
  options: { isSlashSwitch?: boolean; caseSensitiveShort?: boolean; useColonBoundary?: boolean; requireExecFlag?: boolean } = {},
): boolean {
  const { isSlashSwitch = false, caseSensitiveShort = false, useColonBoundary = false, requireExecFlag = false } = options;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') return !requireExecFlag && i + 1 < args.length;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const isCombinedShellO = valueFlags === SHELL_VALUE_FLAGS
      && POSIX_O_CLUSTER_RE.test(arg)
      && !(arg.startsWith('-') && arg.slice(1).includes('c'));
    if (
      (eq === -1 && (valueFlags.has(key) || (!caseSensitiveShort && valueFlags.has(key.toLowerCase())))) ||
      isCombinedShellO ||
      (valueFlags === PY_VALUE_FLAGS && isPythonValueShortCluster(arg))
    ) {
      i++;
      continue;
    }
    const candidate = caseSensitiveShort ? arg : arg.toLowerCase();
    if (valueFlags === PY_VALUE_FLAGS && !arg.startsWith('--') && /^-[a-bd-ln-zA-VY-Z]*[cm]/.test(arg)) return true;
    if (matchesAttachedRuntimeExec(candidate, execFlags, useColonBoundary)) return true;
    if (
      !requireExecFlag &&
      !arg.startsWith('-') &&
      !(isSlashSwitch && arg.startsWith('/')) &&
      !(valueFlags === SHELL_VALUE_FLAGS && arg.startsWith('+') && arg.length > 1)
    ) {
      return true;
    }
  }
  return false;
}

const SHELL_VALUE_FLAGS: ReadonlySet<string> = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const RUBY_PERL_VALUE_FLAGS: ReadonlySet<string> = new Set(['-r', '-I', '-F', '-C', '-K', '-x']);
const PHP_VALUE_FLAGS: ReadonlySet<string> = new Set(['-d', '-c', '-z']);

const FTP_TELNET_CLI_SET: ReadonlySet<string> = new Set(['ftp', 'ftp.exe', 'telnet', 'telnet.exe']);
const NODE_EXEC_FLAGS = ['-e', '--eval', '-p', '--print'] as const;
const PY_EXEC_FLAGS = ['-c', '-m'] as const;
const SHELL_EXEC_FLAGS = ['-c'] as const;
const PWSH_EXEC_ARG_FLAGS = ['-c', '-command', '-file', '-f', '-ec', '-encodedcommand', '-en'] as const;
const RUBY_PERL_EXEC_FLAGS = ['-e', '-E'] as const;
const PHP_EXEC_FLAGS = ['-r'] as const;
const CMD_EXEC_FLAGS = ['/c'] as const;

function getReplBlockReason(cmdBasename: string, args: readonly string[]): string | null {
  if (args.length === 0) return 'without arguments or stdin';
  const lower = cmdBasename.toLowerCase();
  const helpOrVer = isHelpOrVersion(cmdBasename, args);
  if (DEBUGGABLE_JS_CLI_SET.has(lower)) {
    if (hasNodeDebuggerArg(args, lower.startsWith('node'))) return 'with a debugging flag';
    return !helpOrVer && !hasRuntimeExecutionArg(args, NODE_VALUE_FLAGS, NODE_EXEC_FLAGS)
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (DB_CLIENTS.has(lower)) {
    return !helpOrVer && !isDbNonInteractive(lower, args) ? 'as a DB client without execution flags' : null;
  }
  if (SSH_CLIENT_SET.has(lower)) {
    return !helpOrVer && collectSshPositionals(args).length < 2 ? 'as a naked shell/connection without commands' : null;
  }
  if (FTP_TELNET_CLI_SET.has(lower)) {
    return !helpOrVer ? 'as a naked shell/connection without commands' : null;
  }
  if (PYTHON_CLI_SET.has(lower)) {
    return !helpOrVer && !hasRuntimeExecutionArg(args, PY_VALUE_FLAGS, PY_EXEC_FLAGS)
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (POSIX_SHELL_CLI_SET.has(lower)) {
    return !helpOrVer && !hasRuntimeExecutionArg(args, SHELL_VALUE_FLAGS, SHELL_EXEC_FLAGS, { caseSensitiveShort: true })
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (PWSH_CLI_SET.has(lower)) {
    return !helpOrVer && !hasRuntimeExecutionArg(args, PWSH_EXEC_FLAGS, PWSH_EXEC_ARG_FLAGS, { useColonBoundary: true })
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (RUBY_PERL_CLI_SET.has(lower)) {
    return !helpOrVer && !hasRuntimeExecutionArg(args, RUBY_PERL_VALUE_FLAGS, RUBY_PERL_EXEC_FLAGS, { caseSensitiveShort: true })
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (lower === 'php' || lower === 'php.exe') {
    return !helpOrVer && !hasRuntimeExecutionArg(args, PHP_VALUE_FLAGS, PHP_EXEC_FLAGS, { caseSensitiveShort: true })
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (lower === 'cmd' || lower === 'cmd.exe') {
    if (!helpOrVer && hasCmdInteractiveKSwitch(args)) return 'with interactive /k switch';
    return !helpOrVer && !hasRuntimeExecutionArg(args, EMPTY_STRING_SET, CMD_EXEC_FLAGS, { isSlashSwitch: true, useColonBoundary: true, requireExecFlag: true })
      ? 'with only flags and no script execution flags'
      : null;
  }
  if (lower === 'wsl' || lower === 'wsl.exe') {
    return !helpOrVer && !isWslNonInteractive(args) ? 'with only session flags and no command' : null;
  }
  return null;
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
  if (payload.type === 'command' && DEBUGGABLE_JS_CLI_SET.has(lowerCmd) && hasNodeDebuggerArg(args, lowerCmd.startsWith('node'))) {
    blockExecution(`You attempted to start ${cmdBasename} with a debugging flag.`, [`Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`]);
  }
  if (payload.type === 'command' && PYTHON_CLI_SET.has(lowerCmd) && hasPythonPdbArg(args)) {
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

export { encodeInlinePwshInvocation };
