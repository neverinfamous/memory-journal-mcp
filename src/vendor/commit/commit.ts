// @ts-nocheck
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  generateHistoryEntry,
  createJournalEntry,
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

/**
 * [INTENT]: Detect when an `--add <path>` target has already been staged as deleted (`D  <path>`) in `.git/index`
 * and removed from disk, where re-running `git add <path>` would fail with exit 128 (`did not match any files`)
 * even though `git commit --only -- <path>` can commit the deletion directly.
 */
export function isAlreadyStagedDeletion(cwd: string, targetPath: string): boolean {
  const absTarget = path.resolve(cwd, targetPath);
  if (fs.existsSync(absTarget)) {
    return false;
  }
  const rel = path.relative(cwd, absTarget);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    return false;
  }
  try {
    const indexRes = spawnSync('git', ['ls-files', '-z', '--', absTarget], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (indexRes.status !== 0 || (typeof indexRes.stdout === 'string' && indexRes.stdout.length > 0)) {
      return false;
    }
    const cachedDelRes = spawnSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=D', '-z', '--', absTarget],
      {
        cwd,
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      },
    );
    return cachedDelRes.status === 0 && typeof cachedDelRes.stdout === 'string' && cachedDelRes.stdout.length > 0;
  } catch {
    return false;
  }
}

// [INTENT]: Validates the git index state to prevent accidental staging of agent scratch payloads. [SIDE-EFFECT]: Aborts process if '.agents/scratch' paths are detected in the staging area. [AGENT-HINT]: Do NOT bypass this check; it is a critical safeguard for the project repository.
function ensureStagedFiles(cwd: string, filesToAdd?: string[]): void {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8', cwd }).trim();
    const resolvedGitDir = path.resolve(cwd, gitDir);
    const lockFile = path.join(resolvedGitDir, 'index.lock');
    if (fs.existsSync(lockFile)) {
      const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (ageMs > 5 * 60 * 1000) {
        try {
          fs.unlinkSync(lockFile);
          console.warn(`⚠️ AUTONOMOUS HEALING: Removed stale git index.lock (${Math.round(ageMs / 60000)}m old) in ${resolvedGitDir}`);
        } catch {
          // Ignore and let git surface the error if locked by an active process
        }
      }
    }
  } catch {
    // Ignore error here and let git commands catch it properly
  }

  if (filesToAdd !== undefined && filesToAdd.length > 0) {
    const pathsToStage = filesToAdd.filter(f => !isAlreadyStagedDeletion(cwd, f));
    if (pathsToStage.length < filesToAdd.length) {
      console.warn(
        '⚠️ AUTONOMOUS HEALING: Skipping git add for already-staged deletion(s) (preserving staged removal for commit).',
      );
    }
    if (pathsToStage.length > 0) {
      try {
        execFileSync('git', ['add', ...pathsToStage], { stdio: 'inherit', cwd });
      } catch (e) {
        fatalError(`Error adding files: ${getErrorMessage(e)}`);
      }
    }
  }

  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8', cwd }).trim();
    const resolvedGitDir = path.resolve(cwd, gitDir);
    if (fs.existsSync(path.join(resolvedGitDir, 'MERGE_HEAD')) ||
        fs.existsSync(path.join(resolvedGitDir, 'rebase-merge')) ||
        fs.existsSync(path.join(resolvedGitDir, 'rebase-apply'))) {
      fatalError('Repository is in a merge/rebase state. Resolve conflicts first.');
    }
  } catch {
    // Ignore error here and let git status catch it properly
  }

  let status: string;
  try {
    const statusArgs = ['status', '-z'];
    if (filesToAdd && filesToAdd.length > 0 && !filesToAdd.some(f => path.resolve(cwd, f) === path.resolve(cwd))) {
      statusArgs.push('-uno', '--', ...filesToAdd);
    }
    status = execFileSync('git', statusArgs, { encoding: 'utf-8', cwd });
  } catch (e) {
    fatalError(`Not a git repository or git command failed.\n${getErrorMessage(e)}`);
  }

  const parts = status.split('\0');
  const stagedScratchFiles: string[] = [];
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
      if (indexStatus !== 'D') {
        if (filepath.includes('scratch/') || filepath.includes('.agents/scratch') || filepath.endsWith('scratch.ts') || filepath.endsWith('scratch.js')) {
          stagedScratchFiles.push(filepath);
        }
      }
    }
    
    if (indexStatus === 'R' || indexStatus === 'C' || workTreeStatus === 'R' || workTreeStatus === 'C') {
      i += 2;
    } else {
      i += 1;
    }
  }
  
  if (!hasStagedFiles) {
    console.error('🛠️ AUTONOMOUS HEALING: No files staged for commit.');
    console.error('You MUST explicitly stage the files you want to commit using `git add <file-path>` before running this wrapper.');
    console.error('If you used `git add .` or `--add .`, ensure you actually had modified files to stage.');
    const shortStatus = execSync('git status --short', { encoding: 'utf-8', cwd });
    if (shortStatus.trim()) {
      console.error('Current status:');
      console.error(shortStatus);
    }
    fatalError('No files staged for commit.');
  }

  if (stagedScratchFiles.length > 0) {
    console.error('🛠️ AUTONOMOUS HEALING: Scratch files detected in staging area.');
    console.error('You MUST NOT commit scratch scripts, test data, or debug payloads. Please unstage the following files:');
    for (const file of stagedScratchFiles) {
      console.error(`- ${file}`);
    }
    fatalError('Commit aborted: Scratch files staged.');
  }
}

const tempFilesToCleanup = new Set<string>();
process.on('exit', () => {
  for (const file of tempFilesToCleanup) {
    cleanupTempFile(file);
  }
});

function cleanupTempFile(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
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
    if (onlyFiles && onlyFiles.length > 0 && !onlyFiles.some(f => path.resolve(cwd ?? process.cwd(), f) === path.resolve(cwd ?? process.cwd()))) {
      commitArgs.push('--only', '--', ...onlyFiles);
    }
    execFileSync('git', commitArgs, { stdio: 'inherit', cwd });
  } finally {
      cleanupTempFile(msgFile);
  }

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd }).trim();
  console.log(`\n✅ Successfully committed ${sha.slice(0, 7)} (${sha})`);
  console.log(`__COMMIT_SHA__:${sha}`);
  
  return sha;
}

let didRunCliMain = false;

export async function main(rawArgv?: readonly string[]): Promise<void> {
  didRunCliMain = true;
  try {
    const args = parseArguments(rawArgv);

    let cwd = process.cwd();
    if (args.cwd) {
      const targetCwd = path.resolve(args.cwd);
      if (!fs.existsSync(targetCwd) || !fs.statSync(targetCwd).isDirectory()) {
        fatalError(`Commit failed: Directory does not exist or is not a directory: ${targetCwd}`);
      }
      cwd = targetCwd;
    }

    if (args.add) {
      args.add = args.add.flatMap(p => {
        const resolved = path.resolve(cwd, p);
        if (!fs.existsSync(resolved) && p.includes(' ')) {
          console.warn(`⚠️ AUTONOMOUS HEALING: Path '${p}' not found and contains spaces. Splitting by space to recover hallucinated --add list.`);
          return p.split(' ').filter(Boolean).map(sp => path.resolve(cwd, sp));
        }
        return resolved;
      });
    }

    const firstLine = args.msg.trim().split('\n')[0];
    const commitMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
    const type = commitMatch ? commitMatch[1] : 'chore';
    ensureStagedFiles(cwd, args.add);
    
    let historyContent = args.history ? args.history.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') : '';
    if (args['history-file']) {
      const candidateCwdPath = path.resolve(cwd, args['history-file']);
      const resolvedPath = fs.existsSync(candidateCwdPath)
        ? candidateCwdPath
        : path.resolve(args['history-file']);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`⚠️ AUTONOMOUS HEALING: History file '${args['history-file']}' not found. Defaulting to --no-history.`);
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

    const body = generateHistoryEntry(args, type, historyContent, cwd);
    const sha = executeCommit(args.msg, body, cwd, args.add);
    await createJournalEntry(
      sha,
      args.msg,
      args,
      historyContent,
      cwd,
      (filepath) => { tempFilesToCleanup.add(filepath); },
      cleanupTempFile,
      getErrorMessage
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
  const normalized = entryArg.replace(/\\/g, '/');
  return (
    normalized.endsWith('/dist/vendor/commit/commit.js') ||
    normalized.endsWith('/src/vendor/commit/commit.ts') ||
    normalized.endsWith('/.agents/scripts/commit.ts')
  );
}

if (shouldAutoRunMain()) {
  void main();
}
