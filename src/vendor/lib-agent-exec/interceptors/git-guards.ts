// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { match, P } from 'ts-pattern';
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
  'commit', 'merge', 'tag', 'notes', 'config', 'rebase', 'cherry-pick', 'revert',
]);

const GIT_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);
const GIT_GUARD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-m', '--message', '-F', '--file', '-am', '-C', '-c', '--author', '--date',
  '--template', '--cleanup', '--trailer', '--fixup', '--squash', '--reuse-message', '--reedit-message',
]);
const SHORT_FLAG_RE_BY_CHARS: Readonly<Record<string, RegExp>> = {
  e: /^-[a-zA-Z]*e[a-zA-Z]*$/,
  i: /^-[a-zA-Z]*i[a-zA-Z]*$/,
  a: /^-[a-zA-Z]*a[a-zA-Z]*$/,
  p: /^-[a-zA-Z]*p[a-zA-Z]*$/,
};

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

function hasGitSubcmdFlag(args: readonly string[], shortChars: string, longFlags: readonly string[], expectedCmd?: string): boolean {
  const shortRe = shortChars.length > 0 ? (SHORT_FLAG_RE_BY_CHARS[shortChars] ?? null) : null;
  const startIdx = findGitSubcmdFlagStart(args, expectedCmd);
  const booleanM = expectedCmd !== undefined && GIT_BOOLEAN_M_CMDS.has(expectedCmd);
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if ((!booleanM || (a !== '-m' && a !== '--message' && a !== '-am')) && (GIT_GUARD_VALUE_FLAGS.has(a) || (a === '-t' && (expectedCmd === 'commit' || expectedCmd === 'tag')))) { i++; continue; }
    if (!a.startsWith('-')) continue;
    if (longFlags.includes(a)) return true;
    if (a.startsWith('--')) continue;
    const inlineValIdx = booleanM ? a.search(/F/) : a.search(/[mF]/);
    const shortCluster = inlineValIdx === -1 ? a : a.slice(0, inlineValIdx);
    if (shortCluster.length > 1 && shortRe !== null && shortRe.test(shortCluster)) return true;
  }
  return false;
}

function hasEditFlag(cmd: string | undefined, args: readonly string[]): boolean {
  if (cmd === undefined || !EDITOR_CAPABLE_GIT_SUBCMDS.has(cmd)) return false;
  return hasGitSubcmdFlag(args, (cmd === 'commit' || cmd === 'tag' || cmd === 'config' || cmd === 'cherry-pick' || cmd === 'revert') ? 'e' : '', ['-e', '--edit'], cmd);
}

function getStashSubaction(args: readonly string[]): { action: string | undefined; ref: string } {
  const stashStart = findGitSubcmdFlagStart(args, 'stash');
  if (stashStart === 0) return { action: undefined, ref: 'stash@{0}' };
  const STASH_VALUE_FLAGS = new Set(['-m', '--message', '-c']);
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
    if (/^stash@\{\d+\}$/.test(a)) {
      ref = a;
      break;
    }
    if (/^\d+$/.test(a)) {
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
      (!a.startsWith('--') && /^-[a-zA-Z]*[mF]/.test(a))
    ) {
      return true;
    }
    if (GIT_GUARD_VALUE_FLAGS.has(a) || a === '-t') { i += 1; }
  }
  return false;
}

function hasInteractiveFlag(args: readonly string[], expectedCmd?: string): boolean {
  return hasGitSubcmdFlag(args, 'i', ['--interactive'], expectedCmd);
}

export function applyEarlyGitGuards(scope: GitScope): boolean {
  const { cmd, args, ctx, targetCwd, rawCwd, explicitCwd } = scope;
  return match({ cmd, args, ctx })
    .with({ cmd: P.union('difftool', 'mergetool') }, ({ cmd: tool }) => {
      console.error(`\n   💡 AGENT HINT: 'git ${tool}' launches interactive UI tools and will hang.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
      console.error(`   Please use standard 'git diff' or 'git merge' instead.`);
      process.exit(1);
    })
    .with({ args: P.when((list: string[]) => hasEditFlag(cmd, list)) }, ({ cmd: tool }) => {
      console.error(`\n   💡 AGENT HINT: 'git ${tool} -e / --edit' requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
      process.exit(1);
    })
    .with({ cmd: 'bisect' }, () => {
      console.error(`\n   💡 AGENT HINT: 'git bisect' requires interactive input at each step and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
      process.exit(1);
    })
    .with({ cmd: 'commit' }, () => {
      rewriteGitCommit(ctx, args, targetCwd, rawCwd, explicitCwd);
      return true;
    })
    .with({ cmd: P.union('log', 'shortlog', 'show', 'diff', 'status') }, ({ cmd: tool }) => {
      if (tool === undefined) return false;
      rewriteGitInspection(ctx, args, tool, targetCwd, rawCwd, explicitCwd);
      return true;
    })
    .otherwise(() => false);
}

export function applyInteractiveGitBlocks(scope: GitScope): boolean {
  const { cmd, args, ctx } = scope;
  return match({ cmd, args, ctx })
    .with({ cmd: 'stash', args: P.when((list: string[]) => getStashSubaction(list).action === 'show') }, ({ args: list }) => {
      const { ref } = getStashSubaction(list);
      const stashSubIdx = findGitSubcmdFlagStart(list, 'stash') - 1;
      const globalPrefix = stashSubIdx > 0 ? list.slice(0, stashSubIdx) : [];
      const prefix = globalPrefix.includes('--no-pager') ? globalPrefix : [...globalPrefix, '--no-pager'];
      ctx.args = [...prefix, 'diff', ref, '--stat'];
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git stash show' to non-interactive 'git diff ${ref} --stat'... (Frictionless Recovery)`);
      return true;
    })
    .with({ cmd: 'tag', args: P.when((list: string[]) => hasGitSubcmdFlag(list, 'a', ['--annotate'], 'tag') && !hasTagAnnotationValue(list)) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git tag -a' requires an interactive editor without '-m' or '-F'. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    })
    .with({ cmd: 'clean', args: P.when((list: string[]) => hasInteractiveFlag(list, 'clean')) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git clean -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
      process.exit(1);
    })
    .with({ cmd: 'add', args: P.when((list: string[]) => hasInteractiveFlag(list, 'add')) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git add -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
      process.exit(1);
    })
    .with(
      P.when((m) =>
        (m.cmd === 'add' || m.cmd === 'checkout' || m.cmd === 'reset' || m.cmd === 'stash' || m.cmd === 'restore')
        && hasGitSubcmdFlag(m.args, 'p', ['--patch'], m.cmd)),
      ({ cmd: tool }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${tool} -p' (patch selection) is highly interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Do not use patch mode for this command.`);
        process.exit(1);
      }
    )
    .with(
      P.when((m) =>
        (m.cmd === 'rebase' || m.cmd === 'pull')
        && (hasInteractiveFlag(m.args, m.cmd) || hasFlagBeforeDoubleDash(m.args, (arg) => arg.startsWith('--rebase=interactive')))),
      ({ cmd: tool }) => {
      console.error(`\n   💡 AGENT HINT: 'git ${tool}' with interactive mode requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Use non-interactive ${tool} or specific commands.`);
      process.exit(1);
    })
    .otherwise(() => false);
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

export function applyEditorGitHeals(scope: GitScope): void {
  const { cmd, args, ctx } = scope;
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = args; };
  match({ cmd, args })
    .with({ cmd: P.union('merge', 'pull'), args: P.when(mergeNeedsNoEdit) }, ({ cmd: tool, args: matched }) => {
      if (tool === 'pull' && pullUsesRebase(matched)) return;
      insertNoEditFlag(matched);
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-edit' into 'git ${tool}' to prevent interactive editor prompt... (Frictionless Recovery)`);
    })
    .with({ cmd: P.union('cherry-pick', 'revert'), args: P.when((list: string[]) => !hasFlagBeforeDoubleDash(list, (arg) => ['--no-edit', '--no-commit', '-n', '--abort', '--continue', '--quit', '--skip'].includes(arg))) }, ({ cmd: tool }) => {
      insertNoEditFlag(args);
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git ${tool}' may open an interactive editor. Automatically injecting '--no-edit'.... (Frictionless Recovery)`);
    })
    .with({ cmd: 'branch', args: P.when((list: string[]) => hasFlagBeforeDoubleDash(list, (arg) => arg === '--edit-description')) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git branch --edit-description' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    })
    .otherwise(() => undefined);
}

export type { GitScope };
