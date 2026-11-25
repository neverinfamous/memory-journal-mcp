// @ts-nocheck
import type { SystemCommandDerived } from './system-command-context.js';
import {
  EXACT_SHELL_CHARS,
  EXACT_SHELL_CHAR_SET,
  INLINE_FLAG_SET,
  PATTERN_TOOL_SET,
  findPosixShellCAndBody,
} from './system-command-context.js';
import { AGENT_EXEC_README_URL, getUnquoted } from './utils.js';

const PKG_MANAGER_SET: ReadonlySet<string> = new Set([
  'npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe',
  'bun', 'bun.exe', 'bunx', 'bunx.cmd', 'bunx.exe', 'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe',
]);
const SHELL_CMD_SET: ReadonlySet<string> = new Set([
  'pwsh', 'powershell', 'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe',
]);
const TEXT_DATA_FLAG_SET: ReadonlySet<string> = new Set([
  '-m', '--message', '--msg',
  '--history', '--summary', '--reason', '--prompt', '--subject',
  '-b', '--body',
  '-t', '--title',
  '-n', '--notes',
  '--description',
  '-f',
  '--comment',
  '--query', '-q',
  '-h', '--header',
  '-d', '--data', '--data-raw', '--data-binary',
  '--filter',
  '--label',
  '--tag',
  '-a', '--author',
  '-p', '--print', '--test-name-pattern',
]);
const TEXT_DATA_PREFIX_SET: ReadonlySet<string> = new Set([
  '--body=', '-b=',
  '--message=', '-m=', '--msg=',
  '--history=', '--summary=', '--reason=', '--prompt=', '--subject=',
  '--title=', '-t=',
  '--notes=', '-n=',
  '--description=',
  '--comment=',
  '--query=', '-q=',
  '-h=', '--header=',
  '-d=', '--data=', '--data-raw=', '--data-binary=',
  '--filter=',
  '-f=',
  '-p=', '--print=', '--test-name-pattern=',
  'body=', 'title=', 'notes=', 'comment=', 'query=', 'message=', 'description=',
  'msg=', 'history=', 'summary=', 'reason=', 'prompt=', 'subject=',
]);

const PM_DELEGATE_VALUE_FLAGS = new Set(['-C', '--dir', '--cwd', '--prefix', '--filter', '-F', '-p', '--package']);
const PM_DELEGATE_SUBCMDS = new Set(['exec', 'x', 'dlx', 'run']);

function resolvePkgDelegatedTool(args: readonly string[]): string | undefined {
  let sawSub = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (PM_DELEGATE_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    const low = a.toLowerCase();
    if (!sawSub && PM_DELEGATE_SUBCMDS.has(low)) { sawSub = true; continue; }
    return low;
  }
  return undefined;
}

const GIT_TOP_VALUE_FLAGS = new Set([
  '-C', '-c', '--attr-source', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);

function isGitPatternOperand(derived: SystemCommandDerived): boolean {
  if (derived.cmd !== 'git' && derived.cmd !== 'git.exe') return false;
  let sub: string | undefined;
  for (let i = 0; i < derived.args.length; i++) {
    const a = derived.args[i];
    if (a === undefined || a === '--') break;
    if (GIT_TOP_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    sub = a.toLowerCase();
    break;
  }
  return sub === 'grep' || sub === 'log' || sub === 'diff';
}

const POSIX_SHELL_CMDS = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe']);

export function blockUnsafePipes(derived: SystemCommandDerived): void {
  const cmdLower = derived.cmdBasename.toLowerCase();
  const isPkgMgr = PKG_MANAGER_SET.has(cmdLower);
  const pkgSubcommand = isPkgMgr ? resolvePkgDelegatedTool(derived.args) : undefined;
  const isInvokingPatternTool = pkgSubcommand !== undefined && PATTERN_TOOL_SET.has(pkgSubcommand);
  const shouldCheckPipes = derived.payload.type === 'command'
    && derived.payload.target !== 'wsl2'
    && !PATTERN_TOOL_SET.has(derived.cmd)
    && !isInvokingPatternTool
    && !isGitPatternOperand(derived);
  if (!shouldCheckPipes) return;
  const isShell = SHELL_CMD_SET.has(cmdLower);
  const posixBodyIdx = POSIX_SHELL_CMDS.has(cmdLower) ? findPosixShellCAndBody(derived.args).bodyIdx : -1;
  const hasUnsafe = derived.args.some((arg, index) => argumentHasUnsafeShell(arg, index, derived.args, isShell, isPkgMgr, cmdLower, posixBodyIdx));
  if (!hasUnsafe) return;
  console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  console.error(`   Because 'agent-exec.ts' uses \`shell: false\`, these operators are treated as literal strings and will fail.`);
  console.error(`   To use shell features, please use a 'script' payload type or pipe natively in PowerShell.`);
  process.exit(1);
}

function argumentHasUnsafeShell(arg: string, index: number, args: string[], isShell: boolean, isPkgMgr: boolean, cmdLower: string, posixBodyIdx = -1): boolean {
  if (index === posixBodyIdx) return false;
  const previous = index > 0 ? args[index - 1] : undefined;
  if (previous !== undefined) {
    const prevLower = previous.toLowerCase();
    if (INLINE_FLAG_SET.has(prevLower)) return false;
    if (isShell && /^-[a-z]+$/i.test(previous) && prevLower.includes('c')) return false;
    if (TEXT_DATA_FLAG_SET.has(prevLower)) return false;
  }
  const twoBack = index > 1 ? args[index - 2] : undefined;
  if (isShell && twoBack !== undefined && /^-[a-z]+$/i.test(twoBack)) {
    const twoBackLower = twoBack.toLowerCase();
    if (twoBackLower.includes('c') && twoBackLower.includes('o')) return false;
  }
  if (startsWithInlineFlag(arg, isShell, cmdLower)) return false;
  const eqIdx = arg.indexOf('=');
  if (eqIdx > 0 && TEXT_DATA_PREFIX_SET.has(arg.slice(0, eqIdx + 1).toLowerCase())) return false;
  if (isShell && (arg.includes('$(') || arg.includes('`'))) return true;
  if (arg.includes('\\&') || arg.includes('\\|') || arg.includes('\\>') || arg.includes('\\<') || arg.includes('\\;')) return true;
  return unquotedContainsOperator(arg, isShell, isPkgMgr);
}

function startsWithInlineFlag(arg: string, isShell: boolean, cmdLower: string): boolean {
  const eqIdx = arg.indexOf('=');
  if (eqIdx > 0 && INLINE_FLAG_SET.has(arg.slice(0, eqIdx).toLowerCase())) return true;
  const isPwsh = cmdLower === 'pwsh' || cmdLower === 'pwsh.exe' || cmdLower === 'powershell' || cmdLower === 'powershell.exe';
  if (isShell && isPwsh) {
    const colonIdx = arg.indexOf(':');
    if (colonIdx > 0 && INLINE_FLAG_SET.has(arg.slice(0, colonIdx).toLowerCase())) return true;
  }
  if (!isShell) return false;
  const lower = arg.toLowerCase();
  if (cmdLower === 'cmd' || cmdLower === 'cmd.exe') {
    return (lower.startsWith('/c') || lower.startsWith('/k')) && arg.length > 2;
  }
  if (isPwsh) {
    return (lower.startsWith('-c:') && arg.length > 3) || (lower.startsWith('-command:') && arg.length > 9);
  }
  return lower.startsWith('-c') && arg.length > 2;
}

const STANDALONE_REDIR_TOKENS = new Set(['>>', '<<', '<<<', '2>', '1>', '2>>', '1>>', '&>', '&>>', '2>&1', '1>&2', '|&']);
const ATTACHED_REDIR_RE = /^(?:[12&]?>>?|<<?<?|\|&)|(?:2>&1|1>&2|\|&)/;

function unquotedContainsOperator(arg: string, isShell: boolean, isPkgMgr: boolean): boolean {
  const trimmed = arg.trim();
  if (EXACT_SHELL_CHAR_SET.has(trimmed) || STANDALONE_REDIR_TOKENS.has(trimmed)) return true;
  if (!/[|><&;]/.test(arg)) return false;
  const strippedAngle = getUnquoted(arg).replace(/<[^>]+>/g, ''); // codeql[js/incomplete-multi-character-sanitization]
  return EXACT_SHELL_CHARS.some(op => operatorIsUnsafe(strippedAngle, op, isShell, isPkgMgr));
}

function operatorIsUnsafe(strippedAngle: string, op: string, isShell: boolean, isPkgMgr: boolean): boolean {
  let checkStr = strippedAngle;
  if (op === '>') {
    checkStr = checkStr.replace(/=>/g, '').replace(/->/g, '');
  } else if (op === '<') {
    checkStr = checkStr.replace(/<-/g, '');
  }
  if (!checkStr.includes(op)) return false;
  const hasSpacesAround = checkStr.includes(` ${op} `) || checkStr.startsWith(`${op} `) || checkStr.endsWith(` ${op}`);
  if (checkStr.trim() === op) return true;
  if (isShell) return true;
  if (checkStr.includes('{') || checkStr.includes('[')) return false;
  if (!hasSpacesAround) return unspacedOperatorIsUnsafe(op, checkStr);
  if (isPkgMgr) return true;
  return false;
}

function unspacedOperatorIsUnsafe(op: string, checkStr: string): boolean {
  if (op === '|') return checkStr.includes('|&');
  if (op === '&&' || op === '||') return true;
  if (op === '>' || op === '<') {
    return ATTACHED_REDIR_RE.test(checkStr) || (op === '>' && /[^\s=\->]>[^\s=]/.test(checkStr));
  }
  if (op === ';') {
    return checkStr.startsWith(';') || (!checkStr.startsWith('-') && !checkStr.startsWith('/') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(checkStr));
  }
  return false;
}
