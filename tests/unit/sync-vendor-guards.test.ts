import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireSyncVendorLock,
  assertSafeSyncWorktree,
  isAllowedVendorSyncPath,
  parseGitPorcelainZ,
  SYNC_LOCK_REL_PATH,
  writeBufferAtomicIfChanged,
} from '../../scripts/sync-vendor-guards.js';

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function initTempGitRepo(rootDir: string): void {
  runGit(rootDir, ['init']);
  runGit(rootDir, ['config', 'user.email', 'test@example.com']);
  runGit(rootDir, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(rootDir, 'README.md'), '# temp\n', 'utf8');
  mkdirSync(path.join(rootDir, 'src', 'vendor', 'lib-agent-exec'), { recursive: true });
  writeFileSync(path.join(rootDir, 'src', 'vendor', 'VENDOR.json'), '{}\n', 'utf8');
  writeFileSync(path.join(rootDir, 'src', 'vendor', 'lib-agent-exec', 'utils.ts'), 'export {}\n', 'utf8');
  runGit(rootDir, ['add', '.']);
  runGit(rootDir, ['commit', '-m', 'chore: init']);
}

describe('sync-vendor-guards', () => {
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('parseGitPorcelainZ', () => {
    it('parses modified, untracked, spaced, non-ASCII, and rename/copy entries', () => {
      const raw = [
        ' M src/handlers/prompts/adversarial-code-quality.ts',
        '?? tests/unit/new file with spaces.test.ts',
        '?? docs/café-notes.md',
        'R  src/vendor/commit/new-name.ts',
        'src/vendor/commit/old-name.ts',
        'C  src/copy-dest.ts',
        'src/copy-src.ts',
        '',
      ].join('\0');

      expect(parseGitPorcelainZ(raw)).toEqual([
        'src/handlers/prompts/adversarial-code-quality.ts',
        'tests/unit/new file with spaces.test.ts',
        'docs/café-notes.md',
        'src/vendor/commit/new-name.ts',
        'src/vendor/commit/old-name.ts',
        'src/copy-dest.ts',
        'src/copy-src.ts',
      ]);
    });
  });

  describe('isAllowedVendorSyncPath', () => {
    it('permits VENDOR.json and selected library paths while rejecting sibling prefixes and foreign files', () => {
      expect(isAllowedVendorSyncPath('src/vendor/VENDOR.json', ['lib-agent-exec'])).toBe(true);
      expect(isAllowedVendorSyncPath('src/vendor/lib-agent-exec/interceptors/utils.ts', ['lib-agent-exec'])).toBe(true);
      expect(isAllowedVendorSyncPath('src\\vendor\\lib-agent-exec\\utils.ts', ['lib-agent-exec'])).toBe(true);
      expect(isAllowedVendorSyncPath('src/vendor/lib-agent-exec-extra/x.ts', ['lib-agent-exec'])).toBe(false);
      expect(isAllowedVendorSyncPath('src/vendor/commit/commit.ts', ['lib-agent-exec'])).toBe(false);
      expect(isAllowedVendorSyncPath('src/handlers/prompts/adversarial-code-quality.ts', ['lib-agent-exec'])).toBe(false);
      expect(isAllowedVendorSyncPath('scripts/sync-vendor.ts', ['lib-agent-exec'])).toBe(false);
    });
  });

  describe('acquireSyncVendorLock', () => {
    it('acquires, exposes lock metadata, and idempotently releases the lock file', () => {
      const dir = makeTempDir('sync-lock-');
      const lockPath = path.join(dir, SYNC_LOCK_REL_PATH);
      const release = acquireSyncVendorLock(dir, ['lib-agent-exec']);
      expect(existsSync(lockPath)).toBe(true);
      release();
      expect(existsSync(lockPath)).toBe(false);
      release();
      expect(existsSync(lockPath)).toBe(false);
    });

    it('rejects when another live PID holds the lock', () => {
      const dir = makeTempDir('sync-lock-live-');
      const lockPath = path.join(dir, SYNC_LOCK_REL_PATH);
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 999999, libs: ['commit'], createdAt: '2026-11-21T00:00:00.000Z' }),
        'utf8'
      );

      expect(() => acquireSyncVendorLock(dir, ['lib-agent-exec'], { isPidAlive: () => true })).toThrow(
        /PID 999999/
      );
      expect(existsSync(lockPath)).toBe(true);
    });

    it('reclaims a stale lock whose holder PID is dead', () => {
      const dir = makeTempDir('sync-lock-dead-');
      const lockPath = path.join(dir, SYNC_LOCK_REL_PATH);
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 424242, libs: ['commit'], createdAt: '2026-11-21T00:00:00.000Z' }),
        'utf8'
      );

      const release = acquireSyncVendorLock(dir, ['lib-agent-exec'], { isPidAlive: () => false });
      try {
        const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; libs: string[] };
        expect(current.pid).toBe(process.pid);
        expect(current.libs).toEqual(['lib-agent-exec']);
      } finally {
        release();
      }
      expect(existsSync(lockPath)).toBe(false);
    });

    it('fails closed on malformed lock JSON without deleting it', () => {
      const dir = makeTempDir('sync-lock-bad-');
      const lockPath = path.join(dir, SYNC_LOCK_REL_PATH);
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, '{not-json', 'utf8');

      expect(() => acquireSyncVendorLock(dir, ['lib-agent-exec'])).toThrow(/Malformed sync lock/);
      expect(readFileSync(lockPath, 'utf8')).toBe('{not-json');
    });

    it('fails closed when the lock path is a symlink', () => {
      const dir = makeTempDir('sync-lock-symlink-');
      const lockPath = path.join(dir, SYNC_LOCK_REL_PATH);
      const targetPath = path.join(dir, 'target.txt');
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(targetPath, 'keep', 'utf8');
      try {
        symlinkSync(targetPath, lockPath);
      } catch {
        return;
      }

      expect(() => acquireSyncVendorLock(dir, ['lib-agent-exec'])).toThrow(/non-regular sync lock/);
      expect(readFileSync(targetPath, 'utf8')).toBe('keep');
    });

    it('does not unlink a lock file taken over by another PID before release', () => {
      const dir = makeTempDir('sync-lock-owner-');
      const lockPath = path.join(dir, SYNC_LOCK_REL_PATH);
      const release = acquireSyncVendorLock(dir, ['lib-agent-exec']);
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid + 1, libs: ['commit'], createdAt: '2026-11-21T00:00:00.000Z' }),
        'utf8'
      );
      release();
      expect(existsSync(lockPath)).toBe(true);
    });
  });

  describe('writeBufferAtomicIfChanged', () => {
    it('creates new files cleanly, skips unchanged writes preserving mtimeMs, and updates modified files', () => {
      const dir = makeTempDir('sync-atomic-');
      const target = path.join(dir, 'nested', 'file.ts');
      const initial = Buffer.from('export const v = 1;\n', 'utf8');

      expect(writeBufferAtomicIfChanged(target, initial)).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('export const v = 1;\n');
      expect(readdirSync(path.dirname(target)).filter((n) => n.includes('.sync-tmp-'))).toEqual([]);

      const past = new Date(Date.now() - 60_000);
      utimesSync(target, past, past);
      const beforeMtime = lstatSync(target).mtimeMs;

      expect(writeBufferAtomicIfChanged(target, Buffer.from('export const v = 1;\n', 'utf8'))).toBe(false);
      expect(lstatSync(target).mtimeMs).toBe(beforeMtime);

      expect(writeBufferAtomicIfChanged(target, Buffer.from('export const v = 2;\n', 'utf8'))).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('export const v = 2;\n');
    });
  });

  describe('assertSafeSyncWorktree', () => {
    it('passes in non-git temp directories', () => {
      const dir = makeTempDir('sync-nongit-');
      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], false)).not.toThrow();
    });

    it('allows clean repos and in-scope vendor edits while blocking foreign dirty files', () => {
      const dir = makeTempDir('sync-git-');
      initTempGitRepo(dir);

      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], false)).not.toThrow();

      writeFileSync(path.join(dir, 'src', 'vendor', 'VENDOR.json'), '{"changed":true}\n', 'utf8');
      writeFileSync(path.join(dir, 'src', 'vendor', 'lib-agent-exec', 'utils.ts'), 'export const x = 1;\n', 'utf8');
      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], false)).not.toThrow();

      mkdirSync(path.join(dir, 'src', 'handlers', 'prompts'), { recursive: true });
      writeFileSync(path.join(dir, 'src', 'handlers', 'prompts', 'adversarial-code-quality.ts'), '// dirty\n', 'utf8');
      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], false)).toThrow(/foreign uncommitted changes/);
      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], true)).not.toThrow();

      // Sibling vendor lib outside selected scope must still be rejected when allowDirty is false
      rmSync(path.join(dir, 'src', 'handlers'), { recursive: true, force: true });
      mkdirSync(path.join(dir, 'src', 'vendor', 'commit'), { recursive: true });
      writeFileSync(path.join(dir, 'src', 'vendor', 'commit', 'commit.ts'), '// dirty\n', 'utf8');
      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], false)).toThrow(/src\/vendor\/commit\/commit\.ts/);
    });

    it('always blocks when .git/index.lock exists even if allowDirty is true', () => {
      const dir = makeTempDir('sync-git-lock-');
      initTempGitRepo(dir);
      writeFileSync(path.join(dir, '.git', 'index.lock'), '', 'utf8');

      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], false)).toThrow(/Active git operation detected/);
      expect(() => assertSafeSyncWorktree(dir, ['lib-agent-exec'], true)).toThrow(/Active git operation detected/);
    });
  });
});
