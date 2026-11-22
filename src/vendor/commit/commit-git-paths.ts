// @ts-nocheck
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fatalError } from './commit-cli-schema.js';

const SCRATCH_SEGMENT_RE = /(?:^|\/)scratch(?:\/|$)/;
const SCRATCH_FILE_RE = /(?:^|\/)[^/]*scratch\.[cm]?[jt]s$/;

export function normalizeRelGitPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

export function isSameResolvedPath(a: string, b: string): boolean {
  const normA = path.resolve(a);
  const normB = path.resolve(b);
  return process.platform === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

export function getValidatedRepoRelPath(baseDir: string, targetPath: string): string | null {
  const absTarget = path.resolve(baseDir, targetPath);
  const rel = path.relative(baseDir, absTarget);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return normalizeRelGitPath(rel);
}

function hasGitDirEnvOverride(): boolean {
  return (
    (process.env['GIT_DIR'] !== undefined && process.env['GIT_DIR'].length > 0) ||
    (process.env['GIT_WORK_TREE'] !== undefined && process.env['GIT_WORK_TREE'].length > 0) ||
    (process.env['GIT_COMMON_DIR'] !== undefined && process.env['GIT_COMMON_DIR'].length > 0)
  );
}

/**
 * [INTENT]: Resolve `.git` directory without spawning `git rev-parse --git-dir` on standard
 * repo roots (falling back to `git rev-parse` for subdirectories, worktrees, submodules, symlinks,
 * and `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR` overrides).
 */
export function resolveGitDir(cwd: string): string | null {
  if (!hasGitDirEnvOverride()) {
    const localDotGit = path.join(cwd, '.git');
    const dotGitStat = fs.lstatSync(localDotGit, { throwIfNoEntry: false });
    if (dotGitStat !== undefined && !dotGitStat.isSymbolicLink() && dotGitStat.isDirectory()) {
      const headStat = fs.statSync(path.join(localDotGit, 'HEAD'), { throwIfNoEntry: false });
      if (headStat !== undefined && headStat.isFile()) {
        return path.resolve(localDotGit);
      }
    }
  }
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8', cwd, windowsHide: true }).trim();
    return gitDir.length > 0 ? path.resolve(cwd, gitDir) : null;
  } catch {
    return null;
  }
}

export function resolveRepoRootForGuard(cwd: string, resolvedGitDir: string | null): string {
  if (resolvedGitDir !== null) {
    if (!hasGitDirEnvOverride() && path.basename(resolvedGitDir).toLowerCase() === '.git') {
      return path.dirname(resolvedGitDir);
    }
    try {
      const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf-8',
        cwd,
        windowsHide: true,
      }).trim();
      if (topLevel.length > 0) {
        return path.resolve(topLevel);
      }
    } catch {
      return cwd;
    }
  }
  return cwd;
}

export function isScratchRepoPath(filepath: string): boolean {
  const normalized = normalizeRelGitPath(filepath).toLowerCase();
  return (
    SCRATCH_SEGMENT_RE.test(normalized) ||
    normalized.includes('.agents/scratch') ||
    SCRATCH_FILE_RE.test(normalized)
  );
}

export function abortIfScratchPaths(scratchFiles: readonly string[]): never {
  console.error('🛠️ AUTONOMOUS HEALING: Scratch files detected in staging area.');
  console.error('You MUST NOT commit scratch scripts, test data, or debug payloads. Please unstage the following files:');
  for (const file of scratchFiles) console.error(`- ${file}`);
  fatalError('Commit aborted: Scratch files staged.');
}

function queryMatchingGitRelPaths(
  cwd: string,
  candidates: ReadonlyArray<{ original: string; relPosix: string }>,
  gitArgsPrefix: readonly string[]
): Set<string> {
  const matched = new Set<string>();
  if (candidates.length === 0) return matched;
  try {
    const res = spawnSync('git', [...gitArgsPrefix, '--', ...candidates.map((c) => c.relPosix)], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (res.status !== 0 || typeof res.stdout !== 'string') return matched;
    const hitSet = new Set(res.stdout.split('\0').filter(Boolean));
    for (const item of candidates) {
      if (hitSet.has(item.relPosix)) matched.add(item.original);
    }
  } catch {
    return matched;
  }
  return matched;
}

function resolveTargetsForGitQuery(
  cwd: string,
  targetPaths: readonly string[],
  onlyMissing: boolean,
  resolvedGitDir?: string | null
): { queryCwd: string; candidates: Array<{ original: string; relPosix: string }> } {
  const filtered: string[] = [];
  const cwdCandidates: Array<{ original: string; relPosix: string }> = [];
  let hasEscapedTarget = false;
  for (const targetPath of targetPaths) {
    if (onlyMissing && fs.statSync(path.resolve(cwd, targetPath), { throwIfNoEntry: false }) !== undefined) {
      continue;
    }
    filtered.push(targetPath);
    const relPosix = getValidatedRepoRelPath(cwd, targetPath);
    if (relPosix !== null) {
      cwdCandidates.push({ original: targetPath, relPosix });
    } else {
      hasEscapedTarget = true;
    }
  }
  if (!hasEscapedTarget) {
    return { queryCwd: cwd, candidates: cwdCandidates };
  }
  const gitDir = resolvedGitDir !== undefined ? resolvedGitDir : resolveGitDir(cwd);
  const repoRoot = resolveRepoRootForGuard(cwd, gitDir);
  if (isSameResolvedPath(repoRoot, cwd)) {
    return { queryCwd: cwd, candidates: cwdCandidates };
  }
  const repoCandidates: Array<{ original: string; relPosix: string }> = [];
  for (const targetPath of filtered) {
    const relPosix = getValidatedRepoRelPath(repoRoot, path.resolve(cwd, targetPath));
    if (relPosix !== null) {
      repoCandidates.push({ original: targetPath, relPosix });
    }
  }
  return { queryCwd: repoRoot, candidates: repoCandidates };
}

/**
 * [INTENT]: Batched single-subprocess detector for `--add` paths that are missing on disk and
 * already staged as deletions (`D  <path>`) in `.git/index`, preventing `git add` exit 128.
 */
export function findAlreadyStagedDeletions(
  cwd: string,
  targetPaths: readonly string[],
  resolvedGitDir?: string | null
): Set<string> {
  const { queryCwd, candidates } = resolveTargetsForGitQuery(cwd, targetPaths, true, resolvedGitDir);
  return queryMatchingGitRelPaths(queryCwd, candidates, ['diff', '--cached', '--relative', '--name-only', '--diff-filter=D', '-z']);
}

export function findTrackedIndexPaths(
  cwd: string,
  targetPaths: readonly string[],
  resolvedGitDir?: string | null
): Set<string> {
  const { queryCwd, candidates } = resolveTargetsForGitQuery(cwd, targetPaths, false, resolvedGitDir);
  return queryMatchingGitRelPaths(queryCwd, candidates, ['ls-files', '-z']);
}

/**
 * [INTENT]: Detect when a single `--add <path>` target has already been staged as deleted (`D  <path>`).
 */
export function isAlreadyStagedDeletion(cwd: string, targetPath: string): boolean {
  return findAlreadyStagedDeletions(cwd, [targetPath]).has(targetPath);
}

const GLOB_META_RE = /[*?[\]]/;

/**
 * [INTENT]: Pre-stage scan for directory or glob `--add` targets so untracked/modified
 * scratch files nested under `--add sub` or `--add .` abort BEFORE mutating `.git/index`.
 */
export function findScratchInDirOrGlobTargets(cwd: string, targetPaths: readonly string[]): string[] {
  const targets: string[] = [];
  for (const p of targetPaths) {
    if (GLOB_META_RE.test(p)) {
      targets.push(p);
      continue;
    }
    const st = fs.statSync(path.resolve(cwd, p), { throwIfNoEntry: false });
    if (st !== undefined && st.isDirectory()) targets.push(p);
  }
  if (targets.length === 0) return [];
  const res = spawnSync('git', ['status', '-z', '-uall', '--', ...targets], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  if (res.status !== 0 || typeof res.stdout !== 'string') return [];
  const parts = res.stdout.split('\0');
  const scratchHits: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part) {
      i++;
      continue;
    }
    const indexStatus = part[0];
    const workTreeStatus = part[1];
    const filepath = part.substring(3);
    if (indexStatus !== 'D' && workTreeStatus !== 'D' && isScratchRepoPath(filepath)) {
      scratchHits.push(filepath);
    }
    i += indexStatus === 'R' || indexStatus === 'C' || workTreeStatus === 'R' || workTreeStatus === 'C' ? 2 : 1;
  }
  return scratchHits;
}
