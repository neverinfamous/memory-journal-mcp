// @ts-nocheck
import { match, P } from 'ts-pattern';
import type { SystemCommandDerived } from './system-command-context.js';
import { EXACT_SHELL_CHARS, INLINE_FLAGS, PATTERN_TOOLS } from './system-command-context.js';
import { AGENT_EXEC_README_URL, getUnquoted } from './utils.js';

const PKG_MANAGERS = ['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun', 'bun.exe', 'npx', 'npx.cmd'];
const SHELL_CMDS = ['pwsh', 'powershell', 'bash', 'sh', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe'];
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
  'body=', 'title=', 'notes=', 'comment=', 'query=', 'message=', 'description=',
  'msg=', 'history=', 'summary=', 'reason=', 'prompt=', 'subject=',
];

export function blockUnsafePipes(derived: SystemCommandDerived): void {
  const cmdLower = derived.cmdBasename.toLowerCase();
  const isPkgMgr = PKG_MANAGERS.includes(cmdLower);
  const pkgSubcommand = isPkgMgr ? derived.args.find(arg => !arg.startsWith('-'))?.toLowerCase() : undefined;
  const isInvokingPatternTool = pkgSubcommand !== undefined && PATTERN_TOOLS.includes(pkgSubcommand);
  const shouldCheckPipes = match(derived.payload)
    .with({ type: 'command', target: 'wsl2' }, () => false)
    .with({ type: 'command' }, () => !PATTERN_TOOLS.includes(derived.cmd) && !isInvokingPatternTool)
    .otherwise(() => false);
  if (!shouldCheckPipes) return;
  const isShell = SHELL_CMDS.includes(cmdLower);
  const hasUnsafe = derived.args.some((arg, index) => argumentHasUnsafeShell(arg, index, derived.args, isShell, isPkgMgr));
  if (!hasUnsafe) return;
  console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  console.error(`   Because 'agent-exec.ts' uses \`shell: false\`, these operators are treated as literal strings and will fail.`);
  console.error(`   To use shell features, please use a 'script' payload type or pipe natively in PowerShell.`);
  process.exit(1);
}

function argumentHasUnsafeShell(arg: string, index: number, args: string[], isShell: boolean, isPkgMgr: boolean): boolean {
  const previous = index > 0 ? args[index - 1] : undefined;
  if (previous !== undefined && INLINE_FLAGS.includes(previous.toLowerCase())) return false;
  if (startsWithInlineFlag(arg)) return false;
  if (previous !== undefined && TEXT_DATA_FLAGS.includes(previous.toLowerCase())) return false;
  if (TEXT_DATA_PREFIXES.some(prefix => arg.toLowerCase().startsWith(prefix))) return false;
  return match(arg)
    .with(P.when((value: string) => isShell && (value.includes('$(') || value.includes('`'))), () => true)
    .with(P.when(value => value.includes('\\&') || value.includes('\\|') || value.includes('\\>') || value.includes('\\<') || value.includes('\\;')), () => true)
    .with(P.when((value: string) => unquotedContainsOperator(value, isShell, isPkgMgr)), () => true)
    .otherwise(() => false);
}

function startsWithInlineFlag(arg: string): boolean {
  const lower = arg.toLowerCase();
  return INLINE_FLAGS.some(flag => lower.startsWith(`${flag}=`) || (flag.length === 2 && lower.startsWith(flag) && arg.length > 2));
}

function unquotedContainsOperator(arg: string, isShell: boolean, isPkgMgr: boolean): boolean {
  if (EXACT_SHELL_CHARS.includes(arg.trim())) return true;
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
  if (!hasSpacesAround) return unspacedOperatorIsUnsafe(op);
  if (isPkgMgr) return true;
  return false;
}

function unspacedOperatorIsUnsafe(op: string): boolean {
  if (op === '|') return false;
  if (op === '&&' || op === '||') return true;
  return false;
}
