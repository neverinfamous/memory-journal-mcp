// @ts-nocheck
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CliArgs } from './cli.js';
import { GIT_TIMEOUT_MS, GIT_CMD_MAX_BUFFER, GIT_STREAM_BUFFER_DEFAULT, GIT_IDLE_TIMEOUT_MS, GIT_ABSOLUTE_TIMEOUT_MS, MAX_STDERR_LENGTH, SIGPIPE_EXIT_CODE } from './constants.js';
import {
  drainTextChunks,
  hasCrossChunkTextBoundary,
  retainTextBoundaryTailFromChunks,
  hasCrossChunkBoundary,
  drainBinaryChunks,
  retainBoundaryTailFromChunks,
  type TextStreamState,
  type BinaryStreamState,
} from './git-stream-buffers.js';

interface ErrnoException extends Error {
  code?: string;
}
function isErrnoException(err: unknown): err is ErrnoException {
  return err instanceof Error && 'code' in err;
}

export const activeProcesses = new Set<ReturnType<typeof spawn>>();
export function cleanupProcesses() {
  for (const proc of activeProcesses) {
    if (proc.exitCode === null && proc.signalCode === null && !proc.killed) {
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
  const stderrStream = proc.stderr;
  const hasStderrOnce = stderrStream !== null && stderrStream !== undefined && typeof stderrStream.once === 'function';
  let stderrEnded = !hasStderrOnce;
  const stderrSettled = hasStderrOnce
    ? new Promise<void>((resolveStderr) => {
        const finish = () => {
          if (!stderrEnded) {
            stderrEnded = true;
            stderrStream.removeListener?.('end', finish);
            stderrStream.removeListener?.('close', finish);
            stderrStream.removeListener?.('error', finish);
            resolveStderr();
          }
        };
        stderrStream.once('end', finish);
        stderrStream.once('close', finish);
        stderrStream.once('error', finish);
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

  let lastResetMs = Date.now();
  const resetTimeout = () => {
    const now = Date.now();
    if (now - lastResetMs < 1000) return;
    lastResetMs = now;
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
    if (proc.exitCode === null && proc.signalCode === null && !proc.killed) {
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
  if (targetRange && targetRange.trim().startsWith('-')) {
    throw new Error(`Invalid target range: ${targetRange}. Range must not start with '-'.`);
  }
  const gitArgs: string[] = [];
  // [INVARIANT]: Never emit `-c` when `--no-body` omits `--raw`/`--numstat`/`--name-status`, because standalone `-c` implies `-p` (full unified diffs on every commit).
  const hasDiffArgs = Boolean(args['diff-filter'] || args['patch-search'] || args.pickaxe);
  if (!args['no-body'] || hasDiffArgs) gitArgs.push('-M');
  if (args['include-merges'] || args['first-parent']) {
    if (!args['no-body']) gitArgs.push('-c');
  } else {
    gitArgs.push('--no-merges');
  }

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

  const hasTsFilters = args.category || args.type || args.breaking || args['changelog-only'] || args.impact || args.confidence;
  const hasNativeFilters = args.author || args.search || args.grep || args['patch-search'] || args.pickaxe || args.path || args.since || args.until || args['diff-filter'];

  if (args.all) {
    gitArgs.push('--all');
  } else if (!targetRange || targetRange === 'HEAD') {
    const format = args.format?.replace(/^["']|["']$/g, '');
    const isJsonFormat = !format || format === 'json' || format === 'json-array';
    if (args.limit === undefined && !hasTsFilters && !hasNativeFilters && !args.reverse && isJsonFormat) gitArgs.push('-n', '100');
    else if ((hasTsFilters || (args.limit === undefined && !isJsonFormat)) && !args.reverse) gitArgs.push('-n', '50000');
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

function spawnGitWithEnoentGuard(args: string[], cwd: string, signal: AbortSignal, hasStdin = false): ReturnType<typeof spawn> {
  try {
    const proc = spawn('git', args, {
      cwd,
      signal,
      stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    activeProcesses.add(proc);
    return proc;
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
    }
    throw err;
  }
}

function writeStdinShas(stdin: NonNullable<ReturnType<typeof spawn>['stdin']>, stdinShas: string): void {
  stdin.on('error', (err: unknown) => {
    if (err instanceof Error && (!('code' in err) || (err.code !== 'EPIPE' && err.code !== 'EOF'))) {
      console.error('stdin error:', err.message);
    }
  });
  try {
    stdin.write(stdinShas);
    stdin.end();
  } catch (err: unknown) {
    if (!isErrnoException(err) || (err.code !== 'EPIPE' && err.code !== 'EOF')) {
      console.error('stdin error:', err instanceof Error ? err.message : String(err));
    }
  }
}

export async function* streamGitRecords(
  args: string[],
  cwd: string = process.cwd(),
  maxBufferLimit: number = GIT_STREAM_BUFFER_DEFAULT,
  stdinShas?: string,
  separator: string = RECORD_SEPARATOR,
): AsyncGenerator<string> {
  const ac = new AbortController();
  const hasStdin = stdinShas !== undefined;
  const proc = spawnGitWithEnoentGuard(['--no-pager', ...args], cwd, ac.signal, hasStdin);
  const stdout = proc.stdout;
  if (!stdout || !proc.stderr || (hasStdin && !proc.stdin)) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Missing stdio');
  }

  if (stdinShas !== undefined && proc.stdin) writeStdinShas(proc.stdin, stdinShas);
  stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  const { resetTimeout, processComplete, getStreamError, cleanup } = setupGitProcessLifecycle(proc, ac, 'streamGitRecords');
  const state: TextStreamState = { chunks: [], chunksLength: 0, droppingMassiveCommit: false };

  try {
    try {
      for await (const chunk of stdout) {
        const streamError = getStreamError();
        if (streamError) throw streamError;
        resetTimeout();
        const textChunk = typeof chunk === 'string' ? chunk : String(chunk);
        state.chunks.push(textChunk);
        state.chunksLength += textChunk.length;

        const hasBoundary =
          textChunk.indexOf(separator) !== -1 ||
          (state.chunksLength > textChunk.length && hasCrossChunkTextBoundary(state.chunks, textChunk, separator));
        if (hasBoundary) {
          yield* drainTextChunks(state, maxBufferLimit, separator);
        } else if (state.droppingMassiveCommit) {
          retainTextBoundaryTailFromChunks(state, separator.length);
        } else if (state.chunksLength >= maxBufferLimit) {
          console.warn(`Warning: Git record buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit to prevent memory exhaustion.`);
          state.droppingMassiveCommit = true;
          retainTextBoundaryTailFromChunks(state, separator.length);
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
    if (!state.droppingMassiveCommit && state.chunksLength > 0 && state.chunksLength < maxBufferLimit) {
      const remaining = state.chunks.length === 1 && state.chunks[0] !== undefined ? state.chunks[0] : state.chunks.join('');
      if (remaining.trim()) yield remaining;
    }
  } finally {
    cleanup();
  }
}

export async function* spawnGitBinaryStream(
  args: string[],
  boundaryStr: string,
  stdinShas?: string,
  maxBufferLimit: number = GIT_STREAM_BUFFER_DEFAULT,
  cwd: string = process.cwd()
): AsyncGenerator<Buffer, void, unknown> {
  const ac = new AbortController();
  const hasStdin = Boolean(stdinShas);
  const proc = spawnGitWithEnoentGuard(args, cwd, ac.signal, hasStdin);

  if (!proc.stdout || !proc.stderr || (hasStdin && !proc.stdin)) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Missing stdio');
  }

  if (stdinShas && proc.stdin) writeStdinShas(proc.stdin, stdinShas);

  const { resetTimeout, processComplete, getStreamError, cleanup } = setupGitProcessLifecycle(proc, ac, 'spawnGitBinaryStream');
  const state: BinaryStreamState = { chunks: [], chunksLength: 0, droppingMassiveRecord: false };
  const boundary = Buffer.from(boundaryStr);

  try {
    try {
      for await (const chunk of proc.stdout) {
        const streamError = getStreamError();
        if (streamError) throw streamError;
        resetTimeout();
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        state.chunks.push(buf);
        state.chunksLength += buf.length;

        const hasBoundary = buf.indexOf(boundary) !== -1 || (state.chunksLength > buf.length && hasCrossChunkBoundary(state.chunks, buf, boundary));
        if (hasBoundary) {
          yield* drainBinaryChunks(state, boundary, maxBufferLimit);
        } else if (state.droppingMassiveRecord) {
          retainBoundaryTailFromChunks(state, boundary.length);
        } else if (state.chunksLength >= maxBufferLimit) {
          console.warn(`Warning: Git binary buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping buffer to prevent memory exhaustion.`);
          state.droppingMassiveRecord = true;
          retainBoundaryTailFromChunks(state, boundary.length);
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
    if (!state.droppingMassiveRecord && state.chunksLength > 0) {
      yield state.chunks.length === 1 && state.chunks[0] !== undefined
        ? state.chunks[0]
        : Buffer.concat(state.chunks, state.chunksLength);
    }
  } finally {
    cleanup();
  }
}
