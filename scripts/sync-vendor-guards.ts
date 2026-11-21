import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/** [INVARIANT] Stored under gitignored `.test-output/` so an aborted sync never dirties `src/vendor/`. */
export const SYNC_LOCK_REL_PATH = join('.test-output', 'sync-vendor.lock');

const MAX_FOREIGN_PREVIEW = 10;
const GIT_STATUS_MAX_BUFFER = 10 * 1024 * 1024;
let tempWriteCounter = 0;

export const SyncLockRecordSchema = z.object({
  pid: z.number().int().positive().refine((n) => Number.isSafeInteger(n), 'Invalid lock PID'),
  libs: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
});

export type SyncLockRecord = z.infer<typeof SyncLockRecordSchema>;

function getErrCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

function foldOsPathCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return getErrCode(err) !== 'ESRCH';
  }
}

/**
 * Parse NUL-delimited `git status --porcelain=v1 -z --untracked-files=all` output
 * into normalized forward-slash repo-relative paths, preserving both rename/copy paths.
 */
export function parseGitPorcelainZ(raw: string): string[] {
  const paths: string[] = [];
  const tokens = raw.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token.length < 4) continue;
    const status = token.slice(0, 2);
    const primary = token.slice(3).replace(/\\/g, '/');
    if (primary !== '') paths.push(primary);
    if (status.includes('R') || status.includes('C')) {
      const sourceToken = tokens[++i];
      if (sourceToken !== undefined) {
        const sourcePath = sourceToken.replace(/\\/g, '/');
        if (sourcePath !== '') paths.push(sourcePath);
      }
    }
  }
  return paths;
}

/**
 * [BOUNDARY] Allow dirty-worktree writes only on `src/vendor/VENDOR.json` or inside
 * `src/vendor/<lib>/` for the libraries currently selected for sync.
 */
export function isAllowedVendorSyncPath(repoRelPath: string, libsToSync: readonly string[]): boolean {
  const folded = foldOsPathCase(repoRelPath.replace(/\\/g, '/').replace(/^\.\//, ''));
  if (folded === foldOsPathCase('src/vendor/VENDOR.json')) return true;
  return libsToSync.some((lib) => folded.startsWith(foldOsPathCase(`src/vendor/${lib.replace(/\\/g, '/')}/`)));
}

function tryWriteLockExclusive(lockPath: string, recordJson: string): boolean {
  try {
    writeFileSync(lockPath, recordJson, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (err: unknown) {
    if (getErrCode(err) === 'EEXIST') return false;
    throw err;
  }
}

function unlinkIgnoreEnoent(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (err: unknown) {
    if (getErrCode(err) !== 'ENOENT') throw err;
  }
}

function parseLockRecord(raw: string): SyncLockRecord | null {
  try {
    const parsed = SyncLockRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function inspectAndClearStaleLock(lockPath: string, isPidAlive: (pid: number) => boolean): void {
  const st = lstatSync(lockPath, { throwIfNoEntry: false });
  if (st === undefined) return;
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`Refusing non-regular sync lock at ${lockPath}`);
  const existingRaw = readFileSync(lockPath, 'utf8');
  const record = parseLockRecord(existingRaw);
  if (record === null) {
    throw new Error(`Malformed sync lock at ${lockPath}; inspect or remove manually before retrying.`);
  }
  if (isPidAlive(record.pid)) {
    throw new Error(
      `Another sync-vendor process (PID ${String(record.pid)}, libs: [${record.libs.join(', ')}], created: ${record.createdAt}) holds ${lockPath}.`
    );
  }
  if (readFileSync(lockPath, 'utf8') !== existingRaw) {
    throw new Error(`Concurrent lock modification detected at ${lockPath}; retry after active sync finishes.`);
  }
  unlinkIgnoreEnoent(lockPath);
}

/**
 * Acquire an exclusive PID-guarded lock under `.test-output/sync-vendor.lock`.
 * Fails closed on live foreign PIDs, symlinks, malformed lock JSON, or contention.
 */
export function acquireSyncVendorLock(
  cwd: string,
  libsToSync: readonly string[],
  options?: { isPidAlive?: (pid: number) => boolean }
): () => void {
  const lockPath = resolve(cwd, SYNC_LOCK_REL_PATH);
  const isPidAlive = options?.isPidAlive ?? defaultIsPidAlive;
  mkdirSync(dirname(lockPath), { recursive: true });
  const recordJson =
    JSON.stringify({ pid: process.pid, libs: [...libsToSync], createdAt: new Date().toISOString() }, null, 2) + '\n';

  if (!tryWriteLockExclusive(lockPath, recordJson)) {
    inspectAndClearStaleLock(lockPath, isPidAlive);
    if (!tryWriteLockExclusive(lockPath, recordJson)) {
      throw new Error(`Concurrent lock contention at ${lockPath}; retry after active sync finishes.`);
    }
  }

  let released = false;
  return (): void => {
    if (released) return;
    released = true;
    const st = lstatSync(lockPath, { throwIfNoEntry: false });
    if (st === undefined || st.isSymbolicLink() || !st.isFile()) return;
    let raw: string;
    try {
      raw = readFileSync(lockPath, 'utf8');
    } catch (err: unknown) {
      if (getErrCode(err) === 'ENOENT') return;
      throw err;
    }
    const record = parseLockRecord(raw);
    if (record !== null && record.pid === process.pid) unlinkIgnoreEnoent(lockPath);
  };
}

/**
 * Refuse vendor writes while `.git/index.lock` is active or when uncommitted changes
 * touch files outside `src/vendor/VENDOR.json` and `src/vendor/<libsToSync>/`.
 */
export function assertSafeSyncWorktree(cwd: string, libsToSync: readonly string[], allowDirty: boolean): void {
  let gitDirRaw: string;
  try {
    gitDirRaw = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    }).trim();
  } catch {
    return;
  }
  if (gitDirRaw === '') return;

  const indexLockPath = join(resolve(cwd, gitDirRaw), 'index.lock');
  if (lstatSync(indexLockPath, { throwIfNoEntry: false }) !== undefined) {
    throw new Error(`Active git operation detected (${indexLockPath}); defer vendor sync until commit finishes.`);
  }
  if (allowDirty) return;

  const rawStatus = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd, encoding: 'utf8', maxBuffer: GIT_STATUS_MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  const foreignSet = new Set(parseGitPorcelainZ(rawStatus).filter((p) => !isAllowedVendorSyncPath(p, libsToSync)));
  if (foreignSet.size === 0) return;

  const sorted = [...foreignSet].sort();
  const extra = sorted.length > MAX_FOREIGN_PREVIEW ? ` (+ ${String(sorted.length - MAX_FOREIGN_PREVIEW)} more)` : '';
  throw new Error(
    `Refusing vendor sync for [${libsToSync.join(', ')}]: foreign uncommitted changes detected (${sorted.slice(0, MAX_FOREIGN_PREVIEW).join(', ')}${extra}). Another audit or editing session may be active; defer sync or pass --allow-dirty.`
  );
}

/**
 * Atomically replace `destFile` via sibling temp file + rename only when missing or byte-different,
 * preserving `mtimeMs` and preventing 0-byte truncation windows on unchanged files.
 */
export function writeBufferAtomicIfChanged(destFile: string, nextContent: Buffer): boolean {
  const existingStat = lstatSync(destFile, { throwIfNoEntry: false });
  if (existingStat !== undefined) {
    if (existingStat.isSymbolicLink()) throw new Error(`Refusing symbolic link at vendor destination: ${destFile}`);
    if (!existingStat.isFile()) throw new Error(`Refusing non-regular file at vendor destination: ${destFile}`);
    if (readFileSync(destFile).equals(nextContent)) return false;
  } else {
    mkdirSync(dirname(destFile), { recursive: true });
  }

  const tmpPath = `${destFile}.sync-tmp-${String(process.pid)}-${String(++tempWriteCounter)}`;
  try {
    writeFileSync(tmpPath, nextContent, { flag: 'wx' });
    renameSync(tmpPath, destFile);
  } catch (err: unknown) {
    unlinkIgnoreEnoent(tmpPath);
    throw err;
  }
  return true;
}
