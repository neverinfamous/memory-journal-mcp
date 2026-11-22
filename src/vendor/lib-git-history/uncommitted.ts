// @ts-nocheck
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { z } from 'zod';
import type { entrySchema, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import { DEFAULT_MAX_PATCH_LEN, GIT_CMD_MAX_BUFFER, GIT_TIMEOUT_MS } from './constants.js';
import { flattenString, getLanguage, truncateSafely } from './parser-utils.js';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_STAT_BYTES = 5 * 1024 * 1024;
const BINARY_PEEK_BYTES = 8192;
const STREAM_READ_CHUNK_BYTES = 65536;

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function formatGitStatusFailure(err: unknown, status?: number | null, stderr?: string): Error {
  if (isErrnoException(err) && err.code === 'ENOENT') {
    return new Error(
      JSON.stringify({
        error: 'GitExecutableNotFound',
        message: 'The git binary is missing from the environment PATH.',
      }),
      { cause: err },
    );
  }
  if (err instanceof Error) {
    const stderrProp = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr.trim() : '';
    const detail = stderrProp || err.message;
    return new Error(`Git status failed: ${detail}`, { cause: err });
  }
  const detail = stderr?.trim() || (err !== undefined && err !== null ? String(err) : 'unknown error');
  return new Error(`Git status failed with code ${status ?? 'unknown'}: ${detail}`);
}

function isUnbornHeadError(text: string): boolean {
  return /unknown revision|ambiguous argument 'HEAD'|bad revision 'HEAD'|needed a single revision/i.test(text);
}

function extractSettledRejectionText(reason: unknown): string {
  if (reason instanceof Error) {
    const stderrProp = 'stderr' in reason && typeof reason.stderr === 'string' ? reason.stderr : '';
    return `${stderrProp}\n${reason.message}`;
  }
  return String(reason);
}

function countNewlinesInSlice(buf: Buffer, len: number): number {
  let newlines = 0;
  let pos = 0;
  while (pos < len) {
    const next = buf.indexOf(0x0a, pos);
    if (next === -1 || next >= len) break;
    newlines++;
    pos = next + 1;
  }
  return newlines;
}

function countUntrackedLines(cwd: string, relFile: string): number {
  try {
    const resolvedCwd = path.resolve(cwd);
    const fullPath = path.resolve(resolvedCwd, relFile);
    const rel = path.relative(resolvedCwd, fullPath);
    if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return 0;
    const stat = fs.lstatSync(fullPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_UNTRACKED_STAT_BYTES) {
      return 0;
    }
    const peekLen = Math.min(stat.size, BINARY_PEEK_BYTES);
    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const fd = fs.openSync(fullPath, openFlags);
    try {
      const peekBuf = Buffer.allocUnsafe(peekLen);
      const bytesRead = fs.readSync(fd, peekBuf, 0, peekLen, 0);
      if (bytesRead <= 0) return 0;
      const peekSlice = peekBuf.subarray(0, bytesRead);
      if (peekSlice.includes(0)) {
        return 0;
      }
      let totalNewlines = countNewlinesInSlice(peekSlice, bytesRead);
      let lastByte = peekSlice[bytesRead - 1] ?? 0;
      if (stat.size <= BINARY_PEEK_BYTES) {
        return lastByte === 0x0a ? totalNewlines : totalNewlines + 1;
      }
      const chunkBuf = Buffer.allocUnsafe(Math.min(STREAM_READ_CHUNK_BYTES, stat.size - bytesRead));
      let offset = bytesRead;
      while (offset < stat.size) {
        const readNow = fs.readSync(fd, chunkBuf, 0, Math.min(chunkBuf.length, stat.size - offset), offset);
        if (readNow <= 0) break;
        totalNewlines += countNewlinesInSlice(chunkBuf, readNow);
        lastByte = chunkBuf[readNow - 1] ?? lastByte;
        offset += readNow;
      }
      return lastByte === 0x0a ? totalNewlines : totalNewlines + 1;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 0;
  }
}

function parseGitUserConfig(stdout: string): { author: string; email: string } {
  let author = 'Unknown';
  let email = 'unknown@example.com';
  if (!stdout) return { author, email };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('user.name ')) {
      const val = line.slice('user.name '.length).trim();
      if (val) author = val;
    } else if (line.startsWith('user.email ')) {
      const val = line.slice('user.email '.length).trim();
      if (val) email = val;
    }
  }
  return { author, email };
}

type UncommittedNumstat = { insertions: number; deletions: number; isBinary?: boolean };

function parseUncommittedNumstat(numstat: string): Map<string, UncommittedNumstat> {
  const numstatsMap = new Map<string, UncommittedNumstat>();
  if (!numstat) return numstatsMap;
  const parts = numstat.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const tab1 = part.indexOf('\t');
    if (tab1 === -1) continue;
    const tab2 = part.indexOf('\t', tab1 + 1);
    if (tab2 === -1) continue;
    const ins = part.slice(0, tab1);
    const del = part.slice(tab1 + 1, tab2);
    let file = part.slice(tab2 + 1);
    if (file === '') {
      i += 2;
      file = parts[i] ?? '';
    }
    if (!file) continue;
    const isBinary = ins === '-' || del === '-';
    numstatsMap.set(file, {
      insertions: ins === '-' ? 0 : parseInt(ins, 10) || 0,
      deletions: del === '-' ? 0 : parseInt(del, 10) || 0,
      ...(isBinary ? { isBinary: true } : {}),
    });
  }
  return numstatsMap;
}

function parseUncommittedFiles(
  cwd: string,
  nameStatus: string,
  numstatsMap: Map<string, UncommittedNumstat>,
): { files: FileStatus[]; totalInsertions: number; totalDeletions: number } {
  const files: FileStatus[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;
  if (!nameStatus) return { files, totalInsertions, totalDeletions };

  const parts = nameStatus.split('\0');
  for (let i = 0; i < parts.length - 1; i++) {
    const statusLine = parts[i];
    if (!statusLine) continue;

    const xy = statusLine.slice(0, 2);
    const file = statusLine.slice(3);
    let oldFile: string | undefined;

    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      i++;
      oldFile = parts[i];
    }

    let mappedStatus = xy;
    if (xy === '??') mappedStatus = 'U';
    else if (xy[0] !== ' ' && xy[0] !== '?') mappedStatus = xy[0] ?? xy;
    else if (xy[1] !== ' ') mappedStatus = xy[1] ?? xy;

    const stats = numstatsMap.get(file) ?? {
      insertions: mappedStatus === 'U' ? countUntrackedLines(cwd, file) : 0,
      deletions: 0,
    };

    const flatFile = flattenString(file);
    const flatStatus = flattenString(mappedStatus);
    const flatOldFile = oldFile ? flattenString(oldFile) : undefined;
    const lang = getLanguage(flatFile);

    files.push({
      status: flatStatus,
      file: flatFile,
      ...(flatOldFile ? { oldFile: flatOldFile } : {}),
      ...(lang ? { language: lang } : {}),
      insertions: stats.insertions,
      deletions: stats.deletions,
      ...(stats.isBinary ? { isBinary: true } : {}),
    });
    totalInsertions += stats.insertions;
    totalDeletions += stats.deletions;
  }

  return { files, totalInsertions, totalDeletions };
}

function applyUncommittedPatchBounds(
  rawPatch: string | undefined,
  args: CliArgs,
): { patch?: string; isPatchTruncated?: boolean } {
  if (!rawPatch) return {};
  const parsedMax = args['max-patch-length'];
  const maxPatchLen =
    parsedMax !== undefined && !Number.isNaN(parsedMax) && parsedMax >= 0
      ? parsedMax
      : DEFAULT_MAX_PATCH_LEN;
  if (rawPatch.length > maxPatchLen) {
    return {
      patch: truncateSafely(rawPatch, maxPatchLen, '\n...[patch truncated due to length]'),
      isPatchTruncated: true,
    };
  }
  return { patch: rawPatch };
}

function buildUncommittedEntry(
  cwd: string,
  nameStatus: string,
  numstat: string,
  patch: string | undefined,
  userConfigRaw: string,
  args: CliArgs,
): z.infer<typeof entrySchema> {
  const numstatsMap = parseUncommittedNumstat(numstat);
  const { files, totalInsertions, totalDeletions } = parseUncommittedFiles(cwd, nameStatus, numstatsMap);
  const { author, email } = parseGitUserConfig(userConfigRaw);
  const { patch: boundedPatch, isPatchTruncated } = applyUncommittedPatchBounds(patch, args);

  return {
    commit: 'UNCOMMITTED',
    author: flattenString(author),
    email: flattenString(email),
    date: new Date().toISOString(),
    subject: 'Uncommitted Changes',
    cleanSubject: 'Uncommitted Changes',
    files: files.length > 0 ? files : undefined,
    fileCount: files.length,
    totalInsertions,
    totalDeletions,
    ...(boundedPatch !== undefined ? { patch: boundedPatch } : {}),
    ...(isPatchTruncated ? { isPatchTruncated: true } : {}),
  };
}

function runSyncDiffWithUnbornFallback(
  headArgs: string[],
  cachedArgs: string[],
  execOpts: { cwd: string; encoding: 'utf-8'; maxBuffer: number; timeout: number; windowsHide: true },
): string | undefined {
  const res = spawnSync('git', headArgs, execOpts);
  if (!res.error && res.status === 0) return res.stdout;
  const errText = typeof res.stderr === 'string' ? res.stderr : '';
  if (isUnbornHeadError(errText)) {
    const fallback = spawnSync('git', cachedArgs, execOpts);
    if (!fallback.error && fallback.status === 0) return fallback.stdout;
  } else {
    console.warn(`[lib-git-history] Warning: git ${headArgs[1] ?? 'diff'} failed: ${errText || res.error?.message || `exit ${res.status}`}`);
  }
  return undefined;
}

export function getUncommittedState(args: CliArgs, cwd: string = process.cwd()): z.infer<typeof entrySchema> {
  const execOpts = { cwd, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true as const };
  const pathFilter = args.path ? ['--', args.path] : [];

  const statusRes = spawnSync('git', ['--no-pager', 'status', '-z', '--porcelain', '-uall', ...pathFilter], execOpts);
  if (statusRes.error || statusRes.status !== 0) {
    throw formatGitStatusFailure(statusRes.error, statusRes.status, typeof statusRes.stderr === 'string' ? statusRes.stderr : '');
  }
  const nameStatus = statusRes.stdout;

  const numstat = runSyncDiffWithUnbornFallback(
    ['--no-pager', 'diff', '--numstat', '-z', 'HEAD', ...pathFilter],
    ['--no-pager', 'diff', '--cached', '--numstat', '-z', ...pathFilter],
    execOpts,
  ) ?? '';

  const wantPatch = Boolean(args['include-patch'] || args['diff-context'] !== undefined);
  const diffContextArg = args['diff-context'] !== undefined ? [`-U${args['diff-context']}`] : [];
  const patch = wantPatch
    ? runSyncDiffWithUnbornFallback(
        ['--no-pager', 'diff', ...diffContextArg, 'HEAD', ...pathFilter],
        ['--no-pager', 'diff', '--cached', ...diffContextArg, ...pathFilter],
        execOpts,
      )
    : undefined;

  let userConfigRaw = '';
  try {
    const res = spawnSync('git', ['config', '--get-regexp', '^user\\.(name|email)$'], execOpts);
    if (!res.error && res.status === 0) userConfigRaw = res.stdout;
  } catch { /* ignore missing git user config */ }

  return buildUncommittedEntry(cwd, nameStatus, numstat, patch, userConfigRaw, args);
}

/**
 * [INTENT]: Concurrent async variant of `getUncommittedState` used by the CLI to eliminate
 * sequential Windows `git.exe` spawn waterfalls via `Promise.allSettled`.
 */
export async function getUncommittedStateAsync(args: CliArgs, cwd: string = process.cwd()): Promise<z.infer<typeof entrySchema>> {
  const execOpts = { cwd, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true };
  const pathFilter = args.path ? ['--', args.path] : [];
  const wantPatch = Boolean(args['include-patch'] || args['diff-context'] !== undefined);
  const diffContextArg = args['diff-context'] !== undefined ? [`-U${args['diff-context']}`] : [];

  const runGit = (gitArgs: string[]): Promise<string> =>
    execFileAsync('git', gitArgs, execOpts).then(r => r.stdout);

  const [statusRes, numstatRes, patchRes, configRes] = await Promise.allSettled([
    runGit(['--no-pager', 'status', '-z', '--porcelain', '-uall', ...pathFilter]),
    runGit(['--no-pager', 'diff', '--numstat', '-z', 'HEAD', ...pathFilter]),
    wantPatch
      ? runGit(['--no-pager', 'diff', ...diffContextArg, 'HEAD', ...pathFilter])
      : Promise.resolve<string | undefined>(undefined),
    runGit(['config', '--get-regexp', '^user\\.(name|email)$']),
  ]);

  if (statusRes.status === 'rejected') {
    throw formatGitStatusFailure(statusRes.reason);
  }

  const needsNumstatFallback = numstatRes.status === 'rejected' && isUnbornHeadError(extractSettledRejectionText(numstatRes.reason));
  const needsPatchFallback = wantPatch && patchRes.status === 'rejected' && isUnbornHeadError(extractSettledRejectionText(patchRes.reason));
  let numstat = numstatRes.status === 'fulfilled' ? numstatRes.value : '';
  let patch = patchRes.status === 'fulfilled' ? patchRes.value : undefined;

  if (needsNumstatFallback || needsPatchFallback) {
    const [cachedNumstat, cachedPatch] = await Promise.allSettled([
      needsNumstatFallback ? runGit(['--no-pager', 'diff', '--cached', '--numstat', '-z', ...pathFilter]) : Promise.resolve(numstat),
      needsPatchFallback ? runGit(['--no-pager', 'diff', '--cached', ...diffContextArg, ...pathFilter]) : Promise.resolve(patch),
    ]);
    if (needsNumstatFallback && cachedNumstat.status === 'fulfilled') numstat = cachedNumstat.value;
    if (needsPatchFallback && cachedPatch.status === 'fulfilled') patch = cachedPatch.value;
  } else {
    if (numstatRes.status === 'rejected') {
      console.warn(`[lib-git-history] Warning: git diff --numstat failed: ${extractSettledRejectionText(numstatRes.reason).trim()}`);
    }
    if (wantPatch && patchRes.status === 'rejected') {
      console.warn(`[lib-git-history] Warning: git diff patch failed: ${extractSettledRejectionText(patchRes.reason).trim()}`);
    }
  }

  const userConfigRaw = configRes.status === 'fulfilled' ? configRes.value : '';
  return buildUncommittedEntry(cwd, statusRes.value, numstat, patch, userConfigRaw, args);
}
