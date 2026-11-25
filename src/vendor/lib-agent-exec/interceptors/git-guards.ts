// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import type { ExecutionContext } from './types.js';
import { rewriteGitCommit } from './git-commit-rewrite.js';
import { rewriteGitInspection } from './git-history-rewrite.js';

interface GitScope {
  cmd: string | undefined;
  args: string[];
  ctx: ExecutionContext;
  targetCwd: string;
  rawCwd: string;
  explicitCwd: string | undefined;
}

const EDITOR_CAPABLE_GIT_SUBCMDS: ReadonlySet<string> = new Set([
  'add', 'commit', 'merge', 'tag', 'notes', 'config', 'rebase', 'cherry-pick', 'revert',
]);
const EDITOR_CAPABLE_SHORT_E_SUBCMDS: ReadonlySet<string> = new Set([
  'add', 'commit', 'merge', 'tag', 'config', 'cherry-pick', 'revert',
]);
const STASH_VALUE_FLAGS: ReadonlySet<string> = new Set(['-m', '--message', '-c']);
const GIT_INSPECT_CMDS: ReadonlySet<string> = new Set(['log', 'shortlog', 'show', 'diff', 'status']);
const PATCH_MODE_CMDS: ReadonlySet<string> = new Set(['add', 'checkout', 'reset', 'stash', 'restore']);
const NO_EDIT_BYPASS_FLAGS: ReadonlySet<string> = new Set(['--no-edit', '--no-commit', '-n', '--abort', '--continue', '--quit', '--skip']);

const GIT_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-C', '-c', '--attr-source', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);
const GIT_GUARD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-m', '--message', '-F', '--file', '-am', '-C', '-c', '--author', '--date',
  '--template', '--cleanup', '--trailer', '--fixup', '--squash', '--reuse-message', '--reedit-message',
]);
const GIT_GUARD_LONG_VALUE_FLAGS: readonly string[] = [
  '--message', '--file', '--author', '--date', '--template', '--cleanup',
  '--trailer', '--fixup', '--squash', '--reuse-message', '--reedit-message',
];
const SHORT_FLAG_RE_BY_CHARS: Readonly<Record<string, RegExp>> = {
  e: /^-[a-zA-Z]*e[a-zA-Z]*$/,
  i: /^-[a-zA-Z]*i[a-zA-Z]*$/,
  a: /^-[a-zA-Z]*a[a-zA-Z]*$/,
  p: /^-[a-zA-Z]*p[a-zA-Z]*$/,
};

function matchesLongFlagOrPrefix(arg: string, longFlags: readonly string[], minPrefixLenOverride?: number): boolean {
  if (!arg.startsWith('--') || arg.includes('=')) return longFlags.includes(arg);
  for (const flag of longFlags) {
    if (!flag.startsWith('--')) continue;
    if (arg === flag) return true;
    const minLen = minPrefixLenOverride ?? (flag.length <= 6 ? 4 : 5);
    if (arg.length >= minLen && flag.startsWith(arg)) return true;
  }
  return false;
}

const MESSAGE_FLAG_LIST: readonly string[] = ['--message'];
const INLINE_F_RE = /F/;
const INLINE_DEFAULT_MF_RE = /[mF]/;
const STASH_REF_EXACT_RE = /^stash@\{\d+\}$/;
const DIGITS_ONLY_RE = /^\d+$/;
const TAG_ANNO_VALUE_CLUSTER_RE = /^-[a-tv-zA-Z]*[mF]/;
const TAG_ANNO_SHORT_CLUSTER_RE = /^-[a-zA-Z]*[asu]/;

function isGitGuardValueFlag(arg: string, booleanM: boolean, expectedCmd?: string): boolean {
  if (booleanM && (arg === '-m' || arg === '-am' || matchesLongFlagOrPrefix(arg, MESSAGE_FLAG_LIST, 5))) return false;
  if (GIT_GUARD_VALUE_FLAGS.has(arg) || (arg === '-t' && (expectedCmd === 'commit' || expectedCmd === 'tag'))) return true;
  return matchesLongFlagOrPrefix(arg, GIT_GUARD_LONG_VALUE_FLAGS, 5);
}

function findGitSubcmdFlagStart(args: readonly string[], expectedCmd?: string): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (GIT_GLOBAL_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (expectedCmd === undefined || a === expectedCmd) return i + 1;
    break;
  }
  return 0;
}

const GIT_BOOLEAN_M_CMDS: ReadonlySet<string> = new Set(['checkout', 'restore', 'rebase', 'reset', 'add']);
const INLINE_VAL_RE_BY_CMD = new Map<string, RegExp>([
  ['merge', /[mFs]/],
  ['tag', /[mFu]/],
  ['commit', /[mFCct]/],
]);

function hasGitSubcmdFlag(args: readonly string[], shortChars: string, longFlags: readonly string[], expectedCmd?: string): boolean {
  const shortRe = shortChars.length > 0 ? (SHORT_FLAG_RE_BY_CHARS[shortChars] ?? null) : null;
  const startIdx = findGitSubcmdFlagStart(args, expectedCmd);
  const booleanM = expectedCmd !== undefined && GIT_BOOLEAN_M_CMDS.has(expectedCmd);
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (isGitGuardValueFlag(a, booleanM, expectedCmd)) { i++; continue; }
    if (!a.startsWith('-')) continue;
    if (matchesLongFlagOrPrefix(a, longFlags)) return true;
    if (a.startsWith('--')) continue;
    const inlineValIdx = a.search(booleanM ? INLINE_F_RE : (INLINE_VAL_RE_BY_CMD.get(expectedCmd ?? '') ?? INLINE_DEFAULT_MF_RE));
    const shortCluster = inlineValIdx === -1 ? a : a.slice(0, inlineValIdx);
    if (shortCluster.length > 1 && shortRe !== null && shortRe.test(shortCluster)) return true;
    if (inlineValIdx === a.length - 1) i++;
  }
  return false;
}

function hasEditFlag(cmd: string | undefined, args: readonly string[]): boolean {
  if (cmd === undefined || !EDITOR_CAPABLE_GIT_SUBCMDS.has(cmd)) return false;
  return hasGitSubcmdFlag(args, EDITOR_CAPABLE_SHORT_E_SUBCMDS.has(cmd) ? 'e' : '', ['-e', '--edit'], cmd);
}

function getStashSubaction(args: readonly string[]): { action: string | undefined; ref: string } {
  const stashStart = findGitSubcmdFlagStart(args, 'stash');
  if (stashStart === 0) return { action: undefined, ref: 'stash@{0}' };
  let action: string | undefined;
  let ref = 'stash@{0}';
  for (let i = stashStart; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (STASH_VALUE_FLAGS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    if (action === undefined) {
      action = a;
      continue;
    }
    if (STASH_REF_EXACT_RE.test(a)) {
      ref = a;
      break;
    }
    if (DIGITS_ONLY_RE.test(a)) {
      ref = `stash@{${a}}`;
      break;
    }
  }
  return { action, ref };
}

function hasTagAnnotationValue(args: readonly string[]): boolean {
  const startIdx = findGitSubcmdFlagStart(args, 'tag');
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (
      a === '-m' || a.startsWith('--message=') || a === '--message' ||
      a === '-F' || a.startsWith('--file=') || a === '--file' ||
      (!a.startsWith('--') && TAG_ANNO_VALUE_CLUSTER_RE.test(a))
    ) {
      return true;
    }
    if (GIT_GUARD_VALUE_FLAGS.has(a) || a === '-t' || a === '-u' || a === '--local-user') { i += 1; }
  }
  return false;
}

function tagNeedsAnnotationMessage(args: readonly string[]): boolean {
  if (hasTagAnnotationValue(args)) return false;
  const startIdx = findGitSubcmdFlagStart(args, 'tag');
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--annotate' || a === '--sign' || a === '-u' || a === '--local-user' || a.startsWith('--local-user=')) {
      return true;
    }
    if (!a.startsWith('--') && a.startsWith('-')) {
      if (TAG_ANNO_SHORT_CLUSTER_RE.test(a)) return true;
    }
    if (GIT_GUARD_VALUE_FLAGS.has(a) || a === '-t') i += 1;
  }
  return false;
}

function hasInteractiveFlag(args: readonly string[], expectedCmd?: string): boolean {
  return hasGitSubcmdFlag(args, 'i', ['--interactive'], expectedCmd);
}

export function applyEarlyGitGuards(scope: GitScope): boolean {
  const { cmd, args, ctx, targetCwd, rawCwd, explicitCwd } = scope;
  if (cmd === 'difftool' || cmd === 'mergetool') {
    console.error(`\n   💡 AGENT HINT: 'git ${cmd}' launches interactive UI tools and will hang.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
    console.error(`   Please use standard 'git diff' or 'git merge' instead.`);
    process.exit(1);
  }
  if (hasEditFlag(cmd, args)) {
    console.error(`\n   💡 AGENT HINT: 'git ${cmd} -e / --edit' requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }
  if (cmd === 'bisect') {
    console.error(`\n   💡 AGENT HINT: 'git bisect' requires interactive input at each step and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }
  if (cmd === 'commit') {
    rewriteGitCommit(ctx, args, targetCwd, rawCwd, explicitCwd);
    return true;
  }
  if (cmd !== undefined && GIT_INSPECT_CMDS.has(cmd)) {
    rewriteGitInspection(ctx, args, cmd, targetCwd, rawCwd, explicitCwd);
    return true;
  }
  return false;
}

export function applyInteractiveGitBlocks(scope: GitScope): boolean {
  const { cmd, args, ctx } = scope;
  if (cmd === 'stash') {
    const stash = getStashSubaction(args);
    if (stash.action === 'show') {
      const stashSubIdx = findGitSubcmdFlagStart(args, 'stash') - 1;
      const globalPrefix = stashSubIdx > 0 ? args.slice(0, stashSubIdx) : [];
      const prefix = globalPrefix.includes('--no-pager') ? globalPrefix : [...globalPrefix, '--no-pager'];
      ctx.args = [...prefix, 'diff', stash.ref, '--stat'];
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git stash show' to non-interactive 'git diff ${stash.ref} --stat'... (Frictionless Recovery)`);
      return true;
    }
  }
  if (cmd === 'tag' && tagNeedsAnnotationMessage(args)) {
    console.error(`\n   💡 AGENT HINT: 'git tag -a / -s / -u' requires an interactive editor without '-m' or '-F'. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if ((cmd === 'clean' || cmd === 'add') && hasInteractiveFlag(args, cmd)) {
    console.error(`\n   💡 AGENT HINT: 'git ${cmd} -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }
  if (cmd !== undefined && PATCH_MODE_CMDS.has(cmd) && hasGitSubcmdFlag(args, 'p', ['--patch'], cmd)) {
    console.error(`\n   💡 AGENT HINT: 'git ${cmd} -p' (patch selection) is highly interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Do not use patch mode for this command.`);
    process.exit(1);
  }
  if (
    (cmd === 'rebase' || cmd === 'pull') &&
    (hasInteractiveFlag(args, cmd) || hasFlagBeforeDoubleDash(args, (arg) => arg.startsWith('--rebase=i') && '--rebase=interactive'.startsWith(arg)))
  ) {
    console.error(`\n   💡 AGENT HINT: 'git ${cmd}' with interactive mode requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Use non-interactive ${cmd} or specific commands.`);
    process.exit(1);
  }
  return false;
}

function hasFlagBeforeDoubleDash(args: readonly string[], pred: (arg: string) => boolean): boolean {
  for (const arg of args) {
    if (arg === '--') break;
    if (pred(arg)) return true;
  }
  return false;
}

function insertNoEditFlag(args: string[]): void {
  const ddIdx = args.indexOf('--');
  if (ddIdx !== -1) args.splice(ddIdx, 0, '--no-edit');
  else args.push('--no-edit');
}

function mergeNeedsNoEdit(args: string[]): boolean {
  if (hasFlagBeforeDoubleDash(args, (arg) => arg === '--no-edit' || arg === '--abort' || arg === '--continue' || arg === '--quit')) return false;
  if (hasFlagBeforeDoubleDash(args, (arg) => arg === '-m' || arg.startsWith('-m') || arg === '--message' || arg.startsWith('--message='))) return false;
  return true;
}

function pullUsesRebase(args: string[]): boolean {
  return hasFlagBeforeDoubleDash(args, (arg) => arg === '-r' || arg === '--rebase' || (arg.startsWith('--rebase=') && arg !== '--rebase=false'));
}

const EDIT_DESC_FLAG_LIST: readonly string[] = ['--edit-description'];

export function applyEditorGitHeals(scope: GitScope): void {
  const { cmd, args, ctx } = scope;
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = args; };
  if ((cmd === 'merge' || cmd === 'pull') && mergeNeedsNoEdit(args)) {
    if (cmd === 'pull' && pullUsesRebase(args)) return;
    insertNoEditFlag(args);
    syncArgs();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-edit' into 'git ${cmd}' to prevent interactive editor prompt... (Frictionless Recovery)`);
    return;
  }
  if ((cmd === 'cherry-pick' || cmd === 'revert') && !hasFlagBeforeDoubleDash(args, (arg) => NO_EDIT_BYPASS_FLAGS.has(arg))) {
    insertNoEditFlag(args);
    syncArgs();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git ${cmd}' may open an interactive editor. Automatically injecting '--no-edit'.... (Frictionless Recovery)`);
    return;
  }
  if (cmd === 'branch' && hasFlagBeforeDoubleDash(args, (arg) => matchesLongFlagOrPrefix(arg, EDIT_DESC_FLAG_LIST, 4))) {
    console.error(`\n   💡 AGENT HINT: 'git branch --edit-description' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
}

export type { GitScope };
