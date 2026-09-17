// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTONOMOUS_HEALING_MSG, findEcosystemScript } from '../utils.js';
import { match, P } from 'ts-pattern';
import { ExecutionContext } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function gitInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const gitCmds = ['git', 'git.exe'];
  if (!gitCmds.includes(cmdBasename) || payload.type !== 'command') return;

  const rawCwd = ctx.payload.cwd ? path.resolve(ctx.payload.cwd) : process.cwd();
  let targetCwd = rawCwd;
  let explicitCwd: string | undefined;

  const cIndex = args.indexOf('-C');
  if (cIndex !== -1 && cIndex + 1 < args.length) {
    explicitCwd = args[cIndex + 1];
    args.splice(cIndex, 2);
  } else {
    const cPrefixIndex = args.findIndex(a => a.startsWith('-C') && a.length > 2);
    if (cPrefixIndex !== -1) {
      explicitCwd = args[cPrefixIndex].slice(2);
      args.splice(cPrefixIndex, 1);
    }
  }

  if (explicitCwd !== undefined) {
    targetCwd = path.isAbsolute(explicitCwd) ? explicitCwd : path.resolve(rawCwd, explicitCwd);
    ctx.payload.cwd = targetCwd;
  }

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
        
        let message: string | undefined;
        const mIndex = args.findIndex(a => a === '-m' || a === '--message');
        if (mIndex !== -1 && mIndex + 1 < args.length) {
          message = args[mIndex + 1];
        } else {
          const amIndex = args.findIndex(a => a === '-am' || a === '-ma');
          if (amIndex !== -1 && amIndex + 1 < args.length) {
            message = args[amIndex + 1];
          } else {
            const mPrefix = args.find(a => (a.startsWith('-m') || a.startsWith('--message=')) && a.length > 2);
            if (mPrefix) {
              message = mPrefix.startsWith('--message=') ? mPrefix.slice(10) : mPrefix.slice(2);
            } else {
              const amPrefix = args.find(a => (a.startsWith('-am') || a.startsWith('-ma')) && a.length > 3);
              if (amPrefix) {
                message = amPrefix.slice(3);
              }
            }
          }
        }
        
        if (args.includes('--amend')) {
          if (hasWrapper) {
            console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git commit --amend' is forbidden when using the commit.ts wrapper because it breaks the Memory Journal tracking.`);
            console.error(`   Because 'agent-exec.ts' requires strict tracking, this is blocked. Please create a new commit or bypass the interceptor if you must amend.`);
            process.exit(1);
          }
        }

        if (message !== undefined) {
          if (hasWrapper) {
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
      { cmd: P.union('log', 'shortlog', 'show', 'diff', 'status') },
      ({ ctx, args, cmd }) => {
        const cwd = ctx.payload.cwd || process.cwd();
        const fallbackScript = path.resolve(__dirname, '../../get-git-history-json.ts');
        const scriptCandidate = findEcosystemScript(targetCwd, 'get-git-history-json.ts') || findEcosystemScript(cwd, 'get-git-history-json.ts') || (fs.existsSync(fallbackScript) ? fallbackScript : null);
        if (scriptCandidate !== null) {
          if (cmd === 'show') {
            const isBlobInspection = args.some(a => !a.startsWith('-') && a !== 'show' && a !== '--no-pager' && a.includes(':') && !/^[a-zA-Z]:[\\/]/.test(a));
            if (isBlobInspection) {
              return;
            }
          }
          const isTargetDifferent = path.resolve(targetCwd) !== path.resolve(process.cwd());
          const scriptToInvoke = isTargetDifferent ? scriptCandidate : '.\\.agents\\scripts\\get-git-history-json.ts';

          if (cmd === 'status') {
            console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git status' to '${scriptToInvoke} --uncommitted --stats'... (Frictionless Recovery)`);
            ctx.cmdBasename = 'bun';
            ctx.args = [scriptToInvoke, '--uncommitted', '--stats'];
            if (isTargetDifferent) {
              ctx.args.push('--cwd', targetCwd);
            }
            return;
          }

          console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git ${cmd}' to '${scriptToInvoke}' to prevent text dumps... (Frictionless Recovery)`);
          ctx.cmdBasename = 'bun';
          ctx.args = [scriptToInvoke];
          if (isTargetDifferent) {
            ctx.args.push('--cwd', targetCwd);
          }
          if (cmd === 'show') {
            ctx.args.push('--stats');
          }
          if (cmd === 'diff') {
            ctx.args.push('--stats', '--include-patch');
          }

          let limit = '10';
          let hasExplicitLimit = false;
          const nIndex = args.indexOf('-n');
          if (nIndex !== -1 && nIndex + 1 < args.length) {
            limit = args[nIndex + 1];
            hasExplicitLimit = true;
          }
          
          // Check for numeric flags like -1, -5
          for (let i = 0; i < args.length; i++) {
            if (/^-\d+$/.test(args[i])) {
              limit = args[i].substring(1);
              hasExplicitLimit = true;
            }
          }
          
          if (cmd !== 'diff' || hasExplicitLimit) {
            ctx.args.push('--limit', limit);
          }

          if (args.includes('-p') || args.includes('--patch')) {
            if (!ctx.args.includes('--include-patch')) {
              ctx.args.push('--include-patch');
            }
          }

          const valueFlags = [
            '-n', '--max-count', '--skip',
            '--author', '-a', '--committer',
            '--grep', '-g',
            '--since', '--after', '--until', '--before',
            '-S', '--pickaxe',
            '-G', '--patch-search',
            '-L', '--format', '--pretty',
            '-U', '--diff-context',
            '--diff-filter'
          ];
          let rangeArg: string | undefined;
          let pathArg: string | undefined;

          // Extract known options to forward to get-git-history-json.ts and separate range/path
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const nextArg = args[i + 1];

            if (arg === '--') {
              const remaining = args.slice(i + 1).filter(a => a !== '--');
              if (remaining.length > 0) {
                pathArg = remaining.join(' ');
              }
              break;
            }

            if (arg === '-S' && nextArg !== undefined) {
              ctx.args.push('--pickaxe', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('-S') && arg.length > 2) {
              ctx.args.push('--pickaxe', arg.substring(2));
              continue;
            }

            if (arg === '-G' && nextArg !== undefined) {
              ctx.args.push('--patch-search', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('-G') && arg.length > 2) {
              ctx.args.push('--patch-search', arg.substring(2));
              continue;
            }

            if ((arg === '--grep' || arg === '-g') && nextArg !== undefined) {
              ctx.args.push('--grep', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--grep=')) {
              ctx.args.push('--grep', arg.slice(7));
              continue;
            }

            if ((arg === '--author' || arg === '-a') && nextArg !== undefined) {
              ctx.args.push('--author', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--author=')) {
              ctx.args.push('--author', arg.slice(9));
              continue;
            }

            if (arg === '--since' && nextArg !== undefined) {
              ctx.args.push('--since', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--since=')) {
              ctx.args.push('--since', arg.slice(8));
              continue;
            }

            if (arg === '--after' && nextArg !== undefined) {
              ctx.args.push('--since', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--after=')) {
              ctx.args.push('--since', arg.slice(8));
              continue;
            }

            if (arg === '--until' && nextArg !== undefined) {
              ctx.args.push('--until', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--until=')) {
              ctx.args.push('--until', arg.slice(8));
              continue;
            }

            if (arg === '--before' && nextArg !== undefined) {
              ctx.args.push('--until', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--before=')) {
              ctx.args.push('--until', arg.slice(9));
              continue;
            }

            if (arg === '--diff-filter' && nextArg !== undefined) {
              ctx.args.push('--diff-filter', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('--diff-filter=')) {
              ctx.args.push('--diff-filter', arg.slice(14));
              continue;
            }

            if ((arg === '-U' || arg === '--diff-context') && nextArg !== undefined) {
              ctx.args.push('--diff-context', nextArg);
              i++;
              continue;
            }
            if (arg.startsWith('-U') && arg.length > 2) {
              ctx.args.push('--diff-context', arg.substring(2));
              continue;
            }

            if (arg === '--first-parent') {
              ctx.args.push('--first-parent');
              continue;
            }

            if (arg === '--all') {
              ctx.args.push('--all');
              continue;
            }

            if (arg === '--reverse') {
              ctx.args.push('--reverse');
              continue;
            }

            if (valueFlags.includes(arg)) {
              i++;
              continue;
            }

            if (!arg.startsWith('-') && arg !== cmd && arg !== '--no-pager') {
              if (arg.includes('..')) {
                rangeArg = arg;
              } else if (arg.includes('/') || arg.includes('\\') || arg.includes('.')) {
                pathArg = arg;
              } else {
                if (rangeArg) {
                  pathArg = arg;
                } else {
                  rangeArg = arg;
                }
              }
            }
          }

          if (cmd === 'diff' && !rangeArg) {
            ctx.args.push('--uncommitted');
          }
          if (rangeArg) {
            ctx.args.push('--range', rangeArg);
          }
          if (pathArg) {
            ctx.args.push('--path', pathArg);
          }
          return;
        }
        // Fallback to native (with --no-pager already injected)
        if (cmd === 'diff' && !ctx.args.includes('--')) {
          const nonFlagArgs = ctx.args.filter(a => !a.startsWith('-') && a !== 'diff' && a !== '--no-pager');
          if (nonFlagArgs.length >= 2) {
            const lastArg = nonFlagArgs[nonFlagArgs.length - 1];
            if (lastArg.includes('/') || lastArg.includes('\\') || /\.[a-zA-Z0-9]+$/.test(lastArg)) {
              const lastIdx = ctx.args.lastIndexOf(lastArg);
              if (lastIdx !== -1) {
                console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-injecting '--' before file path in 'git diff' to prevent ambiguous argument error... (Frictionless Recovery)`);
                ctx.args.splice(lastIdx, 0, '--');
              }
            }
          }
        }
        return;
      }
    )
    .with(
      { cmd: 'stash', args: P.when((a: string[]) => a.includes('show')) },
      ({ ctx }) => {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git stash show' to non-interactive 'git diff stash@{0} --stat'... (Frictionless Recovery)`);
        ctx.args = ['--no-pager', 'diff', 'stash@{0}', '--stat'];
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
      {
        cmd: P.union('rebase', 'pull'),
        args: P.when((a: string[]) => a.includes('-i') || a.includes('--interactive') || a.some(arg => arg.startsWith('--rebase=interactive')))
      },
      ({ cmd }) => {
        console.error(`\n   💡 AGENT HINT: 'git ${cmd}' with interactive mode requires an interactive editor and will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this is blocked. Use non-interactive ${cmd} or specific commands.`);
        process.exit(1);
      }
    )
    .with(
      {
        cmd: P.union('merge', 'pull'),
        args: P.when((a: string[]) => {
          if (a.includes('--no-edit') || a.includes('--abort') || a.includes('--continue') || a.includes('--quit')) {
            return false;
          }
          if (a.some(arg => arg === '-m' || arg.startsWith('-m') || arg === '--message' || arg.startsWith('--message='))) {
            return false;
          }
          return true;
        })
      },
      ({ cmd, args }) => {
        if (cmd === 'pull') {
          const isRebase = args.some(arg => arg === '-r' || arg === '--rebase' || (arg.startsWith('--rebase=') && arg !== '--rebase=false'));
          if (isRebase) {
            // Rebase pulls do not create merge commits; injecting --no-edit fails with 'fatal: --no-edit is not possible with --rebase'.
            return;
          }
        }
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-edit' into 'git ${cmd}' to prevent interactive editor prompt... (Frictionless Recovery)`);
        args.push('--no-edit');
      }
    )
    .with(
      { cmd: P.union('cherry-pick', 'revert'), args: P.when((a: string[]) => !a.includes('--no-edit') && !a.includes('--no-commit') && !a.includes('-n')) },
      ({ cmd }) => {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git ${cmd}' may open an interactive editor. Automatically injecting '--no-edit'.... (Frictionless Recovery)`);
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
