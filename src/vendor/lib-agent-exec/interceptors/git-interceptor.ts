// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG, findEcosystemScript } from '../utils.js';
import { match, P } from 'ts-pattern';
import { ExecutionContext } from './types.js';

export function gitInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const gitCmds = ['git', 'git.exe'];
  if (!gitCmds.includes(cmdBasename) || payload.type !== 'command') return;

  if (!args.includes('--no-pager')) {
    args.unshift('--no-pager');
  }
  const knownGitCmds = ['add', 'am', 'archive', 'bisect', 'branch', 'bundle', 'checkout', 'cherry-pick', 'citool', 'clean', 'clone', 'commit', 'describe', 'diff', 'fetch', 'format-patch', 'gc', 'gitk', 'grep', 'gui', 'init', 'log', 'merge', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'tag', 'worktree', 'config', 'difftool', 'mergetool', 'remote', 'blame', 'reflog'];
  const gitSubCmd = args.find(a => knownGitCmds.includes(a)) || args.filter(a => !a.startsWith('-'))[0];
  
  match({ cmd: gitSubCmd, args, ctx })
    .with(
      { cmd: P.union('difftool', 'mergetool') },
      ({ cmd }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${cmd}' launches interactive UI tools and will hang.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
        console.error(`   Please use standard 'git diff' or 'git merge' instead.`);
        process.exit(1);
      }
    )
    .with(
      { args: P.when((a: string[]) => a.includes('-e') || a.includes('--edit')) },
      ({ cmd }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${cmd} -e / --edit' requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'bisect' },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git bisect' requires interactive input at each step and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'commit' },
      ({ args, ctx }) => {
        const cwd = ctx.payload.cwd || process.cwd();
        const hasWrapper = findEcosystemScript(cwd, 'commit.ts') !== null;
        const mIndex = args.findIndex(a => a === '-m' || a === '--message');
        
        if (mIndex !== -1 && mIndex + 1 < args.length) {
          if (hasWrapper) {
            const message = args[mIndex + 1];
            console.error(`\n   💡 AGENT HINT: 'git commit' is intercepted for safety.`);
            console.error(`   🛠️ AUTONOMOUS HEALING: Transparently rewriting to 'bun .\\.agents\\scripts\\commit.ts' with default scores... (Frictionless Recovery)`);
            ctx.cmdBasename = 'bun';
            ctx.args = ['.\\.agents\\scripts\\commit.ts', '--msg', message, '--impact', '0.5', '--confidence', '0.5', '--validation', 'passed'];
            return;
          } else {
            return; // No wrapper, allow native non-interactive commit
          }
        }
        
        if (hasWrapper) {
          console.error(`\n   💡 AGENT HINT: 'git commit' is strictly forbidden via the shell.\n${AUTONOMOUS_HEALING_MSG}`);
          console.error(`   You must use the designated wrapper instead: bun .\\.agents\\scripts\\commit.ts`);
          process.exit(1);
        } else {
          console.error(`\n   💡 AGENT HINT: 'git commit' without '-m' will open an interactive editor and hang.\n${AUTONOMOUS_HEALING_MSG}`);
          console.error(`   Because 'agent-exec.ts' is non-interactive, you MUST provide '-m' or '--message'.`);
          process.exit(1);
        }
      }
    )
    .with(
      { cmd: P.union('log', 'shortlog', 'show') },
      ({ ctx, args, cmd }) => {
        const cwd = ctx.payload.cwd || process.cwd();
        if (findEcosystemScript(cwd, 'get-git-history-json.ts') !== null) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git ${cmd}' to 'bun .\\.agents\\scripts\\get-git-history-json.ts' to prevent text dumps... (Frictionless Recovery)`);
          ctx.cmdBasename = 'bun';
          ctx.args = ['.\\.agents\\scripts\\get-git-history-json.ts', '--limit', '10'];
          if (cmd === 'show') {
            ctx.args.push('--stats');
          }
          const rangeArg = args.find(a => !a.startsWith('-') && a !== cmd && a !== '--no-pager');
          if (rangeArg) {
            ctx.args.push('--range', rangeArg);
          }
          return;
        }
        // Fallback to native (with --no-pager already injected)
        return;
      }
    )
    .with(
      { cmd: 'stash', args: P.when((a: string[]) => a.includes('show')) },
      ({ ctx }) => {
        const cwd = ctx.payload.cwd || process.cwd();
        if (findEcosystemScript(cwd, 'get-git-history-json.ts') !== null) {
          console.error(`\n   💡 AGENT HINT: 'git stash show' is forbidden via the shell to prevent unparsable text dumps.\n${AUTONOMOUS_HEALING_MSG}`);
          console.error(`   You must use the designated wrapper instead: bun .\\.agents\\scripts\\get-git-history-json.ts`);
          process.exit(1);
        }
        return;
      }
    )
    .with(
      { cmd: 'tag', args: P.when((a: string[]) => (a.includes('-a') || a.includes('--annotate')) && !a.includes('-m') && !a.includes('--message') && !a.includes('-F') && !a.includes('--file')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git tag -a' requires an interactive editor without '-m' or '-F'. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'clean', args: P.when((a: string[]) => a.includes('-i') || a.includes('--interactive')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git clean -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'add', args: P.when((a: string[]) => a.includes('-i') || a.includes('--interactive')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git add -i' is interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
        process.exit(1);
      }
    )
    .with(
      { cmd: P.union('add', 'checkout', 'reset', 'stash', 'restore'), args: P.when((a: string[]) => a.includes('-p') || a.includes('--patch')) },
      ({ cmd }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${cmd} -p' (patch selection) is highly interactive and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Do not use patch mode for this command.`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'rebase', args: P.when((a: string[]) => a.includes('-i') || a.includes('--interactive')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git rebase -i' requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Use regular rebase or specific commands.`);
        process.exit(1);
      }
    )
    .with(
      { cmd: P.union('merge', 'pull'), args: P.when((a: string[]) => !a.includes('--no-edit') && !a.includes('-m') && !a.includes('--message') && !a.includes('--abort') && !a.includes('--continue') && !a.includes('--quit')) },
      ({ cmd }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${cmd}' may open an interactive editor for merge commits. Automatically injecting '--no-edit'.\n${AUTONOMOUS_HEALING_MSG}`);
        args.push('--no-edit');
      }
    )
    .with(
      { cmd: P.union('cherry-pick', 'revert'), args: P.when((a: string[]) => !a.includes('--no-edit')) },
      ({ cmd }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${cmd}' may open an interactive editor. Automatically injecting '--no-edit'.\n${AUTONOMOUS_HEALING_MSG}`);
        args.push('--no-edit');
      }
    )
    .with(
      { cmd: 'config', args: P.when((a: string[]) => a.includes('-e') || a.includes('--edit')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git config --edit' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'branch', args: P.when((a: string[]) => a.includes('--edit-description')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git branch --edit-description' opens an interactive editor. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
        process.exit(1);
      }
    )
    .otherwise(() => {});
}
