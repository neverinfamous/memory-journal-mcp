import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { match, P } from 'ts-pattern';
import { ExecutionContext } from './types.js';

export function gitInterceptor({ cmdBasename, args, payload }: ExecutionContext): void {
  const gitCmds = ['git', 'git.exe'];
  if (!gitCmds.includes(cmdBasename) || payload.type !== 'command') return;

  if (!args.includes('--no-pager')) {
    args.unshift('--no-pager');
  }
  const knownGitCmds = ['add', 'am', 'archive', 'bisect', 'branch', 'bundle', 'checkout', 'cherry-pick', 'citool', 'clean', 'clone', 'commit', 'describe', 'diff', 'fetch', 'format-patch', 'gc', 'gitk', 'grep', 'gui', 'init', 'log', 'merge', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'tag', 'worktree', 'config', 'difftool', 'mergetool', 'remote', 'blame', 'reflog'];
  const gitSubCmd = args.find(a => knownGitCmds.includes(a)) || args.filter(a => !a.startsWith('-'))[0];
  
  match({ cmd: gitSubCmd, args })
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
      () => {
        console.error(`\n   💡 AGENT HINT: 'git commit' is strictly forbidden via the shell.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   You must use the designated wrapper instead: bun .\\.agents\\scripts\\commit.ts`);
        process.exit(1);
      }
    )
    .with(
      { cmd: P.union('log', 'shortlog', 'show') },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git log', 'git shortlog', and 'git show' are forbidden via the shell to prevent unparsable text dumps.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   You must use the designated wrapper instead: bun .\\.agents\\scripts\\get-git-history-json.ts`);
        process.exit(1);
      }
    )
    .with(
      { cmd: 'stash', args: P.when((a: string[]) => a.includes('show')) },
      () => {
        console.error(`\n   💡 AGENT HINT: 'git stash show' is forbidden via the shell to prevent unparsable text dumps.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   You must use the designated wrapper instead: bun .\\.agents\\scripts\\get-git-history-json.ts`);
        process.exit(1);
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
      { cmd: P.union('merge', 'pull'), args: P.when((a: string[]) => !a.includes('--no-edit') && !a.includes('-m') && !a.includes('--message')) },
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
