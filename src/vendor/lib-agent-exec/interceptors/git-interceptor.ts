// @ts-nocheck
import { ExecutionContext } from './types.js';

export function gitInterceptor({ cmdBasename, args, payload }: ExecutionContext): void {
  const gitCmds = ['git', 'git.exe'];
  if (!gitCmds.includes(cmdBasename) || payload.type !== 'command') return;

  if (!args.includes('--no-pager')) {
    args.unshift('--no-pager');
  }
  const knownGitCmds = ['add', 'am', 'archive', 'bisect', 'branch', 'bundle', 'checkout', 'cherry-pick', 'citool', 'clean', 'clone', 'commit', 'describe', 'diff', 'fetch', 'format-patch', 'gc', 'gitk', 'grep', 'gui', 'init', 'log', 'merge', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'tag', 'worktree', 'config', 'difftool', 'mergetool', 'remote', 'blame', 'reflog'];
  const gitSubCmd = args.find(a => knownGitCmds.includes(a)) || args.filter(a => !a.startsWith('-'))[0];
  
  if (['difftool', 'mergetool'].includes(gitSubCmd)) {
    console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd}' launches interactive UI tools and will hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
    console.error(`   Please use standard 'git diff' or 'git merge' instead.`);
    process.exit(1);
  }
  if (args.includes('-e') || args.includes('--edit')) {
    console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd} -e / --edit' requires an interactive editor and will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }
  if (gitSubCmd === 'bisect') {
    console.error(`\n   💡 AGENT HINT: 'git bisect' requires interactive input at each step and will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }
  if (gitSubCmd === 'commit') {
    const msgFlags = ['-m', '--message', '-F', '--file', '-c', '-C', '--reuse-message'];
    const hasMessage = args.some(a => 
      msgFlags.some(f => a === f || a.startsWith(`${f}=`)) || 
      /^-[a-zA-Z]*m/.test(a)
    );
    if (!hasMessage) {
      if (args.includes('--amend') && args.includes('--no-edit')) {
        // Allowed: amending without changing the message
      } else {
        console.error(`\n   💡 AGENT HINT: 'git commit' called without a message flag (-m, -F, -C, --no-edit, etc). This will abort because the interactive editor is disabled.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
        console.error(`   Auto-healing: Blocking execution to prevent hanging on interactive editor.`);
        process.exit(1);
      }
    }
  }
  
  if (gitSubCmd === 'tag' && (args.includes('-a') || args.includes('--annotate'))) {
    if (!args.includes('-m') && !args.includes('--message') && !args.includes('-F') && !args.includes('--file')) {
      console.error(`\n   💡 AGENT HINT: 'git tag -a' requires an interactive editor without '-m' or '-F'. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
      process.exit(1);
    }
  }

  if (gitSubCmd === 'clean' && (args.includes('-i') || args.includes('--interactive'))) {
    console.error(`\n   💡 AGENT HINT: 'git clean -i' is interactive and will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }

  if (gitSubCmd === 'add' && (args.includes('-i') || args.includes('--interactive'))) {
    console.error(`\n   💡 AGENT HINT: 'git add -i' is interactive and will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked.`);
    process.exit(1);
  }

  const interactivePatchCmds = ['add', 'checkout', 'commit', 'reset', 'stash', 'restore'];
  if (interactivePatchCmds.includes(gitSubCmd) && (args.includes('-p') || args.includes('--patch'))) {
    console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd} -p' (patch selection) is highly interactive and will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Do not use patch mode for this command.`);
    process.exit(1);
  }

  if (gitSubCmd === 'rebase' && (args.includes('-i') || args.includes('--interactive'))) {
    console.error(`\n   💡 AGENT HINT: 'git rebase -i' requires an interactive editor and will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Use regular rebase or specific commands.`);
    process.exit(1);
  }

  if (gitSubCmd === 'merge' || gitSubCmd === 'pull') {
    if (!args.includes('--no-edit') && !args.includes('-m') && !args.includes('--message')) {
        console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd}' may open an interactive editor for merge commits. Automatically injecting '--no-edit'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
        args.push('--no-edit');
    }
  }

  if (gitSubCmd === 'cherry-pick' || gitSubCmd === 'revert') {
    if (args.includes('-e') || args.includes('--edit')) {
        console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd} -e' opens an interactive editor. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
        process.exit(1);
    } else if (!args.includes('--no-edit')) {
        console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd}' may open an interactive editor. Automatically injecting '--no-edit'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
        args.push('--no-edit');
    }
  }

  if (gitSubCmd === 'config' && (args.includes('-e') || args.includes('--edit'))) {
        console.error(`\n   💡 AGENT HINT: 'git config --edit' opens an interactive editor. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
        process.exit(1);
  }

  if (gitSubCmd === 'branch' && args.includes('--edit-description')) {
        console.error(`\n   💡 AGENT HINT: 'git branch --edit-description' opens an interactive editor. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Stop and notify user IMMEDIATELY to fix this command.\x1b[0m`);
        process.exit(1);
  }
}
