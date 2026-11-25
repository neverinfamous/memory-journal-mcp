// @ts-nocheck
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fatalError } from './commit-cli-schema.js';
import { isSensitiveRepoPath, stripWin32TrailingDotsAndSpaces } from './commit-security.js';

const SCRATCH_SEGMENT_RE = /(?:^|\/)scratch(?:\/|$)/;
const SCRATCH_FILE_RE = /(?:^|\/)[^/]*scratch\.[cm]?[jt]s$/;

export function normalizeRelGitPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

export function resolveCanonicalPath(targetPath: string): string | null {
  const abs = path.resolve(targetPath);
  const trailing: string[] = [];
  let current = abs;
  while (true) {
    const real = tryRealpath(current);
    if (real !== null) {
      return trailing.length === 0 ? real : path.join(real, ...trailing.reverse());
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    trailing.push(path.basename(current));
    current = parent;
  }
}

function foldPathForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isStrictlyUnderLexicalDir(normParent: string, normChild: string): boolean {
  const foldedParent = foldPathForCompare(normParent);
  const foldedChild = foldPathForCompare(normChild);
  const prefix = foldedParent.endsWith(path.sep) ? foldedParent : `${foldedParent}${path.sep}`;
  return foldedChild.startsWith(prefix);
}

function resolveCanonicalParentPath(absTarget: string): string | null {
  const parent = path.dirname(absTarget);
  if (parent === absTarget) return resolveCanonicalPath(absTarget);
  const canonParent = resolveCanonicalPath(parent);
  return canonParent !== null ? path.join(canonParent, path.basename(absTarget)) : null;
}

export function isSameResolvedPath(a: string, b: string): boolean {
  const normA = path.resolve(a);
  const normB = path.resolve(b);
  if (foldPathForCompare(normA) === foldPathForCompare(normB)) return true;
  const canonA = resolveCanonicalPath(normA);
  const canonB = resolveCanonicalPath(normB);
  return canonA !== null && canonB !== null && foldPathForCompare(canonA) === foldPathForCompare(canonB);
}

function computeValidatedRel(base: string, target: string): string | null {
  const rel = path.relative(base, target);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return normalizeRelGitPath(rel);
}

export function getValidatedRepoRelPath(baseDir: string, targetPath: string): string | null {
  const absTarget = path.resolve(baseDir, targetPath);
  const lexicalRel = computeValidatedRel(baseDir, absTarget);
  if (lexicalRel !== null) return lexicalRel;
  const canonBase = resolveCanonicalPath(baseDir);
  if (canonBase === null) return null;
  const canonParentTarget = resolveCanonicalParentPath(absTarget);
  const fromParent = canonParentTarget !== null ? computeValidatedRel(canonBase, canonParentTarget) : null;
  if (fromParent !== null) return fromParent;
  const targetStat = fs.statSync(absTarget, { throwIfNoEntry: false });
  if (targetStat !== undefined && targetStat.isDirectory()) {
    const canonDirTarget = resolveCanonicalPath(absTarget);
    if (canonDirTarget !== null) return computeValidatedRel(canonBase, canonDirTarget);
  }
  return null;
}

function resolveWindowsDiskCasing(absPath: string, normRoot: string, precomputedCanonRoot?: string | null): string {
  if (process.platform !== 'win32') return absPath;
  const st = fs.lstatSync(absPath, { throwIfNoEntry: false });
  if (st === undefined || st.isSymbolicLink()) return absPath;
  const realAbs = tryRealpath(absPath);
  if (realAbs === null) return absPath;
  if (foldPathForCompare(realAbs) === foldPathForCompare(absPath)) return realAbs;
  const canonRoot = precomputedCanonRoot !== undefined ? precomputedCanonRoot : resolveCanonicalPath(normRoot);
  if (canonRoot === null) return absPath;
  const rel = computeValidatedRel(canonRoot, realAbs);
  return rel !== null ? path.resolve(normRoot, rel) : absPath;
}

export function normalizeAddPathForGit(
  cwd: string,
  repoRoot: string,
  rawPath: string,
  precomputedCanonRoot?: string | null
): string {
  const abs = path.resolve(cwd, rawPath);
  const normRoot = path.resolve(repoRoot);
  if (foldPathForCompare(abs) === foldPathForCompare(normRoot)) return normRoot;
  if (isStrictlyUnderLexicalDir(normRoot, abs)) return resolveWindowsDiskCasing(abs, normRoot, precomputedCanonRoot);
  if (isSameResolvedPath(abs, normRoot)) return normRoot;
  const relFromRoot = getValidatedRepoRelPath(normRoot, abs);
  return relFromRoot !== null
    ? resolveWindowsDiskCasing(path.resolve(normRoot, relFromRoot), normRoot, precomputedCanonRoot)
    : abs;
}

export function anyPathTargetsDir(baseDir: string, paths: readonly string[], targetDir: string): boolean {
  const normTarget = path.resolve(targetDir);
  const foldedTarget = foldPathForCompare(normTarget);
  let canonTarget: string | null | undefined;
  for (const p of paths) {
    const abs = path.resolve(baseDir, p);
    if (foldPathForCompare(abs) === foldedTarget) return true;
    if (isStrictlyUnderLexicalDir(normTarget, abs)) continue;
    if (canonTarget === undefined) canonTarget = resolveCanonicalPath(normTarget);
    if (canonTarget === null) continue;
    const canonAbs = resolveCanonicalPath(abs);
    if (canonAbs !== null && foldPathForCompare(canonAbs) === foldPathForCompare(canonTarget)) return true;
  }
  return false;
}

export function hasGitDirEnvOverride(): boolean {
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

function hasInterveningGitEntryLexical(startDir: string, stopDir: string): boolean {
  const foldedStop = foldPathForCompare(path.resolve(stopDir));
  let current = path.resolve(startDir);
  while (foldPathForCompare(current) !== foldedStop) {
    if (fs.lstatSync(path.join(current, '.git'), { throwIfNoEntry: false }) !== undefined) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
  return false;
}

function hasInterveningGitEntry(cwd: string, candidateRoot: string): boolean {
  const absCwd = path.resolve(cwd);
  const absCandidate = path.resolve(candidateRoot);
  if (isStrictlyUnderLexicalDir(absCandidate, absCwd) && hasInterveningGitEntryLexical(absCwd, absCandidate)) {
    return true;
  }
  const canonCwd = resolveCanonicalPath(absCwd);
  const canonCandidate = resolveCanonicalPath(absCandidate);
  if (canonCwd === null || canonCandidate === null) return true;
  if (
    foldPathForCompare(canonCwd) === foldPathForCompare(absCwd) &&
    foldPathForCompare(canonCandidate) === foldPathForCompare(absCandidate)
  ) {
    return !isStrictlyUnderLexicalDir(absCandidate, absCwd);
  }
  if (foldPathForCompare(canonCwd) === foldPathForCompare(canonCandidate)) return false;
  return hasInterveningGitEntryLexical(canonCwd, canonCandidate);
}

function canUseDotGitParentAsRoot(cwd: string, resolvedGitDir: string): boolean {
  if (hasGitDirEnvOverride() || path.basename(resolvedGitDir).toLowerCase() !== '.git') {
    return false;
  }
  const gitDirStat = fs.lstatSync(resolvedGitDir, { throwIfNoEntry: false });
  if (gitDirStat === undefined || gitDirStat.isSymbolicLink() || !gitDirStat.isDirectory()) {
    return false;
  }
  const candidateRoot = path.dirname(resolvedGitDir);
  if (isSameResolvedPath(cwd, candidateRoot)) return true;
  return getValidatedRepoRelPath(candidateRoot, cwd) !== null && !hasInterveningGitEntry(cwd, candidateRoot);
}

export function resolveRepoRootForGuard(cwd: string, resolvedGitDir: string | null): string {
  if (resolvedGitDir !== null) {
    if (canUseDotGitParentAsRoot(cwd, resolvedGitDir)) {
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
  const normalized = normalizeRelGitPath(filepath)
    .split('/')
    .map((seg) => stripWin32TrailingDotsAndSpaces(seg).toLowerCase())
    .join('/');
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

function queryMatchingGitRelPathMap(
  cwd: string,
  candidates: ReadonlyArray<{ original: string; relPosix: string }>,
  gitArgsPrefix: readonly string[]
): Map<string, string> {
  const matched = new Map<string, string>();
  if (candidates.length === 0) return matched;
  try {
    const prefix = process.platform === 'win32' ? ':(icase,literal)' : ':(literal)';
    const pathspecs = candidates.map((c) => `${prefix}${c.relPosix}`);
    const res = spawnSync('git', [...gitArgsPrefix, '--', ...pathspecs], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (res.status !== 0 || typeof res.stdout !== 'string') return matched;
    const hitMap = new Map<string, string>();
    for (const rawHit of res.stdout.split('\0')) {
      if (rawHit.length > 0) hitMap.set(foldPathForCompare(rawHit), rawHit);
    }
    for (const item of candidates) {
      const canonicalRel = hitMap.get(foldPathForCompare(item.relPosix));
      if (canonicalRel !== undefined) {
        matched.set(item.original, path.resolve(cwd, canonicalRel));
      }
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
    if (onlyMissing && fs.lstatSync(path.resolve(cwd, targetPath), { throwIfNoEntry: false }) !== undefined) {
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
 * [INTENT]: Batched single-subprocess detector returning input -> canonical disk/index path for `--add`
 * targets that are missing on disk and already staged as deletions (`D  <path>`), preventing `git add` exit 128.
 */
export function findAlreadyStagedDeletionMap(
  cwd: string,
  targetPaths: readonly string[],
  resolvedGitDir?: string | null
): Map<string, string> {
  const { queryCwd, candidates } = resolveTargetsForGitQuery(cwd, targetPaths, true, resolvedGitDir);
  return queryMatchingGitRelPathMap(queryCwd, candidates, ['diff', '--cached', '--relative', '--name-only', '--diff-filter=D', '-z']);
}

export function findAlreadyStagedDeletions(
  cwd: string,
  targetPaths: readonly string[],
  resolvedGitDir?: string | null
): Set<string> {
  return new Set(findAlreadyStagedDeletionMap(cwd, targetPaths, resolvedGitDir).keys());
}

export function findTrackedIndexPathMap(
  cwd: string,
  targetPaths: readonly string[],
  resolvedGitDir?: string | null
): Map<string, string> {
  const { queryCwd, candidates } = resolveTargetsForGitQuery(cwd, targetPaths, false, resolvedGitDir);
  return queryMatchingGitRelPathMap(queryCwd, candidates, ['ls-files', '-z']);
}

export function findTrackedIndexPaths(
  cwd: string,
  targetPaths: readonly string[],
  resolvedGitDir?: string | null
): Set<string> {
  return new Set(findTrackedIndexPathMap(cwd, targetPaths, resolvedGitDir).keys());
}

/**
 * [INTENT]: Detect when a single `--add <path>` target has already been staged as deleted (`D  <path>`).
 */
export function isAlreadyStagedDeletion(cwd: string, targetPath: string): boolean {
  return findAlreadyStagedDeletions(cwd, [targetPath]).has(targetPath);
}

const GLOB_META_RE = /[*?[\]]/;

export function isGlobTarget(p: string): boolean {
  return GLOB_META_RE.test(p);
}

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
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error !== undefined || res.status !== 0 || typeof res.stdout !== 'string') {
    const detail = res.error?.message || (typeof res.stderr === 'string' ? res.stderr.trim() : '') || `exit ${String(res.status)}`;
    throw new Error(`Failed pre-stage status check in '${cwd}': ${detail}`);
  }
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
    if (indexStatus !== 'D' && workTreeStatus !== 'D' && (isScratchRepoPath(filepath) || isSensitiveRepoPath(filepath))) {
      scratchHits.push(filepath);
    }
    i += indexStatus === 'R' || indexStatus === 'C' || workTreeStatus === 'R' || workTreeStatus === 'C' ? 2 : 1;
  }
  return scratchHits;
}

/**
 * [INTENT]: Detect unmerged conflict entries (`UU`/`AA`/`DD`) in `.git/index` before
 * `git add` can silently mark conflicts resolved (e.g. `git stash pop` conflicts).
 */
export function findUnmergedPaths(cwd: string): string[] {
  const res = spawnSync('git', ['ls-files', '-u', '-z', '--full-name', '--', ':(top)'], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error !== undefined || res.status !== 0 || typeof res.stdout !== 'string') {
    const detail = res.error?.message || (typeof res.stderr === 'string' ? res.stderr.trim() : '') || `exit ${String(res.status)}`;
    throw new Error(`Failed unmerged index check in '${cwd}': ${detail}`);
  }
  if (res.stdout.length === 0) return [];
  const unmerged = new Set<string>();
  for (const record of res.stdout.split('\0')) {
    if (!record) continue;
    const tabIdx = record.indexOf('\t');
    if (tabIdx !== -1 && tabIdx + 1 < record.length) {
      unmerged.add(record.slice(tabIdx + 1));
    }
  }
  return Array.from(unmerged);
}
