// @ts-nocheck
import { isPwshCommandFlag, isPwshEncodedCommandFlag, isPwshFileFlag } from './system-command-context.js';

export const NODE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader',
  '-C', '--conditions', '--input-type', '--env-file', '--env-file-if-exists',
  '--watch-path', '--redirect-warnings', '--diagnostic-dir', '--heapsnapshot-signal',
  '--openssl-config', '--icu-data-dir', '--title', '--max-old-space-size',
]);

export const REDIS_OPTION_WITH_ARG: ReadonlySet<string> = new Set(['-h', '-p', '-s', '-a', '-u', '--user', '--pass', '-n', '-r', '-i', '-d']);

export const SSH_VALUE_FLAGS: ReadonlySet<string> = new Set(['-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-P', '-Q', '-R', '-S', '-W', '-w']);

export const DB_CLIENT_BASE_NAMES: ReadonlySet<string> = new Set(['mysql', 'psql', 'sqlite3', 'sqlite', 'redis-cli', 'mongo', 'mongosh']);

const SQLITE_VALUE_FLAGS = new Set(['-separator', '-nullvalue', '-newline', '-init', '-cmd']);
const SSH_CLIENT_BASE_NAMES = new Set(['ssh', 'sftp', 'ftp', 'telnet']);

function matchesFlagOrPrefix(arg: string, exactFlags: readonly string[], allowShortPrefix = false): boolean {
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

const SQLITE_BATCH_FLAGS = ['-cmd', '-batch', '--batch'] as const;
const PSQL_NONINT_FLAGS = ['-c', '--command', '-f', '--file'] as const;
const MYSQL_NONINT_FLAGS = ['-e', '--execute'] as const;
const MONGO_NONINT_FLAGS = ['--eval', '-f', '--file'] as const;
const REDIS_EVAL_FLAGS = ['--eval'] as const;
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIR_OP_ONLY_RE = /^(?:[0-9]*|&)?>>?$/;
const REDIR_OP_ATTACHED_RE = /^(?:[0-9]*|&)?>>?.+/;

export function isDbNonInteractive(cmd: string, args: readonly string[]): boolean {
  const base = cmd.replace(/\.exe$/, '');
  if (base === 'sqlite3' || base === 'sqlite') {
    if (args.some(arg => matchesFlagOrPrefix(arg, SQLITE_BATCH_FLAGS, false))) return true;
    return countSqlitePositionals(args) >= 2;
  }
  if (base === 'psql') {
    return args.some(arg => matchesFlagOrPrefix(arg, PSQL_NONINT_FLAGS, true));
  }
  if (base === 'mysql') {
    return args.some(arg => matchesFlagOrPrefix(arg, MYSQL_NONINT_FLAGS, true));
  }
  if (base === 'mongo' || base === 'mongosh') {
    return args.some(arg => matchesFlagOrPrefix(arg, MONGO_NONINT_FLAGS, false));
  }
  if (base === 'redis-cli') {
    if (args.some(arg => matchesFlagOrPrefix(arg, REDIS_EVAL_FLAGS, false))) return true;
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

export function collectSshPositionals(args: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-')) {
      if (isSshConsumingShortArg(arg) && i + 1 < args.length) i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

const WSL_SESSION_VALUE_FLAGS: ReadonlySet<string> = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
const SHELL_BODY_WRAPPERS = new Set(['sudo', 'env', 'su', 'doas', 'time', 'timeout', 'stdbuf', 'nohup', 'exec', 'wsl', 'wsl.exe']);
export const SHELL_BODY_WRAPPER_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-C', '--close-from', '-D', '--chdir', '-T', '--command-timeout', '-U', '--other-user']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '--argv0']),
  su: new Set(['-s', '--shell', '-g', '--group', '-G', '--supp-group', '-w', '--whitelist-environment']),
  doas: new Set(['-u', '-C']),
  time: new Set(['-o', '--output', '-f', '--format']),
  timeout: new Set(['-k', '--kill-after', '-s', '--signal']),
  stdbuf: new Set(['-i', '--input', '-o', '--output', '-e', '--error']),
  nohup: new Set(),
  exec: new Set(['-a']),
  wsl: WSL_SESSION_VALUE_FLAGS,
  'wsl.exe': WSL_SESSION_VALUE_FLAGS,
};

const SSH_SHORT_VALUE_CHARS: ReadonlySet<string> = new Set([...SSH_VALUE_FLAGS].map(f => f.slice(1)));
const SUDO_SHORT_VALUE_CHARS: ReadonlySet<string> = new Set(['u', 'g', 'h', 'p', 'r', 't', 'C', 'D', 'T', 'U']);

export function isSudoInteractiveFlag(arg: string): boolean {
  if (arg === '--login' || arg === '--shell') return true;
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length < 2) return false;
  for (let i = 1; i < arg.length; i++) {
    const ch = arg[i] ?? '';
    if (ch === 'i' || ch === 's') return true;
    if (SUDO_SHORT_VALUE_CHARS.has(ch)) return false;
  }
  return false;
}

function isShortClusterConsumingNext(arg: string, chars: ReadonlySet<string>, minLen: number): boolean {
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length < minLen) return false;
  for (let i = 1; i < arg.length; i++) {
    const ch = arg[i] ?? '';
    if (chars.has(ch)) return i === arg.length - 1;
  }
  return false;
}

export const isSshConsumingShortArg = (arg: string): boolean => isShortClusterConsumingNext(arg, SSH_SHORT_VALUE_CHARS, 2);
export const isSudoConsumingShortCluster = (arg: string): boolean => isShortClusterConsumingNext(arg, SUDO_SHORT_VALUE_CHARS, 3);

export function parseSuCommandShortFlag(tok: string): { attached: string } | null {
  const m = /^-[lmpt]*c([\s\S]*)$/.exec(tok);
  return m !== null ? { attached: m[1] ?? '' } : null;
}

export function parseEnvSplitShortFlag(tok: string): { attached: string } | null {
  const m = /^-[i0v]*S([\s\S]*)$/.exec(tok);
  return m !== null ? { attached: m[1] ?? '' } : null;
}

const wrapperBase = (tok: string): string => tok.replace(/^.*[\\/]/, '').toLowerCase();

export function hasPreDashSuCommand(tokens: readonly string[], allowHelp = false, startIdx = 0): boolean {
  const suFlags = SHELL_BODY_WRAPPER_VALUE_FLAGS['su'];
  for (let j = startIdx; j < tokens.length; j++) {
    const t = tokens[j] ?? '';
    if (t === '--') return false;
    if (t === '--command' || t.startsWith('--command=') || parseSuCommandShortFlag(t) !== null) return true;
    if (allowHelp && (t === '--help' || t === '--version' || t === '-h' || t === '-V')) return true;
    if (suFlags !== undefined && suFlags.has(t)) j++;
  }
  return false;
}

export function findUnwrappedBodyCmdIndex(rawTokens: readonly string[]): number {
  let cmdIdx = 0;
  let activeWrapper: string | null = null;
  let skippedTimeoutDuration = false;
  let skippedSuUser = false;
  while (cmdIdx < rawTokens.length) {
    const tok = rawTokens[cmdIdx] ?? '';
    const lowTok = wrapperBase(tok);
    if (activeWrapper !== null) {
      const isWslWrap = activeWrapper === 'wsl' || activeWrapper === 'wsl.exe';
      const wrapTok = isWslWrap ? tok.toLowerCase() : tok;
      if (
        (activeWrapper === 'su' && (tok === '--command' || tok === '--command=' || parseSuCommandShortFlag(tok)?.attached === '')) ||
        (activeWrapper === 'env' && (tok === '--split-string' || tok === '--split-string=' || parseEnvSplitShortFlag(tok)?.attached === '')) ||
        (isWslWrap && (wrapTok === '-e' || wrapTok === '--exec')) ||
        tok === '--'
      ) {
        cmdIdx += (tok === '--' && activeWrapper === 'timeout' && !skippedTimeoutDuration) ? 2 : 1;
        activeWrapper = null;
        continue;
      }
      const wrapperFlags = SHELL_BODY_WRAPPER_VALUE_FLAGS[activeWrapper];
      if ((wrapperFlags !== undefined && wrapperFlags.has(wrapTok)) || (activeWrapper === 'sudo' && isSudoConsumingShortCluster(tok))) { cmdIdx += 2; continue; }
      if (tok.startsWith('-')) { cmdIdx++; continue; }
      if (activeWrapper === 'timeout' && !skippedTimeoutDuration) { skippedTimeoutDuration = true; cmdIdx++; continue; }
      if (activeWrapper === 'su' && !skippedSuUser && hasPreDashSuCommand(rawTokens, false, cmdIdx + 1)) { skippedSuUser = true; cmdIdx++; continue; }
      if (activeWrapper === 'sudo' && ENV_ASSIGN_RE.test(tok)) { cmdIdx++; continue; }
      activeWrapper = null;
    }
    if (ENV_ASSIGN_RE.test(tok)) { cmdIdx++; continue; }
    if (SHELL_BODY_WRAPPERS.has(lowTok)) { activeWrapper = lowTok; skippedTimeoutDuration = false; skippedSuUser = false; cmdIdx++; continue; }
    break;
  }
  return cmdIdx;
}

export function isAsciiWs(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12;
}

export function appendSegmentChunk(
  chunk: string,
  tokens: string[],
  prevEndsWithWs: boolean,
  active: boolean,
): { endsWithWs: boolean; active: boolean } {
  if (chunk.length === 0) return { endsWithWs: prevEndsWithWs, active };
  let endsWithWs = prevEndsWithWs;
  if (!active) {
    let end = chunk.length;
    while (end > 0 && isAsciiWs(chunk.charCodeAt(end - 1))) end--;
    endsWithWs = end < chunk.length;
    if (end > 0) {
      let start = end - 1;
      while (start > 0 && !isAsciiWs(chunk.charCodeAt(start - 1))) start--;
      const tailWord = chunk.slice(start, end);
      const prevWasToken = !prevEndsWithWs && start === 0 && tokens.length > 0;
      const last = prevWasToken ? `${tokens[tokens.length - 1] ?? ''}${tailWord}` : tailWord;
      tokens.length = 0;
      tokens.push(last);
    }
    return { endsWithWs, active: false };
  }
  let pos = 0;
  let needJoin = !prevEndsWithWs && tokens.length > 0;
  while (pos < chunk.length) {
    if (isAsciiWs(chunk.charCodeAt(pos))) {
      endsWithWs = true;
      needJoin = false;
      while (pos < chunk.length && isAsciiWs(chunk.charCodeAt(pos))) pos++;
      continue;
    }
    const start = pos;
    while (pos < chunk.length && !isAsciiWs(chunk.charCodeAt(pos))) pos++;
    const word = chunk.slice(start, pos);
    if (needJoin) tokens[tokens.length - 1] = `${tokens[tokens.length - 1] ?? ''}${word}`;
    else tokens.push(word);
    endsWithWs = false;
    needJoin = false;
  }
  const cmdIdx = findUnwrappedBodyCmdIndex(tokens);
  if (cmdIdx < tokens.length) {
    const rawCmd = (tokens[cmdIdx] ?? '').replace(/^['"]|['"]$/g, '');
    const slash = rawCmd.lastIndexOf('/');
    const bslash = rawCmd.lastIndexOf('\\');
    const tail = rawCmd.slice(Math.max(slash, bslash) + 1).toLowerCase().replace(/\.exe$/, '');
    if (tail !== 'docker' && tail !== 'docker-compose' && tail !== 'bash' && tail !== 'sh' && tail !== 'zsh' && tail !== 'ash' && tail !== 'dash') {
      return { endsWithWs, active: false };
    }
  }
  return { endsWithWs, active: true };
}

export function isSuOrEnvCommandPrefix(tokens: readonly string[], lastTok: string | undefined): boolean {
  const isSu = lastTok !== undefined && (lastTok === '--command' || lastTok === '--command=' || parseSuCommandShortFlag(lastTok)?.attached === '') && tokens.some(t => wrapperBase(t) === 'su');
  const isEnv = lastTok !== undefined && (lastTok === '--split-string' || lastTok === '--split-string=' || parseEnvSplitShortFlag(lastTok)?.attached === '') && tokens.some(t => wrapperBase(t) === 'env');
  return (isSu || isEnv) && findUnwrappedBodyCmdIndex([...tokens, '__CMD__']) === tokens.length;
}

function stripOutputRedirections(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? '';
    if (REDIR_OP_ONLY_RE.test(tok)) {
      i++;
      continue;
    }
    if (REDIR_OP_ATTACHED_RE.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

export function expandAttachedWrapperTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let isSuWrap = false;
  let isEnvWrap = false;
  for (const tok of tokens) {
    if (tok.startsWith('--command=') && tok.length > '--command='.length && isSuWrap) {
      out.push('--command', tok.slice('--command='.length));
    } else if (tok.startsWith('--split-string=') && tok.length > '--split-string='.length && isEnvWrap) {
      out.push('--split-string', tok.slice('--split-string='.length));
    } else {
      const suFlag = isSuWrap ? parseSuCommandShortFlag(tok) : null;
      const envFlag = isEnvWrap ? parseEnvSplitShortFlag(tok) : null;
      if (suFlag !== null && suFlag.attached.length > 0) out.push('-c', suFlag.attached);
      else if (envFlag !== null && envFlag.attached.length > 0) out.push('-S', envFlag.attached);
      else {
        out.push(tok);
        const base = wrapperBase(tok);
        if (base === 'su') isSuWrap = true;
        else if (base === 'env') isEnvWrap = true;
      }
    }
  }
  return out;
}

function hasInteractiveSudoInTokens(prefixTokens: readonly string[]): boolean {
  let inSudo = false;
  for (let i = 0; i < prefixTokens.length; i++) {
    const tok = prefixTokens[i] ?? '';
    if (!inSudo) {
      if (wrapperBase(tok) === 'sudo') inSudo = true;
      continue;
    }
    if (tok === '--') { inSudo = false; continue; }
    if (isSudoInteractiveFlag(tok)) return true;
    const sudoValueFlags = SHELL_BODY_WRAPPER_VALUE_FLAGS['sudo'];
    if ((sudoValueFlags !== undefined && sudoValueFlags.has(tok)) || isSudoConsumingShortCluster(tok)) { i++; continue; }
    if (tok.startsWith('-')) continue;
    if (ENV_ASSIGN_RE.test(tok)) continue;
    inSudo = wrapperBase(tok) === 'sudo';
  }
  return false;
}

function hasInteractiveSuInTokens(rawTokens: readonly string[], cmdIdx: number): boolean {
  for (let i = 0; i < cmdIdx; i++) {
    if (wrapperBase(rawTokens[i] ?? '') === 'su' && !hasPreDashSuCommand(rawTokens, true, i + 1)) return true;
  }
  return false;
}

export function findInteractiveDbOrSshInBody(body: string): string | null {
  const cleanedBody = body.replace(/\|&/g, '|').replace(/([<>])&/g, '$1__amp__').replace(/(^|[\s;|&()])&(?=>)/g, '$1');
  const segRe = /(?:^|&&|\|\||[;\n|&{}()`])\s*([^;\n|&{}()`]+)/g;
  for (const m of cleanedBody.matchAll(segRe)) {
    const rawMatch = m[0] ?? '';
    const trimmedLead = rawMatch.trimStart();
    if (trimmedLead.startsWith('|') && !trimmedLead.startsWith('||')) continue;
    const seg = (m[1] ?? '').trim();
    if (seg.length === 0 || seg.includes('<')) continue;
    const rawTokens = expandAttachedWrapperTokens(seg.split(/\s+/).filter(Boolean));
    const cmdIdx = findUnwrappedBodyCmdIndex(rawTokens);
    if (hasInteractiveSudoInTokens(rawTokens.slice(0, cmdIdx))) return 'sudo';
    if (hasInteractiveSuInTokens(rawTokens, cmdIdx)) return 'su';
    const rawCmd = rawTokens[cmdIdx];
    if (rawCmd === undefined) continue;
    const base = rawCmd.replace(/^.*[\\/]/, '').toLowerCase().replace(/\.exe$/, '');
    const rawRest = rawTokens.slice(cmdIdx + 1);
    const rest = stripOutputRedirections(rawRest);
    if (rest.some(a => a === '--help' || a === '--version' || a === '-help' || a === '-version' || a === '-V' || (base === 'redis-cli' && a === '-v'))) {
      continue;
    }
    if (DB_CLIENT_BASE_NAMES.has(base) && !isDbNonInteractive(base, rest)) return base;
    if (SSH_CLIENT_BASE_NAMES.has(base)) {
      if (base === 'ftp' || base === 'telnet' || (rawRest.length > 0 && collectSshPositionals(rest).length < 2)) return base;
    }
  }
  return null;
}

export const PWSH_EXEC_FLAGS: ReadonlySet<string> = new Set(['-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if', '-outputformat', '-of', '-configurationname', '-configurationfile', '-settingsfile', '-custompipename', '-windowstyle', '-w', '-version']);

export function findPwshCommandIndex(args: readonly string[]): { cmdIdx: number; boundary: number } {
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    const head = low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
    if (head === '--' || isPwshFileFlag(head) || isPwshEncodedCommandFlag(head)) return { cmdIdx: -1, boundary: i };
    if (isPwshCommandFlag(head)) return { cmdIdx: i, boundary: i };
    if (!low.includes(':') && PWSH_EXEC_FLAGS.has(low)) i++;
  }
  return { cmdIdx: -1, boundary: args.length };
}

export function isPythonValueShortCluster(arg: string): boolean {
  return !arg.startsWith('--') && /^-[a-zA-Z]*[WX]$/.test(arg) && !/[cmWX]/.test(arg.slice(1, -1));
}

export const PY_VALUE_FLAGS: ReadonlySet<string> = new Set(['-W', '-X', '--check-hash-based-pycs']);

export function hasNodeDebuggerArg(args: readonly string[], allowInspectSubcmd = true): boolean {
  let canInspectSubcmd = allowInspectSubcmd;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') return false;
    if (arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print') { canInspectSubcmd = false; i++; continue; }
    if (arg.startsWith('--eval=') || arg.startsWith('--print=')) { canInspectSubcmd = false; continue; }
    if (arg === '--inspect' || arg.startsWith('--inspect=') || arg === '--inspect-brk' || arg.startsWith('--inspect-brk=') || arg === '--inspect-wait' || arg.startsWith('--inspect-wait=')) return true;
    if (arg.startsWith('-')) {
      if (NODE_VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    return canInspectSubcmd && arg === 'inspect';
  }
  return false;
}

export function hasCmdInteractiveKSwitch(args: readonly string[]): boolean {
  for (const arg of args) {
    const low = arg.toLowerCase();
    if (/^\/c(?:$|[=:])/.test(low)) return false;
    if (/^\/k(?:$|[=:])/.test(low)) return true;
  }
  return false;
}

export function hasPythonPdbArg(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--' || (!a.startsWith('--') && /^-[a-bd-ln-zA-VY-Z]*c/.test(a))) return false;
    if (!a.startsWith('--') && (/^-[a-bd-ln-zA-VY-Z]*mpdb$/.test(a) || (/^-[a-bd-ln-zA-VY-Z]*m$/.test(a) && args[i + 1] === 'pdb'))) {
      return true;
    }
    if (PY_VALUE_FLAGS.has(a) || isPythonValueShortCluster(a)) { i++; continue; }
    if (!a.startsWith('-')) return false;
  }
  return false;
}

const WSL_MANAGEMENT_FLAGS: ReadonlySet<string> = new Set([
  '-l', '--list', '--status', '--shutdown', '-t', '--terminate', '--unregister', '--export', '--import', '--import-in-place',
  '-s', '--set-default', '--set-version', '--set-default-version', '--update', '--install', '--mount', '--unmount', '--manage',
]);

export function isWslNonInteractive(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    const low = a.toLowerCase();
    if (low === '--' || low === '-e' || low === '--exec') return i + 1 < args.length;
    if (WSL_MANAGEMENT_FLAGS.has(low) || low.startsWith('--install=') || low.startsWith('--mount=')) return true;
    if (WSL_SESSION_VALUE_FLAGS.has(low)) { i++; continue; }
    if (low.startsWith('-')) continue;
    return true;
  }
  return false;
}
