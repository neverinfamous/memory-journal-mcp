// @ts-nocheck
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CliArgs } from './cli.js';
import { GIT_TIMEOUT_MS, GIT_CMD_MAX_BUFFER, GIT_STREAM_BUFFER_DEFAULT, GIT_IDLE_TIMEOUT_MS, GIT_ABSOLUTE_TIMEOUT_MS, MAX_STDERR_LENGTH, SIGPIPE_EXIT_CODE } from './constants.js';

interface ErrnoException extends Error {
  code?: string;
}
function isErrnoException(err: unknown): err is ErrnoException {
  return err instanceof Error && 'code' in err;
}

export const activeProcesses = new Set<ReturnType<typeof spawn>>();
export function cleanupProcesses() {
  for (const proc of activeProcesses) {
    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
}

export const UNIQUE_ID = randomUUID();
export const RECORD_SEPARATOR = `\x1E<GIT_RECORD_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const FIELD_SEPARATOR = `\x1E<GIT_FIELD_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const NUMSTAT_BOUNDARY_STR = `\x1E<GIT_NUMSTAT_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const PATCH_BOUNDARY_STR = `\x1E<GIT_PATCH_BOUNDARY_${UNIQUE_ID}>\x1E`;

function attachStderrCollector(proc: ReturnType<typeof spawn>) {
  const errChunks: string[] = [];
  let errLength = 0;
  let hasTruncatedErr = false;
  proc.stderr?.on('data', (d) => {
    const s = Buffer.isBuffer(d) ? d.toString('utf-8') : String(d);
    if (errLength < MAX_STDERR_LENGTH) { errChunks.push(s); errLength += s.length; }
    else if (!hasTruncatedErr) { errChunks.push('\n...[stderr truncated]'); hasTruncatedErr = true; }
  });
  // [INTENT]: In Bun on Windows, ChildProcess `'close'` can fire before `proc.stderr` flushes its final events.
  const hasStderrOnce = proc.stderr !== null && proc.stderr !== undefined && typeof proc.stderr.once === 'function';
  let stderrEnded = !hasStderrOnce;
  const stderrSettled = hasStderrOnce
    ? new Promise<void>((resolveStderr) => {
        const finish = () => { if (!stderrEnded) { stderrEnded = true; resolveStderr(); } };
        proc.stderr?.once('end', finish);
        proc.stderr?.once('close', finish);
        proc.stderr?.once('error', finish);
      })
    : Promise.resolve();
  return { getErrText: () => errChunks.join(''), isStderrEnded: () => stderrEnded, stderrSettled };
}

function createProcessCompletionPromise(
  proc: ReturnType<typeof spawn>,
  ac: AbortController,
  stderr: ReturnType<typeof attachStderrCollector>,
  onError: (err: Error) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    const rejectWith = (err: Error) => { onError(err); reject(err); };
    const finalizeFailure = (code: number | null, signal: NodeJS.Signals | null) => {
      const errText = stderr.getErrText();
      if (errText.includes("ambiguous argument 'HEAD': unknown revision") || errText.includes("bad default revision 'HEAD'")) resolve();
      else rejectWith(new Error(`Git failed with code ${code} and signal ${signal}: ${errText}`));
    };
    proc.on('close', (code, signal) => {
      if (resolved) return;
      resolved = true;
      if (ac.signal.aborted) { rejectWith(new Error(`Git process timed out and was aborted: ${stderr.getErrText()}`)); return; }
      if (signal === 'SIGKILL' || signal === 'SIGTERM') { rejectWith(new Error(`Git process was killed with signal ${signal}`)); return; }
      if ((code !== 0 && code !== null && code !== SIGPIPE_EXIT_CODE) || (signal && signal !== 'SIGPIPE')) {
        if (stderr.isStderrEnded()) { finalizeFailure(code, signal); return; }
        let drainTimer: ReturnType<typeof setTimeout> | undefined;
        const drainCap = new Promise<void>((r) => { drainTimer = setTimeout(r, 2000); drainTimer.unref(); });
        void Promise.race([stderr.stderrSettled, drainCap]).finally(() => { if (drainTimer !== undefined) clearTimeout(drainTimer); }).then(() => finalizeFailure(code, signal));
      } else { resolve(); }
    });
    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      if (ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        rejectWith(new Error(`Git process timed out after ${Math.round(GIT_IDLE_TIMEOUT_MS / 1000)}s of inactivity and was aborted: ${stderr.getErrText()}`));
      } else if (isErrnoException(err) && err.code === 'ENOENT') {
        rejectWith(new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err }));
      } else { rejectWith(err); }
    });
  });
}

export function setupGitProcessLifecycle(proc: ReturnType<typeof spawn>, ac: AbortController, functionName: string) {
  let idleTimeout = setTimeout(() => ac.abort(), GIT_IDLE_TIMEOUT_MS);
  idleTimeout.unref();
  const absoluteTimeout = setTimeout(() => {
    console.warn(`Warning: ${functionName} exceeded absolute timeout. Aborting.`);
    ac.abort();
  }, GIT_ABSOLUTE_TIMEOUT_MS);
  absoluteTimeout.unref();

  const clearTimeouts = () => {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
  };

  const resetTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => ac.abort(), GIT_IDLE_TIMEOUT_MS);
    idleTimeout.unref();
  };

  const stderr = attachStderrCollector(proc);
  let streamError: Error | null = null;
  const processComplete = createProcessCompletionPromise(proc, ac, stderr, (err) => {
    streamError = err;
  });
  processComplete.catch(() => {});

  const cleanup = () => {
    clearTimeouts();
    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    activeProcesses.delete(proc);
  };

  return { resetTimeout, processComplete, getStreamError: () => streamError, clearTimeouts, cleanup };
}

export function getHeadSha(cwd: string = process.cwd()): string {
  const execOpts = { cwd, encoding: 'utf-8' as const, stdio: 'pipe' as const, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_CMD_MAX_BUFFER, windowsHide: true };
  try {
    return execFileSync('git', ['--no-pager', 'rev-parse', 'HEAD'], execOpts).trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

const DESCRIBE_LONG_REGEX = /^(.*)-(\d+)-g([0-9a-f]{40})$/i;
const FULL_SHA_REGEX = /^[0-9a-f]{40}$/i;

function parseDescribeLong(output: string): { tagName: string; distance: number; sha: string } | null {
  const m = output.match(DESCRIBE_LONG_REGEX);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { tagName: m[1], distance: parseInt(m[2], 10), sha: m[3] };
}

export function getGitTagRange(cwd: string = process.cwd()): { range: string; isFallback: boolean; headSha: string } {
  let headSha = 'HEAD';
  const execOpts = { cwd, encoding: 'utf-8' as const, stdio: 'pipe' as const, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_CMD_MAX_BUFFER, windowsHide: true };
  try {
    // [INTENT]: Single `describe --tags --long --abbrev=40 --always` yields HEAD SHA, nearest tag, and distance in 1 spawn.
    const raw = execFileSync('git', ['--no-pager', 'describe', '--tags', '--long', '--abbrev=40', '--always'], execOpts).trim();
    const parsed = parseDescribeLong(raw);
    if (!parsed) {
      if (FULL_SHA_REGEX.test(raw)) headSha = raw;
      return { range: 'HEAD', isFallback: true, headSha };
    }
    headSha = parsed.sha;
    let tagName = parsed.tagName;
    if (!tagName || tagName.startsWith('-')) {
      return { range: 'HEAD', isFallback: true, headSha };
    }
    if (parsed.distance === 0) {
      try {
        const prevRaw = execFileSync('git', ['--no-pager', 'describe', '--tags', '--long', '--abbrev=40', '--end-of-options', `${tagName}^`], execOpts).trim();
        const prev = parseDescribeLong(prevRaw);
        if (!prev || !prev.tagName || prev.tagName.startsWith('-')) {
          return { range: 'HEAD', isFallback: true, headSha };
        }
        tagName = prev.tagName;
      } catch {
        return { range: 'HEAD', isFallback: true, headSha };
      }
    }
    return { range: `${tagName}..HEAD`, isFallback: false, headSha };
  } catch {
    // Ignore and fallback
  }
  return { range: 'HEAD', isFallback: true, headSha };
}

export function buildGitBaseArgs(args: CliArgs, targetRange: string | undefined): string[] {
  if (targetRange && targetRange.startsWith('-')) {
    throw new Error(`Invalid target range: ${targetRange}. Range must not start with '-'.`);
  }
  const gitArgs: string[] = [];
  gitArgs.push('-M');
  if (args['include-merges'] || args['first-parent']) gitArgs.push('-c');
  else gitArgs.push('--no-merges');

  if (args.author) gitArgs.push(`--author=${args.author}`);
  if (args.search) {
    gitArgs.push(`--grep=${args.search}`);
    gitArgs.push('--fixed-strings');
  }
  if (args.grep) gitArgs.push(`--grep=${args.grep}`);
  if (args.author || args.search || args.grep || args['patch-search'] || args.pickaxe) {
    if (!gitArgs.includes('-i')) gitArgs.push('-i');
  }
  if (args.grep || args['patch-search'] || args.pickaxe) {
    if (!gitArgs.includes('-E')) gitArgs.push('-E');
  }
  if (args.since) gitArgs.push(`--since=${args.since}`);
  if (args.until) gitArgs.push(`--until=${args.until}`);
  if (args['first-parent']) gitArgs.push('--first-parent');
  if (args['patch-search']) {
    gitArgs.push(`-G${args['patch-search']}`);
    if (!gitArgs.includes('--pickaxe-all')) gitArgs.push('--pickaxe-all');
  }
  if (args.pickaxe) {
    gitArgs.push(`-S${args.pickaxe}`);
    if (!gitArgs.includes('--pickaxe-all')) gitArgs.push('--pickaxe-all');
  }
  if (args['diff-filter']) {
    let df = args['diff-filter'];
    if (!df.includes('*')) df += '*';
    gitArgs.push(`--diff-filter=${df}`);
  }
  if (args.reverse) gitArgs.push('--reverse');
  if (args['diff-context'] !== undefined) gitArgs.push(`-U${args['diff-context']}`);

  const hasTsFilters = args.category || args.type || args.breaking || args['changelog-only'] || args.impact || args.confidence;
  const hasNativeFilters = args.author || args.search || args.grep || args['patch-search'] || args.pickaxe || args.path || args.since || args.until || args['diff-filter'];

  if (args.all) {
    gitArgs.push('--all');
  } else if (!targetRange || targetRange === 'HEAD') {
    const format = args.format?.replace(/^["']|["']$/g, '');
    if (args.limit === undefined && !hasTsFilters && !hasNativeFilters && !args.reverse && (!format || format === 'json')) gitArgs.push('-n', '100');
    else if ((hasTsFilters || (args.limit === undefined && format && format !== 'json')) && !args.reverse) gitArgs.push('-n', '50000');
    gitArgs.push('HEAD');
  } else {
    gitArgs.push(targetRange);
  }

  if (args.limit !== undefined && !hasTsFilters && !args.reverse) {
    if (!gitArgs.includes('-n')) gitArgs.push('-n', String(args.limit));
  }

  if (args.path) gitArgs.push('--full-diff', '--', args.path);
  return gitArgs;
}

interface TextStreamState {
  buffer: string;
  searchOffset: number;
  droppingMassiveCommit: boolean;
}

function drainTextBuffer(state: TextStreamState, chunkLen: number, maxBufferLimit: number): string[] {
  const records: string[] = [];
  if (state.droppingMassiveCommit) {
    const nextBoundary = state.buffer.indexOf(RECORD_SEPARATOR);
    if (nextBoundary === -1) {
      state.buffer = state.buffer.length > RECORD_SEPARATOR.length ? (' ' + state.buffer.slice(-(RECORD_SEPARATOR.length - 1))).slice(1) : state.buffer;
      state.searchOffset = 0;
      return records;
    }
    state.droppingMassiveCommit = false;
    state.buffer = (' ' + state.buffer.slice(nextBoundary + RECORD_SEPARATOR.length)).slice(1);
    state.searchOffset = 0;
  }

  let lastSlice = 0;
  let sepIdx: number;
  while ((sepIdx = state.buffer.indexOf(RECORD_SEPARATOR, state.searchOffset)) !== -1) {
    const record = state.buffer.slice(lastSlice, sepIdx);
    if (record.trim()) {
      if (record.length >= maxBufferLimit) {
        console.warn(`Warning: Git record exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit.`);
      } else {
        records.push(record);
      }
    }
    lastSlice = sepIdx + RECORD_SEPARATOR.length;
    state.searchOffset = lastSlice;
  }

  if (lastSlice > 0) {
    state.buffer = (' ' + state.buffer.slice(lastSlice)).slice(1);
    state.searchOffset = Math.max(0, state.searchOffset - lastSlice);
  } else {
    state.searchOffset = Math.max(0, state.buffer.length - chunkLen - RECORD_SEPARATOR.length);
  }

  if (state.buffer.length > maxBufferLimit) {
    console.warn(`Warning: Git record buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit to prevent memory exhaustion.`);
    state.buffer = state.buffer.length > RECORD_SEPARATOR.length ? (' ' + state.buffer.slice(-(RECORD_SEPARATOR.length - 1))).slice(1) : state.buffer;
    state.searchOffset = 0;
    state.droppingMassiveCommit = true;
  }
  return records;
}

function spawnGitWithEnoentGuard(args: string[], cwd: string, signal: AbortSignal): ReturnType<typeof spawn> {
  try {
    const proc = spawn('git', args, { cwd, signal, windowsHide: true });
    activeProcesses.add(proc);
    return proc;
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
    }
    throw err;
  }
}

export async function* streamGitRecords(args: string[], cwd: string = process.cwd(), maxBufferLimit: number = GIT_STREAM_BUFFER_DEFAULT): AsyncGenerator<string> {
  const ac = new AbortController();
  const proc = spawnGitWithEnoentGuard(['--no-pager', ...args], cwd, ac.signal);
  const stdout = proc.stdout;
  if (!stdout || !proc.stderr) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Missing stdio');
  }

  stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  const { resetTimeout, processComplete, getStreamError, cleanup } = setupGitProcessLifecycle(proc, ac, 'streamGitRecords');
  const state: TextStreamState = { buffer: '', searchOffset: 0, droppingMassiveCommit: false };

  try {
    try {
      for await (const chunk of stdout) {
        const streamError = getStreamError();
        if (streamError) throw streamError;
        resetTimeout();
        const textChunk = typeof chunk === 'string' ? chunk : String(chunk);
        state.buffer += textChunk;
        for (const rec of drainTextBuffer(state, textChunk.length, maxBufferLimit)) {
          yield rec;
        }
      }
    } catch (err: unknown) {
      const streamError = getStreamError();
      if (streamError) throw streamError;
      if (err instanceof Error && err.message === 'Premature close') {
        await processComplete;
      } else {
        throw err;
      }
    }
    await processComplete;
    if (!state.droppingMassiveCommit && state.buffer.trim() && state.buffer.length < maxBufferLimit) yield state.buffer;
  } finally {
    cleanup();
  }
}

function hasCrossChunkBoundary(chunks: Buffer[], buf: Buffer, boundary: Buffer): boolean {
  const needed = boundary.length - 1;
  let gathered = 0;
  const tailChunks: Buffer[] = [];
  for (let i = chunks.length - 2; i >= 0 && gathered < needed; i--) {
    const c = chunks[i];
    if (!c) continue;
    const take = Math.min(c.length, needed - gathered);
    tailChunks.unshift(c.subarray(c.length - take));
    gathered += take;
  }
  const headSlice = buf.subarray(0, Math.min(buf.length, needed));
  tailChunks.push(headSlice);
  return Buffer.concat(tailChunks, gathered + headSlice.length).indexOf(boundary) !== -1;
}

function drainBinaryChunks(
  chunks: Buffer[],
  chunksLength: number,
  boundary: Buffer,
  maxBufferLimit: number,
): { emitted: Buffer[]; nextChunks: Buffer[]; nextLength: number } {
  const emitted: Buffer[] = [];
  let pendingBuffer = Buffer.concat(chunks, chunksLength);
  let nextIdx = pendingBuffer.indexOf(boundary);
  while (nextIdx !== -1) {
    if (nextIdx > 0) emitted.push(pendingBuffer.subarray(0, nextIdx));
    pendingBuffer = pendingBuffer.subarray(nextIdx + boundary.length);
    nextIdx = pendingBuffer.indexOf(boundary);
  }
  if (pendingBuffer.length > maxBufferLimit) {
    console.warn(`Warning: Git binary buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping buffer to prevent memory exhaustion.`);
    return { emitted, nextChunks: [], nextLength: 0 };
  }
  return { emitted, nextChunks: pendingBuffer.length > 0 ? [pendingBuffer] : [], nextLength: pendingBuffer.length };
}

export async function* spawnGitBinaryStream(
  args: string[],
  boundaryStr: string,
  stdinShas?: string,
  maxBufferLimit: number = GIT_STREAM_BUFFER_DEFAULT,
  cwd: string = process.cwd()
): AsyncGenerator<Buffer, void, unknown> {
  const ac = new AbortController();
  const proc = spawnGitWithEnoentGuard(args, cwd, ac.signal);

  if (!proc.stdout || !proc.stderr || !proc.stdin) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Missing stdio');
  }

  if (stdinShas) {
    proc.stdin.on('error', (err: unknown) => {
      if (err instanceof Error && (!('code' in err) || (err.code !== 'EPIPE' && err.code !== 'EOF'))) {
        console.error('stdin error:', err.message);
      }
    });
    try {
      proc.stdin.write(stdinShas);
      proc.stdin.end();
    } catch { /* ignore synchronous EPIPE */ }
  }

  const { resetTimeout, processComplete, cleanup } = setupGitProcessLifecycle(proc, ac, 'spawnGitBinaryStream');

  try {
    let chunks: Buffer[] = [];
    let chunksLength = 0;
    const boundary = Buffer.from(boundaryStr);

    for await (const chunk of proc.stdout) {
      resetTimeout();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      chunksLength += buf.length;

      const hasBoundary = buf.indexOf(boundary) !== -1 || (chunksLength > buf.length && hasCrossChunkBoundary(chunks, buf, boundary));
      if (hasBoundary || chunksLength >= maxBufferLimit) {
        const drained = drainBinaryChunks(chunks, chunksLength, boundary, maxBufferLimit);
        for (const rec of drained.emitted) yield rec;
        chunks = drained.nextChunks;
        chunksLength = drained.nextLength;
      }
    }
    await processComplete;
    if (chunksLength > 0) yield Buffer.concat(chunks, chunksLength);
  } finally {
    cleanup();
  }
}
