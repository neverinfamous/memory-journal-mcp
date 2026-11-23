// @ts-nocheck
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { z } from 'zod';
import type { entrySchema, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import { DEFAULT_MAX_PATCH_LEN, GIT_CMD_MAX_BUFFER, GIT_TIMEOUT_MS } from './constants.js';
import { wantsPatchOutput } from './git-patch.js';
import { flattenString, getLanguage, truncateSafely } from './parser-utils.js';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_STAT_BYTES = 5 * 1024 * 1024;
const BINARY_PEEK_BYTES = 8192;
const STREAM_READ_CHUNK_BYTES = 65536;
const UNTRACKED_ASYNC_CONCURRENCY = 8;
const SYNC_SCRATCH_BUFFER = Buffer.allocUnsafe(STREAM_READ_CHUNK_BYTES);
const UNBORN_HEAD_REGEX = /unknown revision|ambiguous argument 'HEAD'|bad revision 'HEAD'|needed a single revision/i;
const NEWLINE_SPLIT_REGEX = /\r?\n/;

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
  return UNBORN_HEAD_REGEX.test(text);
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

function resolveContainedPath(resolvedCwd: string, relFile: string): string | null {
  const fullPath = path.resolve(resolvedCwd, relFile);
  const rel = path.relative(resolvedCwd, fullPath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return fullPath;
}

function countUntrackedLines(resolvedCwd: string, relFile: string): number {
  try {
    const fullPath = resolveContainedPath(resolvedCwd, relFile);
    if (fullPath === null) return 0;
    const stat = fs.lstatSync(fullPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_UNTRACKED_STAT_BYTES) return 0;

    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const fd = fs.openSync(fullPath, openFlags);
    try {
      const firstReadCap = Math.min(stat.size, STREAM_READ_CHUNK_BYTES);
      const bytesRead = fs.readSync(fd, SYNC_SCRATCH_BUFFER, 0, firstReadCap, 0);
      if (bytesRead <= 0) return 0;
      if (SYNC_SCRATCH_BUFFER.subarray(0, Math.min(bytesRead, BINARY_PEEK_BYTES)).includes(0)) return 0;

      let totalNewlines = countNewlinesInSlice(SYNC_SCRATCH_BUFFER, bytesRead);
      let lastByte = SYNC_SCRATCH_BUFFER[bytesRead - 1] ?? 0;
      let offset = bytesRead;
      while (offset < stat.size) {
        const readNow = fs.readSync(fd, SYNC_SCRATCH_BUFFER, 0, Math.min(STREAM_READ_CHUNK_BYTES, stat.size - offset), offset);
        if (readNow <= 0) break;
        totalNewlines += countNewlinesInSlice(SYNC_SCRATCH_BUFFER, readNow);
        lastByte = SYNC_SCRATCH_BUFFER[readNow - 1] ?? lastByte;
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

async function countUntrackedLinesAsync(resolvedCwd: string, relFile: string): Promise<number> {
  try {
    const fullPath = resolveContainedPath(resolvedCwd, relFile);
    if (fullPath === null) return 0;
    const stat = await fs.promises.lstat(fullPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_UNTRACKED_STAT_BYTES) return 0;

    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const handle = await fs.promises.open(fullPath, openFlags);
    try {
      const buf = Buffer.allocUnsafe(Math.min(stat.size, STREAM_READ_CHUNK_BYTES));
      const first = await handle.read(buf, 0, buf.length, 0);
      if (first.bytesRead <= 0) return 0;
      if (buf.subarray(0, Math.min(first.bytesRead, BINARY_PEEK_BYTES)).includes(0)) return 0;

      let totalNewlines = countNewlinesInSlice(buf, first.bytesRead);
      let lastByte = buf[first.bytesRead - 1] ?? 0;
      let offset = first.bytesRead;
      while (offset < stat.size) {
        const next = await handle.read(buf, 0, Math.min(buf.length, stat.size - offset), offset);
        if (next.bytesRead <= 0) break;
        totalNewlines += countNewlinesInSlice(buf, next.bytesRead);
        lastByte = buf[next.bytesRead - 1] ?? lastByte;
        offset += next.bytesRead;
      }
      return lastByte === 0x0a ? totalNewlines : totalNewlines + 1;
    } finally {
      await handle.close();
    }
  } catch {
    return 0;
  }
}

function parseGitUserConfig(stdout: string): { author: string; email: string } {
  let author = 'Unknown';
  let email = 'unknown@example.com';
  if (!stdout) return { author, email };
  for (const line of stdout.split(NEWLINE_SPLIT_REGEX)) {
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

interface ParsedStatusEntry {
  mappedStatus: string;
  file: string;
  oldFile?: string;
}

function parseStatusEntries(nameStatus: string): ParsedStatusEntry[] {
  const entries: ParsedStatusEntry[] = [];
  if (!nameStatus) return entries;
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
    entries.push(oldFile ? { mappedStatus, file, oldFile } : { mappedStatus, file });
  }
  return entries;
}

function buildFilesFromEntries(
  entries: ParsedStatusEntry[],
  numstatsMap: Map<string, UncommittedNumstat>,
  untrackedCounts: Map<string, number>,
): { files: FileStatus[]; totalInsertions: number; totalDeletions: number } {
  const files: FileStatus[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;
  for (const { mappedStatus, file, oldFile } of entries) {
    const stats = numstatsMap.get(file) ?? {
      insertions: mappedStatus === 'U' ? (untrackedCounts.get(file) ?? 0) : 0,
      deletions: 0,
    };
    const flatFile = flattenString(file);
    const lang = getLanguage(flatFile);
    const item: FileStatus = {
      status: flattenString(mappedStatus),
      file: flatFile,
      insertions: stats.insertions,
      deletions: stats.deletions,
    };
    if (oldFile) item.oldFile = flattenString(oldFile);
    if (lang) item.language = lang;
    if (stats.isBinary) item.isBinary = true;
    files.push(item);
    totalInsertions += stats.insertions;
    totalDeletions += stats.deletions;
  }
  return { files, totalInsertions, totalDeletions };
}

function parseUncommittedFiles(
  cwd: string,
  nameStatus: string,
  numstatsMap: Map<string, UncommittedNumstat>,
): { files: FileStatus[]; totalInsertions: number; totalDeletions: number } {
  const entries = parseStatusEntries(nameStatus);
  if (entries.length === 0) return { files: [], totalInsertions: 0, totalDeletions: 0 };
  const resolvedCwd = path.resolve(cwd);
  const untrackedCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.mappedStatus === 'U' && !numstatsMap.has(e.file)) {
      untrackedCounts.set(e.file, countUntrackedLines(resolvedCwd, e.file));
    }
  }
  return buildFilesFromEntries(entries, numstatsMap, untrackedCounts);
}

async function parseUncommittedFilesAsync(
  cwd: string,
  nameStatus: string,
  numstatsMap: Map<string, UncommittedNumstat>,
): Promise<{ files: FileStatus[]; totalInsertions: number; totalDeletions: number }> {
  const entries = parseStatusEntries(nameStatus);
  if (entries.length === 0) return { files: [], totalInsertions: 0, totalDeletions: 0 };
  const resolvedCwd = path.resolve(cwd);
  const untrackedFiles: string[] = [];
  for (const e of entries) {
    if (e.mappedStatus === 'U' && !numstatsMap.has(e.file)) untrackedFiles.push(e.file);
  }
  const untrackedCounts = new Map<string, number>();
  for (let i = 0; i < untrackedFiles.length; i += UNTRACKED_ASYNC_CONCURRENCY) {
    const chunk = untrackedFiles.slice(i, i + UNTRACKED_ASYNC_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((f) => countUntrackedLinesAsync(resolvedCwd, f)));
    for (let j = 0; j < chunk.length; j++) {
      const outcome = settled[j];
      untrackedCounts.set(chunk[j], outcome && outcome.status === 'fulfilled' ? outcome.value : 0);
    }
  }
  return buildFilesFromEntries(entries, numstatsMap, untrackedCounts);
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

function finalizeUncommittedEntry(
  filesResult: { files: FileStatus[]; totalInsertions: number; totalDeletions: number },
  patch: string | undefined,
  userConfigRaw: string,
  args: CliArgs,
): z.infer<typeof entrySchema> {
  const { author, email } = parseGitUserConfig(userConfigRaw);
  const { patch: boundedPatch, isPatchTruncated } = applyUncommittedPatchBounds(patch, args);
  return {
    commit: 'UNCOMMITTED',
    author: flattenString(author),
    email: flattenString(email),
    date: new Date().toISOString(),
    subject: 'Uncommitted Changes',
    cleanSubject: 'Uncommitted Changes',
    files: filesResult.files.length > 0 ? filesResult.files : undefined,
    fileCount: filesResult.files.length,
    totalInsertions: filesResult.totalInsertions,
    totalDeletions: filesResult.totalDeletions,
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
    console.warn(`[lib-git-history] Warning: git diff failed: ${errText || res.error?.message || `exit ${res.status}`}`);
  }
  return undefined;
}

export function getUncommittedState(args: CliArgs, cwd: string = process.cwd()): z.infer<typeof entrySchema> {
  const execOpts = { cwd, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true as const };
  const pathFilter = args.path ? ['--', args.path] : [];
  const untrackedFlag = args['no-body'] ? '-uno' : '-uall';

  const statusRes = spawnSync('git', ['--no-optional-locks', '--no-pager', 'status', '-z', '--porcelain', untrackedFlag, ...pathFilter], execOpts);
  if (statusRes.error || statusRes.status !== 0) {
    throw formatGitStatusFailure(statusRes.error, statusRes.status, typeof statusRes.stderr === 'string' ? statusRes.stderr : '');
  }
  const nameStatus = statusRes.stdout;
  const skipDiffs = Boolean(args['no-body']) || nameStatus === '';

  const numstat = skipDiffs
    ? ''
    : (runSyncDiffWithUnbornFallback(
        ['--no-optional-locks', '--no-pager', 'diff', '--numstat', '-z', 'HEAD', ...pathFilter],
        ['--no-optional-locks', '--no-pager', 'diff', '--cached', '--numstat', '-z', ...pathFilter],
        execOpts,
      ) ?? '');

  const wantPatch = !skipDiffs && wantsPatchOutput(args);
  const diffContextArg = args['diff-context'] !== undefined ? [`-U${args['diff-context']}`] : [];
  const patch = wantPatch
    ? runSyncDiffWithUnbornFallback(
        ['--no-optional-locks', '--no-pager', 'diff', ...diffContextArg, 'HEAD', ...pathFilter],
        ['--no-optional-locks', '--no-pager', 'diff', '--cached', ...diffContextArg, ...pathFilter],
        execOpts,
      )
    : undefined;

  let userConfigRaw = '';
  try {
    const res = spawnSync('git', ['config', '--get-regexp', '^user\\.(name|email)$'], execOpts);
    if (!res.error && res.status === 0) userConfigRaw = res.stdout;
  } catch { /* ignore missing git user config */ }

  const filesResult = args['no-body']
    ? { files: [], totalInsertions: 0, totalDeletions: 0 }
    : parseUncommittedFiles(cwd, nameStatus, parseUncommittedNumstat(numstat));
  return finalizeUncommittedEntry(filesResult, patch, userConfigRaw, args);
}

/**
 * [INTENT]: Concurrent async variant of `getUncommittedState` used by the CLI to eliminate
 * sequential Windows `git.exe` spawn waterfalls via `Promise.allSettled`.
 */
export async function getUncommittedStateAsync(args: CliArgs, cwd: string = process.cwd()): Promise<z.infer<typeof entrySchema>> {
  const execOpts = { cwd, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true };
  const pathFilter = args.path ? ['--', args.path] : [];
  const skipDiffs = Boolean(args['no-body']);
  const untrackedFlag = skipDiffs ? '-uno' : '-uall';
  const wantPatch = !skipDiffs && wantsPatchOutput(args);
  const diffContextArg = args['diff-context'] !== undefined ? [`-U${args['diff-context']}`] : [];

  const runGit = (gitArgs: string[]): Promise<string> =>
    execFileAsync('git', gitArgs, execOpts).then(r => r.stdout);

  const [statusRes, numstatRes, patchRes, configRes] = await Promise.allSettled([
    runGit(['--no-optional-locks', '--no-pager', 'status', '-z', '--porcelain', untrackedFlag, ...pathFilter]),
    skipDiffs ? Promise.resolve('') : runGit(['--no-optional-locks', '--no-pager', 'diff', '--numstat', '-z', 'HEAD', ...pathFilter]),
    wantPatch
      ? runGit(['--no-optional-locks', '--no-pager', 'diff', ...diffContextArg, 'HEAD', ...pathFilter])
      : Promise.resolve<string | undefined>(undefined),
    runGit(['config', '--get-regexp', '^user\\.(name|email)$']),
  ]);

  if (statusRes.status === 'rejected') {
    throw formatGitStatusFailure(statusRes.reason);
  }

  const needsNumstatFallback = !skipDiffs && numstatRes.status === 'rejected' && isUnbornHeadError(extractSettledRejectionText(numstatRes.reason));
  const needsPatchFallback = wantPatch && patchRes.status === 'rejected' && isUnbornHeadError(extractSettledRejectionText(patchRes.reason));
  let numstat = numstatRes.status === 'fulfilled' ? numstatRes.value : '';
  let patch = patchRes.status === 'fulfilled' ? patchRes.value : undefined;

  if (needsNumstatFallback || needsPatchFallback) {
    const [cachedNumstat, cachedPatch] = await Promise.allSettled([
      needsNumstatFallback ? runGit(['--no-optional-locks', '--no-pager', 'diff', '--cached', '--numstat', '-z', ...pathFilter]) : Promise.resolve(numstat),
      needsPatchFallback ? runGit(['--no-optional-locks', '--no-pager', 'diff', '--cached', ...diffContextArg, ...pathFilter]) : Promise.resolve(patch),
    ]);
    if (needsNumstatFallback && cachedNumstat.status === 'fulfilled') numstat = cachedNumstat.value;
    if (needsPatchFallback && cachedPatch.status === 'fulfilled') patch = cachedPatch.value;
  } else {
    if (!skipDiffs && numstatRes.status === 'rejected') {
      console.warn(`[lib-git-history] Warning: git diff --numstat failed: ${extractSettledRejectionText(numstatRes.reason).trim()}`);
    }
    if (wantPatch && patchRes.status === 'rejected') {
      console.warn(`[lib-git-history] Warning: git diff patch failed: ${extractSettledRejectionText(patchRes.reason).trim()}`);
    }
  }

  const userConfigRaw = configRes.status === 'fulfilled' ? configRes.value : '';
  const filesResult = skipDiffs
    ? { files: [], totalInsertions: 0, totalDeletions: 0 }
    : await parseUncommittedFilesAsync(cwd, statusRes.value, parseUncommittedNumstat(numstat));
  return finalizeUncommittedEntry(filesResult, patch, userConfigRaw, args);
}
