// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ExecutionContext } from './types.js';
import {
  PATHSPEC_FROM_FILE_RE,
  extractGitDirWorkTreeFlags,
  mergeGitEnv,
} from './git-add-broad-scan.js';

const SKIP_STAGED_DEL_SHORT_RE = /^-[nvfipeuANU]*[nipe][nvfipeuANU]*$/;

/**
 * [INTENT]: Keep `ctx.payload.args` synchronized with mutated `ctx.args` ahead of any AUTONOMOUS HEALING log.
 */
export function syncGitPayloadArgs(ctx: ExecutionContext): void {
  if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
    ctx.payload.args = [...ctx.args];
  }
}

/**
 * [INTENT]: Collect positional pathspec tokens following a git subcommand while skipping options before `--`.
 */
export function collectGitPathspecs(afterArgs: readonly string[]): Array<{ offset: number; value: string }> {
  const specs: Array<{ offset: number; value: string }> = [];
  let sawSeparator = false;
  for (let offset = 0; offset < afterArgs.length; offset++) {
    const a = afterArgs[offset];
    if (a === undefined) continue;
    if (!sawSeparator && a === '--') { sawSeparator = true; continue; }
    if (!sawSeparator && a === '--chmod') { offset++; continue; }
    if (!sawSeparator && a.startsWith('-')) continue;
    specs.push({ offset, value: a });
  }
  return specs;
}

/**
 * [INTENT]: Query git's index in one batched call to detect deleted files that are already staged as `D`.
 */
const STAGED_DEL_GLOB_META_RE = /[*?[\]]/;

export function findAlreadyStagedGitDeletions(
  gitCwd: string,
  rawPathspecs: readonly string[],
  gitOverrideFlags: readonly string[] = [],
  payloadEnv?: Record<string, string | undefined>,
): Set<string> {
  const stagedDeletions = new Set<string>();
  const missingTargets: Array<{ original: string; relPosix: string }> = [];
  for (const rawPathspec of rawPathspecs) {
    const cleaned = rawPathspec.trim().replace(/^['"]|['"]$/g, '');
    if (cleaned.length === 0 || cleaned === '.' || cleaned === '..' || cleaned.startsWith(':') || STAGED_DEL_GLOB_META_RE.test(cleaned)) continue;
    const absPath = path.resolve(gitCwd, cleaned);
    if (fs.lstatSync(absPath, { throwIfNoEntry: false }) !== undefined) continue;
    const rel = path.relative(gitCwd, absPath);
    if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    missingTargets.push({ original: rawPathspec, relPosix: rel.replace(/\\/g, '/') });
  }
  if (missingTargets.length === 0) return stagedDeletions;
  const fold = (s: string): string => (process.platform === 'win32' ? s.toLowerCase() : s);
  const specPrefix = process.platform === 'win32' ? ':(icase,literal)' : ':(literal)';
  try {
    const cachedDelRes = spawnSync(
      'git',
      [...gitOverrideFlags, 'diff', '--cached', '--relative', '--name-only', '--diff-filter=D', '-z', '--', ...missingTargets.map(m => `${specPrefix}${m.relPosix}`)],
      {
        cwd: gitCwd,
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        env: mergeGitEnv(payloadEnv),
      },
    );
    if (cachedDelRes.status !== 0 || typeof cachedDelRes.stdout !== 'string') return stagedDeletions;
    const cachedDeletedSet = new Set(cachedDelRes.stdout.split('\0').filter(Boolean).map(fold));
    for (const item of missingTargets) {
      if (cachedDeletedSet.has(fold(item.relPosix))) stagedDeletions.add(item.original);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`WARN: failed checking staged deletions in '${gitCwd}': ${msg}`);
    return stagedDeletions;
  }
  return stagedDeletions;
}

export function isAlreadyStagedGitDeletion(gitCwd: string, rawPathspec: string): boolean {
  return findAlreadyStagedGitDeletions(gitCwd, [rawPathspec]).has(rawPathspec);
}

/**
 * [INTENT]: Inject `--ignore-unmatch` into `git rm` when targets are already staged as deleted.
 */
export function healGitRmStagedDeletions(ctx: ExecutionContext, gitCwd: string, rmIdx: number): void {
  const afterRm = ctx.args.slice(rmIdx + 1);
  if (afterRm.includes('--ignore-unmatch') || afterRm.some(a => PATHSPEC_FROM_FILE_RE.test(a))) return;
  const paths = collectGitPathspecs(afterRm).map(s => s.value);
  const { flags: gitOverrideFlags } = extractGitDirWorkTreeFlags(ctx.args.slice(0, rmIdx), ctx.payload.env);
  if (paths.length > 0 && findAlreadyStagedGitDeletions(gitCwd, paths, gitOverrideFlags, ctx.payload.env).size > 0) {
    ctx.args.splice(rmIdx + 1, 0, '--ignore-unmatch');
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '--ignore-unmatch' into 'git rm' for already-staged deletion(s)... (Frictionless Recovery)\x1b[0m`);
  }
}

/**
 * [INTENT]: Omit or turn into idempotent no-ops `git add` targets that are already staged as deleted to avoid exit 128.
 */
export function healGitAddStagedDeletions(
  ctx: ExecutionContext,
  gitCwd: string,
  addIdx: number,
  preGitOverrideFlags?: readonly string[],
  preCollectedPathspecs?: ReadonlyArray<{ offset: number; value: string }>,
): boolean {
  const afterAdd = ctx.args.slice(addIdx + 1);
  const ddIdx = afterAdd.indexOf('--');
  const preDdAdd = ddIdx === -1 ? afterAdd : afterAdd.slice(0, ddIdx);
  if (
    preDdAdd.some(
      (a) =>
        a === '--dry-run' ||
        a === '--interactive' ||
        a === '--patch' ||
        a === '--edit' ||
        SKIP_STAGED_DEL_SHORT_RE.test(a) ||
        PATHSPEC_FROM_FILE_RE.test(a),
    )
  ) {
    return false;
  }
  const rawCollected = preCollectedPathspecs ?? collectGitPathspecs(afterAdd);
  const pathSpecs = rawCollected.map(s => ({ argIndex: addIdx + 1 + s.offset, value: s.value }));
  if (pathSpecs.length === 0) return false;
  const gitOverrideFlags = preGitOverrideFlags ?? extractGitDirWorkTreeFlags(ctx.args.slice(0, addIdx), ctx.payload.env).flags;
  const stagedSet = findAlreadyStagedGitDeletions(gitCwd, pathSpecs.map(s => s.value), gitOverrideFlags, ctx.payload.env);
  if (stagedSet.size === 0) return false;
  const stagedDeleted = pathSpecs.filter(s => stagedSet.has(s.value));
  if (pathSpecs.length > stagedDeleted.length) {
    for (let idx = stagedDeleted.length - 1; idx >= 0; idx--) {
      const item = stagedDeleted[idx];
      if (item !== undefined) ctx.args.splice(item.argIndex, 1);
    }
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Omitting already-staged deletion(s) from 'git add' pathspecs to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
    return false;
  }
  const prefixFlags = ctx.args.slice(0, addIdx);
  ctx.args.splice(0, ctx.args.length, ...prefixFlags, 'ls-files', '--stage', '--', ...stagedDeleted.map(s => s.value));
  syncGitPayloadArgs(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Pathspec(s) passed to 'git add' are already staged as deleted; treating as idempotent no-op to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
  return true;
}
