// @ts-nocheck
import path from 'node:path';
import { ExecutionContext } from './types.js';
import { applyEarlyGitGuards, applyEditorGitHeals, applyInteractiveGitBlocks } from './git-guards.js';

export function gitInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const gitCmds = ['git', 'git.exe'];
  if (!gitCmds.includes(cmdBasename) || payload.type !== 'command') return;

  const rawCwd = ctx.payload.cwd ? path.resolve(ctx.payload.cwd) : process.cwd();
  let targetCwd = rawCwd;
  let explicitCwd: string | undefined;

  const knownGitCmds = ['add', 'am', 'archive', 'bisect', 'branch', 'bundle', 'checkout', 'cherry-pick', 'citool', 'clean', 'clone', 'commit', 'describe', 'diff', 'fetch', 'format-patch', 'gc', 'gitk', 'grep', 'gui', 'init', 'log', 'merge', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'tag', 'worktree', 'config', 'difftool', 'mergetool', 'remote', 'blame', 'reflog'];

  // -C <path> is a top-level git flag and MUST appear before the git subcommand
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-C') {
      if (i + 1 < args.length) {
        const candidate = args[i + 1];
        if (!/^\d+$/.test(candidate)) {
          targetCwd = path.isAbsolute(candidate) ? candidate : path.resolve(targetCwd, candidate);
          explicitCwd = targetCwd;
          args.splice(i, 2);
          continue;
        }
      }
      i++;
    } else if (a.startsWith('-C') && a.length > 2) {
      const candidate = a.slice(2);
      if (!/^\d+$/.test(candidate)) {
        targetCwd = path.isAbsolute(candidate) ? candidate : path.resolve(targetCwd, candidate);
        explicitCwd = targetCwd;
        args.splice(i, 1);
        continue;
      }
      i++;
    } else if (a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace' || a === '--exec-path') {
      i += 2;
    } else if (a.startsWith('-')) {
      i++;
    } else {
      break;
    }
  }

  if (explicitCwd !== undefined) {
    ctx.payload.cwd = targetCwd;
  }

  if (!args.includes('--no-pager')) {
    args.unshift('--no-pager');
  }
  const gitSubCmd = args.find(a => knownGitCmds.includes(a)) || args.filter(a => !a.startsWith('-'))[0];
  const scope = { cmd: gitSubCmd, args, ctx, targetCwd, rawCwd, explicitCwd };
  if (applyEarlyGitGuards(scope)) return;
  if (applyInteractiveGitBlocks(scope)) return;
  applyEditorGitHeals(scope);
}

