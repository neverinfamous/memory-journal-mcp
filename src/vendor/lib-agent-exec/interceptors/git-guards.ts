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

const GIT_GUARD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-m', '--message', '-F', '--file', '-am', '-ma', '-C', '-c', '--author', '--date',
  '-t', '--template', '--cleanup', '--trailer', '--fixup', '--squash', '--reuse-message', '--reedit-message',
]);

function hasGitSubcmdFlag(args: readonly string[], shortChars: string, longFlags: readonly string[]): boolean {
  const shortRe = shortChars.length > 0 ? new RegExp(`^-[a-zA-Z]*[${shortChars}][a-zA-Z]*$`) : null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (GIT_GUARD_VALUE_FLAGS.has(a)) { i++; continue; }
    if (!a.startsWith('-')) continue;
    if (longFlags.includes(a)) return true;
    if (a.startsWith('-m') || a.startsWith('-F') || a.startsWith('-am') || a.startsWith('-ma') || a.startsWith('--')) continue;
    if (shortRe !== null && shortRe.test(a)) return true;
  }
  return false;
}

function hasEditFlag(cmd: string | undefined, args: readonly string[]): boolean {
  if (cmd === undefined || !EDITOR_CAPABLE_GIT_SUBCMDS.has(cmd)) return false;
  return hasGitSubcmdFlag(args, cmd === 'commit' ? 'e' : '', ['-e', '--edit']);
}

function getStashSubaction(args: readonly string[]): { action: string | undefined; ref: string } {
  const stashIdx = args.indexOf('stash');
  if (stashIdx === -1) return { action: undefined, ref: 'stash@{0}' };
  const STASH_VALUE_FLAGS = new Set(['-m', '--message', '-c']);
  let action: string | undefined;
  let ref = 'stash@{0}';
  for (let i = stashIdx + 1; i < args.length; i++) {
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
  }
  return { action, ref };
}

function hasTagAnnotationValue(args: readonly string[]): boolean {
  for (const a of args) {
    if (a === '--') break;
    if (a === '-m' || a.startsWith('-m') || a === '--message' || a.startsWith('--message=') ||
      a === '-F' || a.startsWith('-F') || a === '--file' || a.startsWith('--file=')) {
      return true;
    }
  }
  return false;
}

function hasInteractiveFlag(args: readonly string[]): boolean {
  return hasGitSubcmdFlag(args, 'i', ['--interactive']);
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
      ctx.args = ['--no-pager', 'diff', ref, '--stat'];
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git stash show' to non-interactive 'git diff ${ref} --stat'... (Frictionless Recovery)`);
      return true;
    })
    .with({ cmd: 'tag', args: P.when((list: string[]) => hasGitSubcmdFlag(list, 'a', ['--annotate']) && !hasTagAnnotationValue(list)) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git tag -a' requires an interactive editor without '-m' or '-F'. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    })
    .with({ cmd: 'clean', args: P.when(hasInteractiveFlag) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git clean -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
      process.exit(1);
    })
    .with({ cmd: 'add', args: P.when(hasInteractiveFlag) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git add -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
      process.exit(1);
    })
    .with({ cmd: P.union('add', 'checkout', 'reset', 'stash', 'restore'), args: P.when((list: string[]) => hasGitSubcmdFlag(list, 'p', ['--patch'])) }, ({ cmd: tool }) => {
      console.error(`\n   💡 AGENT HINT: 'git ${tool} -p' (patch selection) is highly interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Do not use patch mode for this command.`);
      process.exit(1);
    })
    .with({ cmd: P.union('rebase', 'pull'), args: P.when((list: string[]) => hasInteractiveFlag(list) || list.some((arg) => arg.startsWith('--rebase=interactive'))) }, ({ cmd: tool }) => {
      console.error(`\n   💡 AGENT HINT: 'git ${tool}' with interactive mode requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Use non-interactive ${tool} or specific commands.`);
      process.exit(1);
    })
    .otherwise(() => false);
}

function mergeNeedsNoEdit(args: string[]): boolean {
  if (args.includes('--no-edit') || args.includes('--abort') || args.includes('--continue') || args.includes('--quit')) return false;
  if (args.some((arg) => arg === '-m' || arg.startsWith('-m') || arg === '--message' || arg.startsWith('--message='))) return false;
  return true;
}

function pullUsesRebase(args: string[]): boolean {
  return args.some((arg) => arg === '-r' || arg === '--rebase' || (arg.startsWith('--rebase=') && arg !== '--rebase=false'));
}

export function applyEditorGitHeals(scope: GitScope): void {
  const { cmd, args, ctx } = scope;
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = args; };
  match({ cmd, args })
    .with({ cmd: P.union('merge', 'pull'), args: P.when(mergeNeedsNoEdit) }, ({ cmd: tool, args: matched }) => {
      if (tool === 'pull' && pullUsesRebase(matched)) return;
      matched.push('--no-edit');
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-edit' into 'git ${tool}' to prevent interactive editor prompt... (Frictionless Recovery)`);
    })
    .with({ cmd: P.union('cherry-pick', 'revert'), args: P.when((list: string[]) => !list.includes('--no-edit') && !list.includes('--no-commit') && !list.includes('-n') && !list.includes('--abort') && !list.includes('--continue') && !list.includes('--quit') && !list.includes('--skip')) }, ({ cmd: tool }) => {
      args.push('--no-edit');
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git ${tool}' may open an interactive editor. Automatically injecting '--no-edit'.... (Frictionless Recovery)`);
    })
    .with({ cmd: 'branch', args: P.when((list: string[]) => list.includes('--edit-description')) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git branch --edit-description' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    })
    .otherwise(() => undefined);
}

export type { GitScope };
