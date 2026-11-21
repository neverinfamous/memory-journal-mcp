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

function hasEditFlag(cmd: string | undefined, args: readonly string[]): boolean {
  if (cmd === 'grep') return false;
  return args.includes('-e') || args.includes('--edit');
}

function hasInteractiveFlag(args: string[]): boolean {
  return args.includes('-i') || args.includes('--interactive');
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
    .with({ cmd: 'stash', args: P.when((list: string[]) => list.includes('show')) }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git stash show' to non-interactive 'git diff stash@{0} --stat'... (Frictionless Recovery)`);
      ctx.args = ['--no-pager', 'diff', 'stash@{0}', '--stat'];
      return true;
    })
    .with({ cmd: 'tag', args: P.when((list: string[]) => (list.includes('-a') || list.includes('--annotate')) && !list.includes('-m') && !list.includes('--message') && !list.includes('-F') && !list.includes('--file')) }, () => {
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
    .with({ cmd: P.union('add', 'checkout', 'reset', 'stash', 'restore'), args: P.when((list: string[]) => list.includes('-p') || list.includes('--patch')) }, ({ cmd: tool }) => {
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
  const { cmd, args } = scope;
  match({ cmd, args })
    .with({ cmd: P.union('merge', 'pull'), args: P.when(mergeNeedsNoEdit) }, ({ cmd: tool, args: matched }) => {
      if (tool === 'pull' && pullUsesRebase(matched)) return;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-edit' into 'git ${tool}' to prevent interactive editor prompt... (Frictionless Recovery)`);
      matched.push('--no-edit');
    })
    .with({ cmd: P.union('cherry-pick', 'revert'), args: P.when((list: string[]) => !list.includes('--no-edit') && !list.includes('--no-commit') && !list.includes('-n') && !list.includes('--abort') && !list.includes('--quit') && !list.includes('--skip')) }, ({ cmd: tool }) => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git ${tool}' may open an interactive editor. Automatically injecting '--no-edit'.... (Frictionless Recovery)`);
      args.push('--no-edit');
    })
    .with({ cmd: 'config', args: P.when((list: string[]) => hasEditFlag('config', list)) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git config --edit' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    })
    .with({ cmd: 'branch', args: P.when((list: string[]) => list.includes('--edit-description')) }, () => {
      console.error(`\n   💡 AGENT HINT: 'git branch --edit-description' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    })
    .otherwise(() => undefined);
}

export type { GitScope };
