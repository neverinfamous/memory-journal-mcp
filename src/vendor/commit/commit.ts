// @ts-nocheck
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateHistoryEntry,
  createJournalEntry,
  resolveJournalTarget,
} from './commit-journal.js';
import {
  CANONICAL_RELATION_TYPES,
  CONVENTIONAL_COMMIT_REGEX,
  cliSchema,
  fatalError,
  getErrorMessage,
  parseArguments,
} from './commit-cli-schema.js';
import {
  abortIfScratchPaths,
  anyPathTargetsDir,
  findAlreadyStagedDeletionMap,
  findAlreadyStagedDeletions,
  findScratchInDirOrGlobTargets,
  findTrackedIndexPathMap,
  findTrackedIndexPaths,
  findUnmergedPaths,
  getValidatedRepoRelPath,
  hasGitDirEnvOverride,
  isAlreadyStagedDeletion,
  isGlobTarget,
  isScratchRepoPath,
  normalizeAddPathForGit,
  normalizeRelGitPath,
  resolveCanonicalPath,
  resolveGitDir,
  resolveRepoRootForGuard,
} from './commit-git-paths.js';
import {
  assertSafeCliPath,
  cleanupPrivateTempDir,
  createPrivateTempFile,
  hasDisallowedControlChars,
  isSensitiveRepoPath,
  parseStagedStatus,
  readBoundedHistoryFile,
  redactSensitiveText,
} from './commit-security.js';

export { cliSchema, CANONICAL_RELATION_TYPES, findAlreadyStagedDeletions, isAlreadyStagedDeletion };

const COMMIT_MSG_PREFIX = 'commit-msg-';
/** [INVARIANT]: Keep in sync with lib-agent-exec mutating-interceptors STALE_INDEX_LOCK_MS (5 minutes). */
const STALE_LOCK_MS = 5 * 60 * 1000;

function healStaleIndexLock(resolvedGitDir: string): void {
  const lockFile = path.join(resolvedGitDir, 'index.lock');
  const lockStats = fs.statSync(lockFile, { throwIfNoEntry: false });
  if (lockStats === undefined) return;
  const ageMs = Date.now() - lockStats.mtimeMs;
  if (ageMs > STALE_LOCK_MS) {
    try {
      fs.unlinkSync(lockFile);
      console.warn(`⚠️ AUTONOMOUS HEALING: Removed stale git index.lock (${Math.round(ageMs / 60000)}m old) in ${resolvedGitDir}`);
    } catch {
      // Ignore and let git surface the error if locked by an active process
    }
  }
}

function assertNoMergeRebaseConflict(resolvedGitDir: string): void {
  if (
    fs.statSync(path.join(resolvedGitDir, 'MERGE_HEAD'), { throwIfNoEntry: false }) !== undefined ||
    fs.statSync(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD'), { throwIfNoEntry: false }) !== undefined ||
    fs.statSync(path.join(resolvedGitDir, 'REVERT_HEAD'), { throwIfNoEntry: false }) !== undefined ||
    fs.statSync(path.join(resolvedGitDir, 'rebase-merge'), { throwIfNoEntry: false }) !== undefined ||
    fs.statSync(path.join(resolvedGitDir, 'rebase-apply'), { throwIfNoEntry: false }) !== undefined
  ) {
    fatalError('Repository is in a merge/rebase/cherry-pick/revert conflict state. Resolve conflicts first.');
  }
}

function resolveScratchCandidateRelPath(cwd: string, guardRoot: string, targetPath: string): string | null {
  const fromGuardRoot = getValidatedRepoRelPath(guardRoot, targetPath);
  if (fromGuardRoot !== null) return fromGuardRoot;
  const relFromCwd = path.relative(cwd, path.resolve(cwd, targetPath));
  if (relFromCwd.length > 0 && !path.isAbsolute(relFromCwd)) {
    return normalizeRelGitPath(relFromCwd);
  }
  return null;
}

function resolveSymlinkRealRelPath(absTarget: string, repoRoot: string): string | null {
  const realTarget = resolveCanonicalPath(absTarget);
  if (realTarget === null) return null;
  return getValidatedRepoRelPath(repoRoot, realTarget) ?? normalizeRelGitPath(realTarget);
}

function assertPreStageTargetsSafe(
  cwd: string,
  repoRoot: string,
  pathsToStage: readonly string[],
  resolvedGitDir: string | null
): void {
  const candidateScratch: Array<{ raw: string; rel: string; missingOnDisk: boolean }> = [];
  for (const p of pathsToStage) {
    assertSafeCliPath(p, '--add');
    const rel = resolveScratchCandidateRelPath(cwd, repoRoot, p);
    const absTarget = path.resolve(cwd, p);
    const lstat = fs.lstatSync(absTarget, { throwIfNoEntry: false });
    const symlinkReal = resolveSymlinkRealRelPath(absTarget, repoRoot);
    if (isSensitiveRepoPath(p) || (rel !== null && isSensitiveRepoPath(rel)) || (symlinkReal !== null && isSensitiveRepoPath(symlinkReal))) {
      fatalError(`Refusing to stage sensitive file '${p}'. Remove it from --add.`);
    }
    const blockedRel = (rel !== null && isScratchRepoPath(rel)) ? rel : (symlinkReal !== null && isScratchRepoPath(symlinkReal) ? symlinkReal : null);
    if (blockedRel !== null) {
      candidateScratch.push({ raw: p, rel: blockedRel, missingOnDisk: lstat === undefined });
    }
  }
  if (candidateScratch.length > 0) {
    const missingCandidates = candidateScratch.filter((c) => c.missingOnDisk).map((c) => c.raw);
    const trackedDeletions =
      missingCandidates.length > 0 ? findTrackedIndexPaths(cwd, missingCandidates, resolvedGitDir) : new Set<string>();
    const scratchToStage = candidateScratch
      .filter((c) => !c.missingOnDisk || !trackedDeletions.has(c.raw))
      .map((c) => c.rel);
    if (scratchToStage.length > 0) abortIfScratchPaths(scratchToStage);
  }
}

function stageExplicitFiles(
  cwd: string,
  filesToAdd: readonly string[],
  resolvedGitDir: string | null,
  repoRoot: string,
  precomputedStagedDeletions?: ReadonlySet<string>,
  precomputedCheckedNotStaged?: ReadonlySet<string>
): void {
  const unchecked =
    (precomputedStagedDeletions !== undefined && precomputedStagedDeletions.size > 0) ||
    (precomputedCheckedNotStaged !== undefined && precomputedCheckedNotStaged.size > 0)
      ? filesToAdd.filter(
          (f) =>
            !(precomputedStagedDeletions?.has(f) ?? false) &&
            !(precomputedCheckedNotStaged?.has(f) ?? false)
        )
      : filesToAdd;
  const extraDeletions = unchecked.length > 0 ? findAlreadyStagedDeletions(cwd, unchecked, resolvedGitDir) : new Set<string>();
  const pathsToStage = filesToAdd.filter((f) => !(precomputedStagedDeletions?.has(f) ?? false) && !extraDeletions.has(f));
  if (pathsToStage.length < filesToAdd.length) {
    console.warn('⚠️ AUTONOMOUS HEALING: Skipping git add for already-staged deletion(s) (preserving staged removal for commit).');
  }
  assertPreStageTargetsSafe(cwd, repoRoot, pathsToStage, resolvedGitDir);
  if (pathsToStage.length > 0) {
    const nestedBlocked = findScratchInDirOrGlobTargets(cwd, pathsToStage);
    if (nestedBlocked.length > 0) {
      const sensitive = nestedBlocked.filter((f) => isSensitiveRepoPath(f));
      if (sensitive.length > 0) fatalError(`Refusing to stage sensitive file(s): ${sensitive.join(', ')}`);
      abortIfScratchPaths(nestedBlocked);
    }
    const unmergedPaths = findUnmergedPaths(repoRoot);
    if (unmergedPaths.length > 0) {
      fatalError(`Unmerged conflict path(s) detected in index (${unmergedPaths.join(', ')}). Resolve conflicts before committing.`);
    }
    try {
      execFileSync('git', ['add', '--', ...pathsToStage], { stdio: 'inherit', cwd, windowsHide: true });
    } catch (e) {
      fatalError(`Error adding files: ${getErrorMessage(e)}`);
    }
  }
}

function ensureStagedFiles(
  cwd: string,
  filesToAdd?: string[],
  precomputedStagedDeletions?: ReadonlySet<string>,
  precomputedCheckedNotStaged?: ReadonlySet<string>,
  resolvedGitDirArg?: string | null,
  repoRootArg?: string
): string[] {
  const resolvedGitDir = resolvedGitDirArg !== undefined ? resolvedGitDirArg : resolveGitDir(cwd);
  const repoRoot = repoRootArg ?? resolveRepoRootForGuard(cwd, resolvedGitDir);
  if (resolvedGitDir !== null) {
    healStaleIndexLock(resolvedGitDir);
    assertNoMergeRebaseConflict(resolvedGitDir);
  }

  if (filesToAdd !== undefined && filesToAdd.length > 0) {
    stageExplicitFiles(cwd, filesToAdd, resolvedGitDir, repoRoot, precomputedStagedDeletions, precomputedCheckedNotStaged);
  }

  let status: string;
  try {
    const statusArgs = ['status', '-z'];
    if (filesToAdd && filesToAdd.length > 0 && !anyPathTargetsDir(cwd, filesToAdd, repoRoot)) {
      statusArgs.push('-uno', '--', ...filesToAdd);
    }
    status = execFileSync('git', statusArgs, { encoding: 'utf-8', cwd, windowsHide: true });
  } catch (e) {
    fatalError(`Not a git repository or git command failed.\n${getErrorMessage(e)}`);
  }

  const { hasStagedFiles, stagedScratchFiles, stagedSensitiveFiles, stagedFiles, unmergedFiles } = parseStagedStatus(
    status,
    isScratchRepoPath
  );

  if (unmergedFiles.length > 0) {
    fatalError(`Unmerged conflict path(s) detected in index (${unmergedFiles.join(', ')}). Resolve conflicts before committing.`);
  }

  if (!hasStagedFiles) {
    console.error('🛠️ AUTONOMOUS HEALING: No files staged for commit.');
    console.error('You MUST explicitly stage the files you want to commit using `git add <file-path>` before running this wrapper.');
    console.error('If you used `git add .` or `--add .`, ensure you actually had modified files to stage.');
    try {
      const shortStatus = execFileSync('git', ['status', '--short'], { encoding: 'utf-8', cwd, windowsHide: true });
      if (shortStatus.trim()) {
        console.error('Current status:');
        console.error(shortStatus);
      }
    } catch {
      // Non-fatal: still abort via fatalError below
    }
    fatalError('No files staged for commit.');
  }

  if (stagedSensitiveFiles.length > 0) {
    fatalError(`Commit aborted: Sensitive file(s) staged (${stagedSensitiveFiles.join(', ')}).`);
  }
  if (stagedScratchFiles.length > 0) {
    abortIfScratchPaths(stagedScratchFiles);
  }

  return stagedFiles;
}

// [INTENT]: Executes native git commit. [SIDE-EFFECT]: Writes the commit message to a private temporary file on disk rather than passing it inline to prevent shell escaping traps.
function executeCommit(
  header: string,
  body: string,
  cwd?: string,
  onlyFiles?: string[],
  repoRoot?: string
): string {
  const { dirPath: msgDir, filePath: msgFile } = createPrivateTempFile(COMMIT_MSG_PREFIX, 'commit-msg.txt', `${header}${body}`);
  try {
    const commitArgs = ['commit', '-q', '-F', msgFile];
    const absCwd = path.resolve(cwd ?? process.cwd());
    const isolationRoot = repoRoot ?? absCwd;
    if (onlyFiles && onlyFiles.length > 0 && !anyPathTargetsDir(absCwd, onlyFiles, isolationRoot)) {
      commitArgs.push('--only', '--', ...onlyFiles);
    }
    execFileSync('git', commitArgs, { stdio: 'inherit', cwd, windowsHide: true });
  } finally {
    cleanupPrivateTempDir(msgDir);
  }

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd, windowsHide: true }).trim();
  console.log(`\n✅ Successfully committed ${sha.slice(0, 7)} (${sha})`);
  console.log(`__COMMIT_SHA__:${sha}`);

  return sha;
}

let didRunCliMain = false;

function resolveExplicitAddPaths(
  cwd: string,
  rawAdd: readonly string[],
  repoRoot: string,
  resolvedGitDir?: string | null,
  allowSpaceSplit = true,
  precomputedCanonRoot?: string | null
): { paths: string[]; knownStagedDeletions: Set<string>; checkedNotStagedDeletions: Set<string> } {
  const canonRoot =
    precomputedCanonRoot !== undefined
      ? precomputedCanonRoot
      : (process.platform === 'win32' ? resolveCanonicalPath(repoRoot) : null);
  const classified: Array<{ isMissing: boolean; hasSpace: boolean; raw: string; resolved: string }> = [];
  const missingRaw: string[] = [];

  for (const p of rawAdd) {
    if (p.trim().length === 0) fatalError('File path for --add cannot be empty.');
    assertSafeCliPath(p, '--add');
    const resolved = normalizeAddPathForGit(cwd, repoRoot, p, canonRoot);
    const isMissing = !isGlobTarget(p) && fs.lstatSync(resolved, { throwIfNoEntry: false }) === undefined;
    classified.push({ isMissing, hasSpace: allowSpaceSplit && p.includes(' '), raw: p, resolved });
    if (isMissing) missingRaw.push(p);
  }

  const stagedDelMap =
    missingRaw.length > 0 ? findAlreadyStagedDeletionMap(cwd, missingRaw, resolvedGitDir) : new Map<string, string>();
  const remainingMissing = missingRaw.filter((p) => !stagedDelMap.has(p));
  const needTrackedQuery = process.platform === 'win32' ? remainingMissing : remainingMissing.filter((p) => p.includes(' '));
  const trackedIndexMap =
    needTrackedQuery.length > 0 ? findTrackedIndexPathMap(cwd, needTrackedQuery, resolvedGitDir) : new Map<string, string>();

  const paths: string[] = [];
  const knownStagedDeletions = new Set<string>();
  const checkedNotStagedDeletions = new Set<string>();
  const splitTokens: string[] = [];
  for (const item of classified) {
    const stagedCanonical = stagedDelMap.get(item.raw);
    const trackedCanonical = trackedIndexMap.get(item.raw);
    if (item.isMissing && item.hasSpace && stagedCanonical === undefined && trackedCanonical === undefined) {
      console.warn(`⚠️ AUTONOMOUS HEALING: Path '${item.raw}' not found and contains spaces. Splitting by space to recover hallucinated --add list.`);
      for (const sp of item.raw.split(/\s+/).filter(Boolean)) splitTokens.push(sp);
      continue;
    }
    const finalPath = stagedCanonical ?? trackedCanonical ?? item.resolved;
    if (item.isMissing) {
      if (stagedCanonical !== undefined) knownStagedDeletions.add(finalPath);
      else checkedNotStagedDeletions.add(finalPath);
    }
    paths.push(finalPath);
  }
  if (splitTokens.length > 0) {
    const splitRes = resolveExplicitAddPaths(cwd, splitTokens, repoRoot, resolvedGitDir, false, canonRoot);
    paths.push(...splitRes.paths);
    for (const p of splitRes.knownStagedDeletions) knownStagedDeletions.add(p);
    for (const p of splitRes.checkedNotStagedDeletions) checkedNotStagedDeletions.add(p);
  }
  return { paths, knownStagedDeletions, checkedNotStagedDeletions };
}

function resolveHistoryContent(args: ReturnType<typeof parseArguments>, cwd: string): string {
  let historyContent = args.history ? args.history.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
  const historyFile = args['history-file'];
  if (historyFile !== undefined && historyFile.length > 0) {
    assertSafeCliPath(historyFile, '--history-file');
    const candidateCwdPath = path.resolve(cwd, historyFile);
    const candidateExists = fs.lstatSync(candidateCwdPath, { throwIfNoEntry: false }) !== undefined;
    const fallbackPath = path.resolve(historyFile);
    const fallbackExists = !candidateExists && fallbackPath !== candidateCwdPath && fs.lstatSync(fallbackPath, { throwIfNoEntry: false }) !== undefined;
    const resolvedPath = candidateExists ? candidateCwdPath : fallbackPath;
    if (!candidateExists && !fallbackExists) {
      console.warn(`⚠️ AUTONOMOUS HEALING: History file '${historyFile}' not found. Defaulting to --no-history.`);
      historyContent = '';
      args['no-history'] = true;
    } else {
      try {
        historyContent = readBoundedHistoryFile(resolvedPath).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (hasDisallowedControlChars(historyContent)) {
          fatalError('History file contains disallowed control characters or NUL bytes.');
        }
      } catch (e) {
        fatalError(`Error reading history file: ${getErrorMessage(e)}`);
      }
    }
  }
  if (historyContent.trim().length === 0) {
    historyContent = '';
  }
  if (historyContent.length === 0 && !args['no-history']) {
    console.warn("⚠️ AUTONOMOUS HEALING: Missing history flag detected. Defaulting to --no-history.");
    args['no-history'] = true;
  }
  return historyContent;
}

export async function main(rawArgv?: readonly string[]): Promise<void> {
  didRunCliMain = true;
  try {
    const args = parseArguments(rawArgv);

    let cwd = process.cwd();
    if (args.cwd !== undefined) {
      assertSafeCliPath(args.cwd, '--cwd');
      const targetCwd = path.resolve(args.cwd);
      const cwdStats = fs.statSync(targetCwd, { throwIfNoEntry: false });
      if (cwdStats === undefined || !cwdStats.isDirectory()) {
        fatalError(`Commit failed: Directory does not exist or is not a directory: ${targetCwd}`);
      }
      cwd = targetCwd;
    }

    const hasGitEnvOverride = hasGitDirEnvOverride();
    if (!hasGitEnvOverride) {
      cwd = resolveCanonicalPath(cwd) ?? cwd;
    }

    const resolvedGitDir = resolveGitDir(cwd);
    const repoRoot = resolveRepoRootForGuard(cwd, resolvedGitDir);
    if (hasGitEnvOverride) {
      cwd = normalizeAddPathForGit(cwd, repoRoot, '.');
    }

    let knownStagedDeletions: Set<string> | undefined;
    let checkedNotStagedDeletions: Set<string> | undefined;
    if (args.add) {
      const resolvedAdd = resolveExplicitAddPaths(cwd, args.add, repoRoot, resolvedGitDir);
      args.add = resolvedAdd.paths;
      knownStagedDeletions = resolvedAdd.knownStagedDeletions;
      checkedNotStagedDeletions = resolvedAdd.checkedNotStagedDeletions;
    }

    const firstLine = args.msg.trim().split('\n')[0].trim();
    const commitMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
    const type = commitMatch ? commitMatch[1] : 'chore';
    const historyContent = resolveHistoryContent(args, cwd);
    const stagedFiles = ensureStagedFiles(
      cwd,
      args.add,
      knownStagedDeletions,
      checkedNotStagedDeletions,
      resolvedGitDir,
      repoRoot
    );

    const resolvedJournalTarget = args.journal ? resolveJournalTarget(cwd, args['journal-project']) : undefined;
    const body = generateHistoryEntry(args, type, historyContent, cwd, resolvedJournalTarget);
    const sha = executeCommit(args.msg, body, cwd, args.add, repoRoot);
    await createJournalEntry(
      sha, args.msg, args, historyContent, cwd, () => {}, () => {},
      getErrorMessage, stagedFiles.length > 0 ? stagedFiles : undefined, resolvedJournalTarget
    );

  } catch (error) {
    if (error instanceof Error && error.stack) {
      console.error(redactSensitiveText(error.stack));
    }
    fatalError(`Commit failed: ${getErrorMessage(error)}`);
  }
}

function shouldAutoRunMain(): boolean {
  if (didRunCliMain) return false;
  if (typeof import.meta.main === 'boolean' && import.meta.main) {
    return true;
  }
  const entryArg = process.argv[1];
  if (entryArg === undefined || entryArg.length === 0) return false;
  const resolved = path.resolve(entryArg).replace(/\\/g, '/');
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return (
    normalized.endsWith('/dist/vendor/commit/commit.js') ||
    normalized.endsWith('/src/vendor/commit/commit.ts') ||
    normalized.endsWith('/.agents/scripts/commit.ts')
  );
}

if (shouldAutoRunMain()) {
  void main();
}
