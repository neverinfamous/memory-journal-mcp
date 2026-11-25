// @ts-nocheck
import { match, P } from 'ts-pattern';
import type { SystemCommandDerived } from './system-command-context.js';
import { EXACT_SHELL_CHARS, INLINE_FLAGS, PATTERN_TOOLS, findPosixShellCAndBody } from './system-command-context.js';
import { AGENT_EXEC_README_URL, getUnquoted } from './utils.js';

const PKG_MANAGERS = ['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.exe', 'bunx', 'bunx.cmd', 'bunx.exe', 'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe'];
const SHELL_CMDS = ['pwsh', 'powershell', 'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe'];
const TEXT_DATA_FLAGS: readonly string[] = [
  '-m', '--message', '--msg',
  '--history', '--summary', '--reason', '--prompt', '--subject',
  '-b', '--body',
  '-t', '--title',
  '-n', '--notes',
  '--description',
  '-f', '-F',
  '--comment',
  '--query', '-q',
  '-H', '--header',
  '-d', '--data', '--data-raw', '--data-binary',
  '--filter',
  '--label',
  '--tag',
  '-a', '--author',
  '-p', '--print', '--test-name-pattern',
];
const TEXT_DATA_PREFIXES: readonly string[] = [
  '--body=', '-b=',
  '--message=', '-m=', '--msg=',
  '--history=', '--summary=', '--reason=', '--prompt=', '--subject=',
  '--title=', '-t=',
  '--notes=', '-n=',
  '--description=',
  '--comment=',
  '--query=', '-q=',
  '-H=', '--header=',
  '-d=', '--data=', '--data-raw=', '--data-binary=',
  '--filter=',
  '-f=', '-F=',
  '-p=', '--print=', '--test-name-pattern=',
  'body=', 'title=', 'notes=', 'comment=', 'query=', 'message=', 'description=',
  'msg=', 'history=', 'summary=', 'reason=', 'prompt=', 'subject=',
];

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
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
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
  const isPkgMgr = PKG_MANAGERS.includes(cmdLower);
  const pkgSubcommand = isPkgMgr ? resolvePkgDelegatedTool(derived.args) : undefined;
  const isInvokingPatternTool = pkgSubcommand !== undefined && PATTERN_TOOLS.includes(pkgSubcommand);
  const shouldCheckPipes = match(derived.payload)
    .with({ type: 'command', target: 'wsl2' }, () => false)
    .with({ type: 'command' }, () => !PATTERN_TOOLS.includes(derived.cmd) && !isInvokingPatternTool && !isGitPatternOperand(derived))
    .otherwise(() => false);
  if (!shouldCheckPipes) return;
  const isShell = SHELL_CMDS.includes(cmdLower);
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
    if (INLINE_FLAGS.includes(prevLower)) return false;
    if (isShell && /^-[a-z]+$/i.test(previous) && prevLower.includes('c')) return false;
  }
  const twoBack = index > 1 ? args[index - 2] : undefined;
  if (isShell && twoBack !== undefined && /^-[a-z]+$/i.test(twoBack)) {
    const twoBackLower = twoBack.toLowerCase();
    if (twoBackLower.includes('c') && twoBackLower.includes('o')) return false;
  }
  if (startsWithInlineFlag(arg, isShell, cmdLower)) return false;
  if (previous !== undefined && (TEXT_DATA_FLAGS.includes(previous) || TEXT_DATA_FLAGS.includes(previous.toLowerCase()))) return false;
  if (TEXT_DATA_PREFIXES.some(prefix => arg.startsWith(prefix) || arg.toLowerCase().startsWith(prefix))) return false;
  return match(arg)
    .with(P.when((value: string) => isShell && (value.includes('$(') || value.includes('`'))), () => true)
    .with(P.when(value => value.includes('\\&') || value.includes('\\|') || value.includes('\\>') || value.includes('\\<') || value.includes('\\;')), () => true)
    .with(P.when((value: string) => unquotedContainsOperator(value, isShell, isPkgMgr)), () => true)
    .otherwise(() => false);
}

function startsWithInlineFlag(arg: string, isShell: boolean, cmdLower: string): boolean {
  const lower = arg.toLowerCase();
  const isPwsh = cmdLower === 'pwsh' || cmdLower === 'pwsh.exe' || cmdLower === 'powershell' || cmdLower === 'powershell.exe';
  if (INLINE_FLAGS.some(flag => lower.startsWith(`${flag}=`) || (isShell && isPwsh && lower.startsWith(`${flag}:`)))) {
    return true;
  }
  if (!isShell) return false;
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
  if (EXACT_SHELL_CHARS.includes(trimmed) || STANDALONE_REDIR_TOKENS.has(trimmed)) return true;
  const unquoted = getUnquoted(arg);
  return EXACT_SHELL_CHARS.some(op => operatorIsUnsafe(unquoted, op, isShell, isPkgMgr));
}

function operatorIsUnsafe(unquoted: string, op: string, isShell: boolean, isPkgMgr: boolean): boolean {
  let checkStr = unquoted;
  checkStr = checkStr.replace(/<[^>]+>/g, ''); // codeql[js/incomplete-multi-character-sanitization]
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
