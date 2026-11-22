// @ts-nocheck
import path from 'node:path';
import { ExecutionContext } from './types.js';
import { applyEarlyGitGuards, applyEditorGitHeals, applyInteractiveGitBlocks } from './git-guards.js';

const GIT_VALUE_FLAGS = new Set([
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
  '--super-prefix',
]);

const GIT_SUBCMD_VALUE_FLAGS = new Set([
  '-m', '--message', '-S', '-G', '-F', '--file', '--grep', '--author',
  '--format', '--pretty', '-n', '--max-count', '-c', '--config', '-b', '-B',
]);

function resolveGitCDir(nextPath: string, currentCwd: string, usePosix: boolean): string {
  if (nextPath === '~' || nextPath.startsWith('~/')) return nextPath;
  if (currentCwd === '~' || currentCwd.startsWith('~/')) {
    return nextPath.startsWith('/') ? nextPath : path.posix.join(currentCwd, nextPath);
  }
  const baseImpl = usePosix || currentCwd.startsWith('/') ? path.posix : path;
  const nextImpl = nextPath.startsWith('/') ? path.posix : baseImpl;
  return nextImpl.isAbsolute(nextPath) ? nextPath : baseImpl.resolve(currentCwd, nextPath);
}

function applyGitCFlags(args: string[], initialCwd: string, usePosix: boolean): { targetCwd: string; explicitCwd: string | undefined } {
  let targetCwd = initialCwd;
  let explicitCwd: string | undefined;
  // -C <path> is a top-level git flag and MUST appear before the git subcommand
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-C') {
      const nextPath = args[i + 1];
      if (nextPath !== undefined && !/^\d+$/.test(nextPath)) {
        targetCwd = resolveGitCDir(nextPath, targetCwd, usePosix);
        explicitCwd = targetCwd;
        args.splice(i, 2);
        continue;
      }
      i++;
    } else if (a.startsWith('-C') && a.length > 2) {
      const candidate = a.slice(2);
      if (!/^\d+$/.test(candidate)) {
        targetCwd = resolveGitCDir(candidate, targetCwd, usePosix);
        explicitCwd = targetCwd;
        args.splice(i, 1);
        continue;
      }
      i++;
    } else if (GIT_VALUE_FLAGS.has(a)) {
      i += 2;
    } else if (a.startsWith('-')) {
      i++;
    } else {
      break;
    }
  }
  return { targetCwd, explicitCwd };
}

function hasGitHelpFlag(args: readonly string[]): boolean {
  let seenSubcmd = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--help' || (!seenSubcmd && a === '-h')) return true;
    if ((!seenSubcmd && (a === '-C' || GIT_VALUE_FLAGS.has(a))) || (seenSubcmd && (GIT_SUBCMD_VALUE_FLAGS.has(a) || /^-[a-zA-Z]*[mF]$/.test(a)))) {
      i++;
      continue;
    }
    if (!a.startsWith('-')) seenSubcmd = true;
  }
  return false;
}

function findGitSubcommand(args: readonly string[]): string | undefined {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined) break;
    if (a === '--') {
      i++;
      return i < args.length ? args[i] : undefined;
    }
    if (a === '-C' || GIT_VALUE_FLAGS.has(a)) {
      i += 2;
      continue;
    }
    if (a.startsWith('-')) {
      i++;
      continue;
    }
    return a;
  }
  return undefined;
}

export function gitInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const gitCmds = ['git', 'git.exe'];
  if (!gitCmds.includes(cmdBasename) || payload.type !== 'command') return;
  if (hasGitHelpFlag(args)) return;

  const isPosixWslCwd = payload.target === 'wsl2'
    && typeof ctx.payload.cwd === 'string'
    && (ctx.payload.cwd.startsWith('/') || ctx.payload.cwd.startsWith('~'));
  const fallbackCwd = typeof ctx.cwd === 'string' && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd();
  const rawCwd = isPosixWslCwd && ctx.payload.cwd !== undefined
    ? ctx.payload.cwd
    : (ctx.payload.cwd ? path.resolve(ctx.payload.cwd) : fallbackCwd);
  const { targetCwd, explicitCwd } = applyGitCFlags(args, rawCwd, isPosixWslCwd);

  if (explicitCwd !== undefined) {
    ctx.payload.cwd = targetCwd;
  }

  if (!args.includes('--no-pager')) {
    args.unshift('--no-pager');
  }
  const gitSubCmd = findGitSubcommand(args);
  const scope = { cmd: gitSubCmd, args, ctx, targetCwd, rawCwd, explicitCwd };
  if (applyEarlyGitGuards(scope)) return;
  if (applyInteractiveGitBlocks(scope)) return;
  applyEditorGitHeals(scope);
}

