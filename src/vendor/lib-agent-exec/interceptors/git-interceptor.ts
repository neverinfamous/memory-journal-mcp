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

function applyGitCFlags(args: string[], initialCwd: string): { targetCwd: string; explicitCwd: string | undefined } {
  let targetCwd = initialCwd;
  let explicitCwd: string | undefined;
  // -C <path> is a top-level git flag and MUST appear before the git subcommand
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--') break;
    if (a === '-C') {
      if (i + 1 < args.length && !/^\d+$/.test(args[i + 1])) {
        targetCwd = path.isAbsolute(args[i + 1]) ? args[i + 1] : path.resolve(targetCwd, args[i + 1]);
        explicitCwd = targetCwd;
        args.splice(i, 2);
        continue;
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

function findGitSubcommand(args: readonly string[]): string | undefined {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
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

  const fallbackCwd = typeof ctx.cwd === 'string' && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd();
  const rawCwd = ctx.payload.cwd ? path.resolve(ctx.payload.cwd) : fallbackCwd;
  const { targetCwd, explicitCwd } = applyGitCFlags(args, rawCwd);

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

