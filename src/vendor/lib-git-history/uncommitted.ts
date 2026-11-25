// @ts-nocheck
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CommitEntry, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import {
  DEFAULT_MAX_PATCH_LEN, GIT_CMD_MAX_BUFFER, GIT_TIMEOUT_MS,
  flattenString, getLanguage, truncateSafely, wantsPatchOutput,
} from './constants.js';
import { buildSafeUncommittedGitContext, buildSafeUncommittedGitContextAsync } from './security-git.js';
import {
  assertContainedExistingFile, assertValidDiffContext, registerActiveProcess,
  sanitizeLogText, scrubCredentialUrls, unregisterActiveProcess, verifySameOpenFile,
} from './security-utils.js';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_STAT_BYTES = 5 * 1024 * 1024;
const BINARY_PEEK_BYTES = 8192;
const STREAM_READ_CHUNK_BYTES = 65536;
const UNTRACKED_ASYNC_CONCURRENCY = 8;
const SYNC_SCRATCH_BUFFER = Buffer.allocUnsafe(STREAM_READ_CHUNK_BYTES);
const UNBORN_HEAD_REGEX = /unknown revision|ambiguous argument 'HEAD'|bad revision 'HEAD'|needed a single revision/i;
const NEWLINE_SPLIT_REGEX = /\r?\n/;

function formatGitStatusFailure(err: unknown, status?: number | null, stderr?: string): Error {
  if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
    return new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
  }
  if (err instanceof Error) {
    const stderrProp = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr.trim() : '';
    return new Error(`Git status failed: ${scrubCredentialUrls(stderrProp || err.message)}`, { cause: err });
  }
  const errDetail = typeof err === 'string' || typeof err === 'number' || typeof err === 'boolean'
    ? String(err)
    : (err instanceof Error ? err.message : (JSON.stringify(err) ?? 'unknown error'));
  const detail = stderr?.trim() || (err !== undefined && err !== null ? errDetail : 'unknown error');
  return new Error(`Git status failed with code ${status ?? 'unknown'}: ${scrubCredentialUrls(detail)}`);
}

function isUnbornHeadError(text: string): boolean {
  return UNBORN_HEAD_REGEX.test(text);
}

function extractSettledRejectionText(reason: unknown): string {
  if (reason instanceof Error) {
    const stderrProp = 'stderr' in reason && typeof reason.stderr === 'string' ? reason.stderr : '';
    const combined = stderrProp && stderrProp !== reason.message ? `${stderrProp} ${reason.message}` : (stderrProp || reason.message);
    return scrubCredentialUrls(combined);
  }
  return scrubCredentialUrls(String(reason));
}

function countNewlinesInSlice(buf: Buffer, len: number): number {
  if (len <= 0) return 0;
  const view = len < buf.length ? buf.subarray(0, len) : buf;
  let newlines = 0;
  let pos = 0;
  while (pos < len) {
    const next = view.indexOf(0x0a, pos);
    if (next === -1) break;
    newlines++;
    pos = next + 1;
  }
  return newlines;
}

function countUntrackedLines(realCwd: string, relFile: string): number {
  try {
    const check = assertContainedExistingFile(realCwd, relFile, MAX_UNTRACKED_STAT_BYTES, realCwd);
    if (!check.ok || check.size === 0) return 0;
    const fd = fs.openSync(check.realPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!verifySameOpenFile(check.stat, fs.fstatSync(fd))) return 0;
      const firstReadCap = Math.min(check.size, STREAM_READ_CHUNK_BYTES);
      const bytesRead = fs.readSync(fd, SYNC_SCRATCH_BUFFER, 0, firstReadCap, 0);
      if (bytesRead <= 0 || SYNC_SCRATCH_BUFFER.subarray(0, Math.min(bytesRead, BINARY_PEEK_BYTES)).includes(0)) return 0;
      let totalNewlines = countNewlinesInSlice(SYNC_SCRATCH_BUFFER, bytesRead);
      let lastByte = SYNC_SCRATCH_BUFFER[bytesRead - 1] ?? 0;
      let offset = bytesRead;
      while (offset < check.size) {
        const readNow = fs.readSync(fd, SYNC_SCRATCH_BUFFER, 0, Math.min(STREAM_READ_CHUNK_BYTES, check.size - offset), offset);
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

async function readRemainingUntrackedChunks(
  handle: fs.promises.FileHandle, buf: Buffer, fileSize: number, offset: number, totalNewlines: number, lastByte: number,
): Promise<{ totalNewlines: number; lastByte: number }> {
  if (offset >= fileSize) return { totalNewlines, lastByte };
  const next = await handle.read(buf, 0, Math.min(buf.length, fileSize - offset), offset);
  if (next.bytesRead <= 0) return { totalNewlines, lastByte };
  return readRemainingUntrackedChunks(
    handle, buf, fileSize, offset + next.bytesRead,
    totalNewlines + countNewlinesInSlice(buf, next.bytesRead), buf[next.bytesRead - 1] ?? lastByte,
  );
}

async function countUntrackedLinesAsync(realCwd: string, relFile: string, sharedBuf?: Buffer): Promise<number> {
  try {
    const check = assertContainedExistingFile(realCwd, relFile, MAX_UNTRACKED_STAT_BYTES, realCwd);
    if (!check.ok || check.size === 0) return 0;
    const handle = await fs.promises.open(check.realPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!verifySameOpenFile(check.stat, await handle.stat())) return 0;
      const buf = sharedBuf ?? Buffer.allocUnsafe(Math.min(check.size, STREAM_READ_CHUNK_BYTES));
      const first = await handle.read(buf, 0, Math.min(buf.length, check.size), 0);
      if (first.bytesRead <= 0 || buf.subarray(0, Math.min(first.bytesRead, BINARY_PEEK_BYTES)).includes(0)) return 0;
      const { totalNewlines, lastByte } = await readRemainingUntrackedChunks(
        handle, buf, check.size, first.bytesRead, countNewlinesInSlice(buf, first.bytesRead), buf[first.bytesRead - 1] ?? 0,
      );
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

type ParsedStatusEntry = { mappedStatus: string; isUntracked: boolean; file: string; oldFile?: string };

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
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') { i++; oldFile = parts[i]; }
    const isUntracked = xy === '??';
    const mappedStatus = isUntracked ? 'U' : (xy[0] !== ' ' && xy[0] !== '?') ? (xy[0] ?? xy) : (xy[1] !== ' ' ? (xy[1] ?? xy) : xy);
    entries.push(oldFile ? { mappedStatus, isUntracked, file, oldFile } : { mappedStatus, isUntracked, file });
  }
  return entries;
}

type UncommittedFilesResult = { files: FileStatus[]; fileCount: number; totalInsertions: number; totalDeletions: number };

function buildFilesFromEntries(
  entries: ParsedStatusEntry[], numstatsMap: Map<string, UncommittedNumstat>, untrackedCounts: Map<string, number>, omitFiles = false,
): UncommittedFilesResult {
  const files: FileStatus[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;
  for (const { mappedStatus, isUntracked, file, oldFile } of entries) {
    const stats = numstatsMap.get(file) ?? { insertions: isUntracked ? (untrackedCounts.get(file) ?? 0) : 0, deletions: 0 };
    totalInsertions += stats.insertions;
    totalDeletions += stats.deletions;
    if (omitFiles) continue;
    const flatFile = flattenString(file);
    const lang = getLanguage(flatFile);
    const item: FileStatus = { status: flattenString(mappedStatus), file: flatFile, insertions: stats.insertions, deletions: stats.deletions };
    if (oldFile) item.oldFile = flattenString(oldFile);
    if (lang) item.language = lang;
    if (stats.isBinary) item.isBinary = true;
    files.push(item);
  }
  return { files, fileCount: entries.length, totalInsertions, totalDeletions };
}

function parseUncommittedFiles(
  cwd: string, nameStatus: string, numstatsMap: Map<string, UncommittedNumstat>, omitFiles = false,
): UncommittedFilesResult {
  const entries = parseStatusEntries(nameStatus);
  if (entries.length === 0) return { files: [], fileCount: 0, totalInsertions: 0, totalDeletions: 0 };
  const realCwd = fs.realpathSync(path.resolve(cwd));
  const untrackedCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.isUntracked && !numstatsMap.has(e.file)) untrackedCounts.set(e.file, countUntrackedLines(realCwd, e.file));
  }
  return buildFilesFromEntries(entries, numstatsMap, untrackedCounts, omitFiles);
}

async function parseUncommittedFilesAsync(
  cwd: string, nameStatus: string, numstatsMap: Map<string, UncommittedNumstat>, omitFiles = false,
): Promise<UncommittedFilesResult> {
  const entries = parseStatusEntries(nameStatus);
  if (entries.length === 0) return { files: [], fileCount: 0, totalInsertions: 0, totalDeletions: 0 };
  const realCwd = fs.realpathSync(path.resolve(cwd));
  const untrackedFiles: string[] = [];
  for (const e of entries) {
    if (e.isUntracked && !numstatsMap.has(e.file)) untrackedFiles.push(e.file);
  }
  const untrackedCounts = new Map<string, number>();
  if (untrackedFiles.length > 0) {
    const nextIdxRef = { i: 0 };
    const drainWorker = async (): Promise<void> => {
      const buf = Buffer.allocUnsafe(STREAM_READ_CHUNK_BYTES);
      const step = async (): Promise<void> => {
        if (nextIdxRef.i >= untrackedFiles.length) return;
        const file = untrackedFiles[nextIdxRef.i++];
        if (file !== undefined) untrackedCounts.set(file, await countUntrackedLinesAsync(realCwd, file, buf));
        await step();
      };
      await step();
    };
    await Promise.allSettled(Array.from({ length: Math.min(UNTRACKED_ASYNC_CONCURRENCY, untrackedFiles.length) }, drainWorker));
  }
  return buildFilesFromEntries(entries, numstatsMap, untrackedCounts, omitFiles);
}

function resolveMaxPatchLen(args: CliArgs): number {
  const parsedMax = args['max-patch-length'];
  return parsedMax !== undefined && !Number.isNaN(parsedMax) && parsedMax >= 0 ? parsedMax : DEFAULT_MAX_PATCH_LEN;
}

interface BoundedDiffResult { patch: string; capped: boolean; }

function applyUncommittedPatchBounds(
  rawPatch: string | undefined, maxPatchLen: number, forceTruncated = false,
): { patch?: string; isPatchTruncated?: boolean } {
  if (!rawPatch) return {};
  if (rawPatch.length > maxPatchLen) {
    return { patch: flattenString(truncateSafely(rawPatch, maxPatchLen, '\n...[patch truncated due to length]')), isPatchTruncated: true };
  }
  if (forceTruncated) return { patch: `${rawPatch}\n...[patch truncated due to length]`, isPatchTruncated: true };
  return { patch: rawPatch };
}

function finalizeUncommittedEntry(
  filesResult: UncommittedFilesResult, patch: string | undefined, userConfigRaw: string, maxPatchLen: number, forceTruncated = false,
): CommitEntry {
  const { author, email } = parseGitUserConfig(userConfigRaw);
  const { patch: boundedPatch, isPatchTruncated } = applyUncommittedPatchBounds(patch, maxPatchLen, forceTruncated);
  return {
    commit: 'UNCOMMITTED', author: flattenString(author), email: flattenString(email),
    date: new Date().toISOString(), subject: 'Uncommitted Changes', cleanSubject: 'Uncommitted Changes',
    ...(filesResult.files.length > 0 ? { files: filesResult.files } : {}),
    fileCount: filesResult.fileCount, totalInsertions: filesResult.totalInsertions, totalDeletions: filesResult.totalDeletions,
    ...(boundedPatch !== undefined ? { patch: boundedPatch } : {}),
    ...(isPatchTruncated ? { isPatchTruncated: true } : {}),
  };
}

function runSyncDiffWithUnbornFallback(
  headArgs: string[], cachedArgs: string[],
  execOpts: { cwd: string; encoding: 'utf-8'; stdio: ('ignore' | 'pipe')[]; maxBuffer: number; timeout: number; windowsHide: true; env?: NodeJS.ProcessEnv },
): string | undefined {
  const res = spawnSync('git', headArgs, execOpts);
  if (!res.error && res.status === 0) return res.stdout;
  const errText = typeof res.stderr === 'string' ? res.stderr : '';
  if (isUnbornHeadError(errText)) {
    const fallback = spawnSync('git', cachedArgs, execOpts);
    if (!fallback.error && fallback.status === 0) return fallback.stdout;
    const fbErr = typeof fallback.stderr === 'string' ? fallback.stderr : '';
    console.warn(`[lib-git-history] Warning: git diff --cached failed: ${sanitizeLogText(scrubCredentialUrls(fbErr || fallback.error?.message || `exit ${fallback.status}`))}`);
  } else {
    console.warn(`[lib-git-history] Warning: git diff failed: ${sanitizeLogText(scrubCredentialUrls(errText || res.error?.message || `exit ${res.status}`))}`);
  }
  return undefined;
}

export function getUncommittedState(args: CliArgs, cwd: string = process.cwd()): CommitEntry {
  const diffContext = assertValidDiffContext(args['diff-context']);
  const { env, userConfigRaw } = buildSafeUncommittedGitContext(cwd);
  const execOpts = { cwd, env, encoding: 'utf-8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[], maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true as const };
  const pathFilter = args.path ? ['--', args.path] : [];
  const untrackedFlag = args['no-body'] ? '-uno' : '-uall';
  const statusRes = spawnSync('git', ['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=', '-c', 'color.ui=false', '-c', 'color.status=false', '-c', 'status.submoduleSummary=false', '-c', 'diff.ignoreSubmodules=all', 'status', '-z', '--porcelain', '--ignore-submodules=all', untrackedFlag, ...pathFilter], execOpts);
  if (statusRes.error || statusRes.status !== 0) {
    throw formatGitStatusFailure(statusRes.error, statusRes.status, typeof statusRes.stderr === 'string' ? statusRes.stderr : '');
  }
  const nameStatus = statusRes.stdout;
  const skipDiffs = Boolean(args['no-body']) || nameStatus === '';
  const diffPrefix = ['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=', '-c', 'diff.orderFile=/dev/null', '-c', 'diff.external=', '-c', 'diff.submodule=short', '-c', 'diff.ignoreSubmodules=all', '-c', 'color.ui=false', '-c', 'color.diff=false', 'diff', '--submodule=short', '--ignore-submodules=all', '--no-ext-diff', '--no-textconv', '--no-color'];
  const numstat = skipDiffs ? '' : (runSyncDiffWithUnbornFallback(
    [...diffPrefix, '--numstat', '-z', 'HEAD', ...pathFilter],
    [...diffPrefix, '--cached', '--numstat', '-z', ...pathFilter], execOpts) ?? '');
  const wantPatch = !skipDiffs && wantsPatchOutput(args);
  const diffCtx = diffContext !== undefined ? [`-U${diffContext}`] : [];
  const patch = wantPatch ? runSyncDiffWithUnbornFallback(
    [...diffPrefix, ...diffCtx, 'HEAD', ...pathFilter],
    [...diffPrefix, '--cached', ...diffCtx, ...pathFilter], execOpts) : undefined;
  const filesResult = args['no-body']
    ? { files: [], fileCount: 0, totalInsertions: 0, totalDeletions: 0 }
    : parseUncommittedFiles(cwd, nameStatus, parseUncommittedNumstat(numstat), Boolean(args.summary));
  return finalizeUncommittedEntry(filesResult, patch, userConfigRaw, resolveMaxPatchLen(args));
}

function runGitDiffBoundedAsync(gitArgs: string[], cwd: string, maxPatchLen: number, env?: NodeJS.ProcessEnv): Promise<BoundedDiffResult> {
  const maxBytes = Math.min(GIT_CMD_MAX_BUFFER, maxPatchLen * 3 + 256);
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitArgs, { cwd, ...(env ? { env } : {}), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    registerActiveProcess(child);
    const chunks: Buffer[] = [];
    let totalBytes = 0, errText = '', capped = false, timedOut = false, settled = false;
    let stderrEnded = child.stderr === null || child.stderr === undefined;
    let resolveStderr: (() => void) | undefined;
    const stderrSettled = new Promise<void>((r) => { if (stderrEnded) r(); else resolveStderr = r; });
    const finishStderr = (): void => { if (!stderrEnded) { stderrEnded = true; resolveStderr?.(); } };
    const killChild = (): void => { try { child.kill('SIGKILL'); } catch { /* ignore */ } };
    const timer = setTimeout(() => { timedOut = true; killChild(); }, GIT_TIMEOUT_MS);
    timer.unref();
    const finish = (err: Error | null, res?: BoundedDiffResult): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); unregisterActiveProcess(child);
      if (err) reject(err);
      else resolve(res ?? { patch: '', capped: false });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      if (capped) return;
      const rem = maxBytes - totalBytes;
      if (chunk.length >= rem) {
        chunks.push(chunk.length === rem ? chunk : chunk.subarray(0, rem));
        totalBytes += rem; capped = true; clearTimeout(timer); child.stdout?.destroy(); killChild(); return;
      }
      chunks.push(chunk); totalBytes += chunk.length;
    });
    child.stderr?.on('data', (c: Buffer) => { if (errText.length < 4096) errText += c.toString('utf-8'); });
    child.stderr?.once('end', finishStderr).once('close', finishStderr).once('error', finishStderr);
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (!capped && timedOut) { finish(new Error(`git diff timed out after ${GIT_TIMEOUT_MS}ms`)); return; }
      if (!capped && code !== 0) {
        const cleanErr = scrubCredentialUrls(errText.trim()) || `git diff exited ${code ?? 'unknown'}`;
        if (stderrEnded) { finish(Object.assign(new Error(cleanErr), { stderr: cleanErr })); return; }
        let dt: ReturnType<typeof setTimeout> | undefined;
        const cap = new Promise<void>((r) => { dt = setTimeout(r, 2000); dt.unref(); });
        void Promise.race([stderrSettled, cap]).finally(() => { if (dt !== undefined) clearTimeout(dt); })
          .then(() => finish(Object.assign(new Error(cleanErr), { stderr: cleanErr })));
        return;
      }
      const firstChunk = chunks.length === 1 ? chunks[0] : undefined;
      const patch = chunks.length === 0 ? '' : firstChunk !== undefined ? firstChunk.toString('utf-8') : Buffer.concat(chunks, totalBytes).toString('utf-8');
      finish(null, { patch, capped });
    });
  });
}

/** [INTENT]: Concurrent async `getUncommittedState` avoiding Windows `git.exe` spawn waterfalls via `Promise.allSettled`. */
export async function getUncommittedStateAsync(args: CliArgs, cwd: string = process.cwd()): Promise<CommitEntry> {
  const diffContext = assertValidDiffContext(args['diff-context']);
  const { env, userConfigRaw } = await buildSafeUncommittedGitContextAsync(cwd);
  const execOpts = { cwd, env, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true };
  const pathFilter = args.path ? ['--', args.path] : [];
  const skipDiffs = Boolean(args['no-body']);
  const untrackedFlag = skipDiffs ? '-uno' : '-uall';
  const wantPatch = !skipDiffs && wantsPatchOutput(args);
  const diffCtx = diffContext !== undefined ? [`-U${diffContext}`] : [];
  const maxPatchLen = resolveMaxPatchLen(args);
  const runGit = (gitArgs: string[]): Promise<string> => execFileAsync('git', gitArgs, execOpts).then(r => r.stdout);
  const diffPrefix = ['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=', '-c', 'diff.orderFile=/dev/null', '-c', 'diff.external=', '-c', 'diff.submodule=short', '-c', 'diff.ignoreSubmodules=all', '-c', 'color.ui=false', '-c', 'color.diff=false', 'diff', '--submodule=short', '--ignore-submodules=all', '--no-ext-diff', '--no-textconv', '--no-color'];

  const [statusRes, numstatRes, patchRes] = await Promise.allSettled([
    runGit(['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=', '-c', 'color.ui=false', '-c', 'color.status=false', '-c', 'status.submoduleSummary=false', '-c', 'diff.ignoreSubmodules=all', 'status', '-z', '--porcelain', '--ignore-submodules=all', untrackedFlag, ...pathFilter]),
    skipDiffs ? Promise.resolve('') : runGit([...diffPrefix, '--numstat', '-z', 'HEAD', ...pathFilter]),
    wantPatch ? runGitDiffBoundedAsync([...diffPrefix, ...diffCtx, 'HEAD', ...pathFilter], cwd, maxPatchLen, env) : Promise.resolve<BoundedDiffResult | undefined>(undefined),
  ]);
  if (statusRes.status === 'rejected') throw formatGitStatusFailure(statusRes.reason);

  const warnDiff = (op: string, r: unknown): void => console.warn(`[lib-git-history] Warning: ${op} failed: ${sanitizeLogText(extractSettledRejectionText(r).trim())}`);
  const needsNumstatFallback = !skipDiffs && numstatRes.status === 'rejected' && isUnbornHeadError(extractSettledRejectionText(numstatRes.reason));
  const needsPatchFallback = wantPatch && patchRes.status === 'rejected' && isUnbornHeadError(extractSettledRejectionText(patchRes.reason));
  let numstat = numstatRes.status === 'fulfilled' ? numstatRes.value : '';
  let patchResult = patchRes.status === 'fulfilled' ? patchRes.value : undefined;

  if (needsNumstatFallback || needsPatchFallback) {
    const [cachedNumstat, cachedPatch] = await Promise.allSettled([
      needsNumstatFallback ? runGit([...diffPrefix, '--cached', '--numstat', '-z', ...pathFilter]) : Promise.resolve(numstat),
      needsPatchFallback ? runGitDiffBoundedAsync([...diffPrefix, '--cached', ...diffCtx, ...pathFilter], cwd, maxPatchLen, env) : Promise.resolve(patchResult),
    ]);
    if (needsNumstatFallback) {
      if (cachedNumstat.status === 'fulfilled') numstat = cachedNumstat.value;
      else warnDiff('git diff --cached --numstat', cachedNumstat.reason);
    }
    if (needsPatchFallback) {
      if (cachedPatch.status === 'fulfilled') patchResult = cachedPatch.value;
      else warnDiff('git diff --cached patch', cachedPatch.reason);
    }
  }
  if (!skipDiffs && !needsNumstatFallback && numstatRes.status === 'rejected') warnDiff('git diff --numstat', numstatRes.reason);
  if (wantPatch && !needsPatchFallback && patchRes.status === 'rejected') warnDiff('git diff patch', patchRes.reason);

  const filesResult = skipDiffs
    ? { files: [], fileCount: 0, totalInsertions: 0, totalDeletions: 0 }
    : await parseUncommittedFilesAsync(cwd, statusRes.value, parseUncommittedNumstat(numstat), Boolean(args.summary));
  return finalizeUncommittedEntry(filesResult, patchResult?.patch, userConfigRaw, maxPatchLen, Boolean(patchResult?.capped));
}
