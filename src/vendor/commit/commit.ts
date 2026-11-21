// @ts-nocheck
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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

export { cliSchema, CANONICAL_RELATION_TYPES };

const COMMIT_MSG_PREFIX = 'commit-msg-';
/** [INVARIANT]: Keep in sync with lib-agent-exec mutating-interceptors STALE_INDEX_LOCK_MS (5 minutes). */
const STALE_LOCK_MS = 5 * 60 * 1000;

function normalizeRelGitPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function isSameResolvedPath(a: string, b: string): boolean {
  const normA = path.resolve(a);
  const normB = path.resolve(b);
  return process.platform === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

function getValidatedRepoRelPath(cwd: string, targetPath: string): string | null {
  const absTarget = path.resolve(cwd, targetPath);
  const rel = path.relative(cwd, absTarget);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return normalizeRelGitPath(rel);
}

/**
 * [INTENT]: Batched O(1)-subprocess detector for `--add` paths that are missing on disk and
 * already staged as deletions (`D  <path>`) in `.git/index`, preventing `git add` exit 128.
 */
export function findAlreadyStagedDeletions(cwd: string, targetPaths: readonly string[]): Set<string> {
  const stagedDeletions = new Set<string>();
  const missingTargets: Array<{ original: string; relPosix: string }> = [];

  for (const targetPath of targetPaths) {
    if (fs.statSync(path.resolve(cwd, targetPath), { throwIfNoEntry: false }) !== undefined) continue;
    const relPosix = getValidatedRepoRelPath(cwd, targetPath);
    if (relPosix !== null) missingTargets.push({ original: targetPath, relPosix });
  }
  if (missingTargets.length === 0) return stagedDeletions;

  const gitOpts = { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true } as const;
  try {
    const indexRes = spawnSync('git', ['ls-files', '-z', '--', ...missingTargets.map((m) => m.relPosix)], gitOpts);
    if (indexRes.status !== 0) return stagedDeletions;
    const indexedSet = new Set((typeof indexRes.stdout === 'string' ? indexRes.stdout : '').split('\0').filter(Boolean));
    const unindexedTargets = missingTargets.filter((m) => !indexedSet.has(m.relPosix));
    if (unindexedTargets.length === 0) return stagedDeletions;

    const cachedDelRes = spawnSync(
      'git',
      ['diff', '--cached', '--relative', '--name-only', '--diff-filter=D', '-z', '--', ...unindexedTargets.map((m) => m.relPosix)],
      gitOpts,
    );
    if (cachedDelRes.status !== 0 || typeof cachedDelRes.stdout !== 'string') return stagedDeletions;
    const cachedDeletedSet = new Set(cachedDelRes.stdout.split('\0').filter(Boolean));
    for (const item of unindexedTargets) {
      if (cachedDeletedSet.has(item.relPosix)) stagedDeletions.add(item.original);
    }
  } catch {
    return stagedDeletions;
  }
  return stagedDeletions;
}

/**
 * [INTENT]: Detect when a single `--add <path>` target has already been staged as deleted (`D  <path>`).
 */
export function isAlreadyStagedDeletion(cwd: string, targetPath: string): boolean {
  return findAlreadyStagedDeletions(cwd, [targetPath]).has(targetPath);
}

function resolveGitDir(cwd: string): string | null {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8', cwd, windowsHide: true }).trim();
    return gitDir.length > 0 ? path.resolve(cwd, gitDir) : null;
  } catch {
    return null;
  }
}

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
    fs.statSync(path.join(resolvedGitDir, 'rebase-merge'), { throwIfNoEntry: false }) !== undefined ||
    fs.statSync(path.join(resolvedGitDir, 'rebase-apply'), { throwIfNoEntry: false }) !== undefined
  ) {
    fatalError('Repository is in a merge/rebase state. Resolve conflicts first.');
  }
}

function isScratchRepoPath(filepath: string): boolean {
  const normalized = normalizeRelGitPath(filepath);
  return (
    normalized.includes('scratch/') ||
    normalized.includes('.agents/scratch') ||
    normalized.endsWith('scratch.ts') ||
    normalized.endsWith('scratch.js')
  );
}

function abortIfScratchPaths(scratchFiles: readonly string[]): void {
  console.error('🛠️ AUTONOMOUS HEALING: Scratch files detected in staging area.');
  console.error('You MUST NOT commit scratch scripts, test data, or debug payloads. Please unstage the following files:');
  for (const file of scratchFiles) console.error(`- ${file}`);
  fatalError('Commit aborted: Scratch files staged.');
}

function stageExplicitFiles(cwd: string, filesToAdd: readonly string[], precomputedStagedDeletions?: ReadonlySet<string>): void {
  const unchecked =
    precomputedStagedDeletions !== undefined && precomputedStagedDeletions.size > 0
      ? filesToAdd.filter((f) => !precomputedStagedDeletions.has(f))
      : filesToAdd;
  const extraDeletions = unchecked.length > 0 ? findAlreadyStagedDeletions(cwd, unchecked) : new Set<string>();
  const pathsToStage = filesToAdd.filter((f) => !(precomputedStagedDeletions?.has(f) ?? false) && !extraDeletions.has(f));
  if (pathsToStage.length < filesToAdd.length) {
    console.warn('⚠️ AUTONOMOUS HEALING: Skipping git add for already-staged deletion(s) (preserving staged removal for commit).');
  }
  const scratchToStage: string[] = [];
  for (const p of pathsToStage) {
    const rel = getValidatedRepoRelPath(cwd, p);
    if (rel !== null && isScratchRepoPath(rel)) scratchToStage.push(rel);
  }
  if (scratchToStage.length > 0) abortIfScratchPaths(scratchToStage);
  if (pathsToStage.length > 0) {
    try {
      execFileSync('git', ['add', '--', ...pathsToStage], { stdio: 'inherit', cwd, windowsHide: true });
    } catch (e) {
      fatalError(`Error adding files: ${getErrorMessage(e)}`);
    }
  }
}

function parseStagedStatus(status: string): { hasStagedFiles: boolean; stagedScratchFiles: string[]; stagedFiles: string[] } {
  const parts = status.split('\0');
  const stagedScratchFiles: string[] = [];
  const stagedFiles: string[] = [];
  let hasStagedFiles = false;

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

    if (indexStatus !== ' ' && indexStatus !== '?') {
      hasStagedFiles = true;
      stagedFiles.push(filepath);
      if (indexStatus !== 'D' && isScratchRepoPath(filepath)) {
        stagedScratchFiles.push(filepath);
      }
    }

    if (indexStatus === 'R' || indexStatus === 'C' || workTreeStatus === 'R' || workTreeStatus === 'C') {
      i += 2;
    } else {
      i += 1;
    }
  }
  return { hasStagedFiles, stagedScratchFiles, stagedFiles };
}

// [INTENT]: Validates the git index state to prevent accidental staging of agent scratch payloads. [SIDE-EFFECT]: Aborts process if '.agents/scratch' paths are detected in the staging area. [AGENT-HINT]: Do NOT bypass this check; it is a critical safeguard for the project repository.
function ensureStagedFiles(
  cwd: string,
  filesToAdd?: string[],
  precomputedStagedDeletions?: ReadonlySet<string>
): string[] {
  const resolvedGitDir = resolveGitDir(cwd);
  if (resolvedGitDir !== null) {
    healStaleIndexLock(resolvedGitDir);
  }

  if (filesToAdd !== undefined && filesToAdd.length > 0) {
    stageExplicitFiles(cwd, filesToAdd, precomputedStagedDeletions);
  }

  if (resolvedGitDir !== null) {
    assertNoMergeRebaseConflict(resolvedGitDir);
  }

  let status: string;
  try {
    const statusArgs = ['status', '-z'];
    const absCwd = path.resolve(cwd);
    if (filesToAdd && filesToAdd.length > 0 && !filesToAdd.some((f) => isSameResolvedPath(path.resolve(cwd, f), absCwd))) {
      statusArgs.push('-uno', '--', ...filesToAdd);
    }
    status = execFileSync('git', statusArgs, { encoding: 'utf-8', cwd, windowsHide: true });
  } catch (e) {
    fatalError(`Not a git repository or git command failed.\n${getErrorMessage(e)}`);
  }

  const { hasStagedFiles, stagedScratchFiles, stagedFiles } = parseStagedStatus(status);

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

  if (stagedScratchFiles.length > 0) {
    abortIfScratchPaths(stagedScratchFiles);
  }

  return stagedFiles;
}

const tempFilesToCleanup = new Set<string>();
process.on('exit', () => {
  for (const file of tempFilesToCleanup) {
    cleanupTempFile(file);
  }
});

function cleanupTempFile(filepath: string): void {
  try {
    if (fs.statSync(filepath, { throwIfNoEntry: false }) !== undefined) fs.unlinkSync(filepath);
    tempFilesToCleanup.delete(filepath);
  } catch { /* ignore */ }
}

// [INTENT]: Executes native git commit. [SIDE-EFFECT]: Writes the commit message to a temporary file on disk rather than passing it inline to prevent shell escaping traps. [DEPENDENCY]: Relies on node:os and node:crypto for safe temp file generation.
function executeCommit(header: string, body: string, cwd?: string, onlyFiles?: string[]): string {
  const msgFile = path.join(os.tmpdir(), `${COMMIT_MSG_PREFIX}${crypto.randomUUID()}.txt`);
  tempFilesToCleanup.add(msgFile);
  fs.writeFileSync(msgFile, `${header}${body}`, { mode: 0o600 });
  try {
    const commitArgs = ['commit', '-q', '-F', msgFile];
    const absCwd = path.resolve(cwd ?? process.cwd());
    if (onlyFiles && onlyFiles.length > 0 && !onlyFiles.some((f) => isSameResolvedPath(path.resolve(absCwd, f), absCwd))) {
      commitArgs.push('--only', '--', ...onlyFiles);
    }
    execFileSync('git', commitArgs, { stdio: 'inherit', cwd, windowsHide: true });
  } finally {
    cleanupTempFile(msgFile);
  }

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd, windowsHide: true }).trim();
  console.log(`\n✅ Successfully committed ${sha.slice(0, 7)} (${sha})`);
  console.log(`__COMMIT_SHA__:${sha}`);

  return sha;
}

let didRunCliMain = false;

function resolveExplicitAddPaths(
  cwd: string,
  rawAdd: readonly string[]
): { paths: string[]; knownStagedDeletions: Set<string> } {
  const classified: Array<{ kind: 'direct' | 'spaced-missing'; raw: string; resolved: string }> = [];
  const spacedMissing: string[] = [];

  for (const p of rawAdd) {
    if (p.trim().length === 0) {
      fatalError('File path for --add cannot be empty.');
    }
    const resolved = path.resolve(cwd, p);
    if (p.includes(' ') && fs.statSync(resolved, { throwIfNoEntry: false }) === undefined) {
      classified.push({ kind: 'spaced-missing', raw: p, resolved });
      spacedMissing.push(p);
    } else {
      classified.push({ kind: 'direct', raw: p, resolved });
    }
  }

  const spacedStagedDeletions =
    spacedMissing.length > 0 ? findAlreadyStagedDeletions(cwd, spacedMissing) : new Set<string>();
  const paths: string[] = [];
  const knownStagedDeletions = new Set<string>();

  for (const item of classified) {
    if (item.kind === 'spaced-missing' && !spacedStagedDeletions.has(item.raw)) {
      console.warn(`⚠️ AUTONOMOUS HEALING: Path '${item.raw}' not found and contains spaces. Splitting by space to recover hallucinated --add list.`);
      for (const sp of item.raw.split(/\s+/).filter(Boolean)) {
        paths.push(path.resolve(cwd, sp));
      }
      continue;
    }
    if (item.kind === 'spaced-missing') {
      knownStagedDeletions.add(item.resolved);
    }
    paths.push(item.resolved);
  }
  return { paths, knownStagedDeletions };
}

function resolveHistoryContent(args: ReturnType<typeof parseArguments>, cwd: string): string {
  let historyContent = args.history ? args.history.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') : '';
  const historyFile = args['history-file'];
  if (historyFile !== undefined && historyFile.length > 0) {
    const candidateCwdPath = path.resolve(cwd, historyFile);
    const resolvedPath =
      fs.statSync(candidateCwdPath, { throwIfNoEntry: false }) !== undefined
        ? candidateCwdPath
        : path.resolve(historyFile);
    const resolvedExists =
      resolvedPath === candidateCwdPath || fs.statSync(resolvedPath, { throwIfNoEntry: false }) !== undefined;
    if (!resolvedExists) {
      console.warn(`⚠️ AUTONOMOUS HEALING: History file '${historyFile}' not found. Defaulting to --no-history.`);
      args['no-history'] = true;
    } else {
      try {
        historyContent = fs.readFileSync(resolvedPath, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      } catch (e) {
        fatalError(`Error reading history file: ${getErrorMessage(e)}`);
      }
    }
  }
  if (!historyContent && !args['no-history']) {
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
    if (args.cwd) {
      const targetCwd = path.resolve(args.cwd);
      const cwdStats = fs.statSync(targetCwd, { throwIfNoEntry: false });
      if (cwdStats === undefined || !cwdStats.isDirectory()) {
        fatalError(`Commit failed: Directory does not exist or is not a directory: ${targetCwd}`);
      }
      cwd = targetCwd;
    }

    let knownStagedDeletions: Set<string> | undefined;
    if (args.add) {
      const resolvedAdd = resolveExplicitAddPaths(cwd, args.add);
      args.add = resolvedAdd.paths;
      knownStagedDeletions = resolvedAdd.knownStagedDeletions;
    }

    const firstLine = args.msg.trim().split('\n')[0];
    const commitMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
    const type = commitMatch ? commitMatch[1] : 'chore';
    const stagedFiles = ensureStagedFiles(cwd, args.add, knownStagedDeletions);
    const historyContent = resolveHistoryContent(args, cwd);

    const resolvedJournalTarget = args.journal ? resolveJournalTarget(cwd, args['journal-project']) : undefined;
    const body = generateHistoryEntry(args, type, historyContent, cwd, resolvedJournalTarget);
    const sha = executeCommit(args.msg, body, cwd, args.add);
    await createJournalEntry(
      sha,
      args.msg,
      args,
      historyContent,
      cwd,
      (filepath) => { tempFilesToCleanup.add(filepath); },
      cleanupTempFile,
      getErrorMessage,
      stagedFiles.length > 0 ? stagedFiles : undefined,
      resolvedJournalTarget
    );

  } catch (error) {
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
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
