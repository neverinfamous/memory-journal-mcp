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

  const errChunks: string[] = [];
  let errLength = 0;
  let hasTruncatedErr = false;
  proc.stderr?.on('data', d => {
    const s = Buffer.isBuffer(d) ? d.toString('utf-8') : String(d);
    if (errLength < MAX_STDERR_LENGTH) {
      errChunks.push(s);
      errLength += s.length;
    } else if (!hasTruncatedErr) {
      errChunks.push('\n...[stderr truncated]');
      hasTruncatedErr = true;
    }
  });

  let streamError: Error | null = null;
  const processComplete = new Promise<void>((resolve, reject) => {
    let resolved = false;
    proc.on('close', (code, signal) => {
      if (!resolved) {
        resolved = true;
        if (ac.signal.aborted) {
          streamError = new Error(`Git process timed out and was aborted: ${errChunks.join('')}`);
          reject(streamError);
        } else if (signal === 'SIGKILL' || signal === 'SIGTERM') {
          streamError = new Error(`Git process was killed with signal ${signal}`);
          reject(streamError);
        } else if ((code !== 0 && code !== null && code !== SIGPIPE_EXIT_CODE) || (signal && signal !== 'SIGPIPE')) {
          const errText = errChunks.join('');
          if (errText.includes("ambiguous argument 'HEAD': unknown revision") || errText.includes("bad default revision 'HEAD'")) {
            resolve();
          } else {
            streamError = new Error(`Git failed with code ${code} and signal ${signal}: ${errText}`);
            reject(streamError);
          }
        } else {
          resolve();
        }
      }
    });
    proc.on('error', err => {
      if (!resolved) {
        resolved = true;
        if (isErrnoException(err) && err.code === 'ENOENT') {
          streamError = new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
        } else {
          streamError = err;
        }
        reject(streamError);
      }
    });
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

export function getGitTagRange(cwd: string = process.cwd()): { range: string; isFallback: boolean; headSha: string } {
  let headSha = 'HEAD';
  const execOpts = { cwd, encoding: 'utf-8' as const, stdio: 'pipe' as const, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_CMD_MAX_BUFFER, windowsHide: true };
  try {
    headSha = execFileSync('git', ['--no-pager', 'rev-parse', 'HEAD'], execOpts).trim();
    let tagName = execFileSync('git', ['--no-pager', 'describe', '--tags', '--abbrev=0'], execOpts).trim();
    
    if (tagName) {
      let tagSha = execFileSync('git', ['--no-pager', 'rev-parse', `${tagName}^{commit}`], execOpts).trim();
      
      if (tagSha === headSha) {
        try {
          tagName = execFileSync('git', ['--no-pager', 'describe', '--tags', '--abbrev=0', `${tagName}^`], execOpts).trim();
          tagSha = execFileSync('git', ['--no-pager', 'rev-parse', `${tagName}^{commit}`], execOpts).trim();
        } catch {
          return { range: 'HEAD', isFallback: true, headSha };
        }
      }
      
      if (tagName && tagSha !== headSha) {
        return { range: `${tagName}..HEAD`, isFallback: false, headSha };
      }
    }
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
  if (args.author || args.search || args.grep || args['patch-search']) {
    if (!gitArgs.includes('-i')) gitArgs.push('-i');
  }
  if (args.grep || args['patch-search']) {
    if (!gitArgs.includes('-E')) gitArgs.push('-E');
  }
  if (args.since) gitArgs.push(`--since=${args.since}`);
  if (args.until) gitArgs.push(`--until=${args.until}`);
  if (args['first-parent']) gitArgs.push('--first-parent');
  if (args['patch-search']) {
    gitArgs.push(`-G${args['patch-search']}`);
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
  const hasNativeFilters = args.author || args.search || args.grep || args['patch-search'] || args.path || args.since || args.until || args['diff-filter'];

  if (args.all) {
    gitArgs.push('--all');
  } else if (!targetRange || targetRange === 'HEAD') {
    const format = args.format?.replace(/^["']|["']$/g, '');
    if (!args.limit && !hasTsFilters && !hasNativeFilters && !args.reverse && (!format || format === 'json')) gitArgs.push('-n', '100');
    else if ((hasTsFilters || (!args.limit && format && format !== 'json')) && !args.reverse) gitArgs.push('-n', '50000');
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

export async function* streamGitRecords(args: string[], cwd: string = process.cwd(), maxBufferLimit: number = GIT_STREAM_BUFFER_DEFAULT): AsyncGenerator<string> {
  const ac = new AbortController();
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn('git', ['--no-pager', ...args], { cwd, signal: ac.signal, windowsHide: true });
    activeProcesses.add(proc);
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
    }
    throw err;
  }
  
  if (!proc.stdout || !proc.stderr) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Missing stdio');
  }

  proc.stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');

  const { resetTimeout, processComplete, getStreamError, cleanup } = setupGitProcessLifecycle(proc, ac, 'streamGitRecords');

  let buffer = '';
  let searchOffset = 0;
  let droppingMassiveCommit = false;
  try {
    try {
      for await (const chunk of proc.stdout!) {
        const streamError = getStreamError();
        if (streamError) throw streamError;
        resetTimeout();
        buffer += chunk;
        let sepIdx;
        let lastSlice = 0;

        if (droppingMassiveCommit) {
          const nextBoundary = buffer.indexOf(RECORD_SEPARATOR);
          if (nextBoundary !== -1) {
            droppingMassiveCommit = false;
            buffer = (' ' + buffer.slice(nextBoundary + RECORD_SEPARATOR.length)).slice(1);
            searchOffset = 0;
          } else {
            buffer = buffer.length > RECORD_SEPARATOR.length ? (' ' + buffer.slice(-(RECORD_SEPARATOR.length - 1))).slice(1) : buffer;
            searchOffset = 0;
            continue;
          }
        }

        while ((sepIdx = buffer.indexOf(RECORD_SEPARATOR, searchOffset)) !== -1) {
          const record = buffer.slice(lastSlice, sepIdx);
          if (record.trim()) {
            if (record.length >= maxBufferLimit) {
              console.warn(`Warning: Git record exceeded ${Math.round(maxBufferLimit/1024/1024)}MB. Dropping massive commit.`);
            } else {
              yield record;
            }
          }
          lastSlice = sepIdx + RECORD_SEPARATOR.length;
          searchOffset = lastSlice;
        }
        if (lastSlice > 0) {
          buffer = (' ' + buffer.slice(lastSlice)).slice(1);
          searchOffset = Math.max(0, searchOffset - lastSlice);
        } else {
          searchOffset = Math.max(0, buffer.length - chunk.length - RECORD_SEPARATOR.length);
        }
        if (buffer.length > maxBufferLimit) {
          console.warn(`Warning: Git record buffer exceeded ${Math.round(maxBufferLimit/1024/1024)}MB. Dropping massive commit to prevent memory exhaustion.`);
          buffer = buffer.length > RECORD_SEPARATOR.length ? (' ' + buffer.slice(-(RECORD_SEPARATOR.length - 1))).slice(1) : buffer;
          searchOffset = 0;
          droppingMassiveCommit = true;
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
    if (!droppingMassiveCommit && buffer.trim() && buffer.length < maxBufferLimit) yield buffer;
  } finally {
    cleanup();
  }
}

export async function* spawnGitBinaryStream(args: string[], boundaryStr: string, stdinShas?: string, maxBufferLimit: number = GIT_STREAM_BUFFER_DEFAULT): AsyncGenerator<Buffer, void, unknown> {
  const ac = new AbortController();
  const proc = spawn('git', args, { signal: ac.signal, windowsHide: true });
  activeProcesses.add(proc);

  if (!proc.stdout || !proc.stderr || !proc.stdin) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Missing stdio');
  }

  if (stdinShas) {
    proc.stdin.on('error', (err: unknown) => {
      if (err instanceof Error) {
        if (!('code' in err) || (err.code !== 'EPIPE' && err.code !== 'EOF')) {
          console.error('stdin error:', err.message);
        }
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
    const BOUNDARY = Buffer.from(boundaryStr);
    
    for await (const chunk of proc.stdout) {
      resetTimeout();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      chunksLength += buf.length;
      
      let checkBuf = buf;
      if (chunksLength > buf.length) {
        const needed = BOUNDARY.length - 1;
        let gathered = 0;
        const gatherChunks = [buf];
        for (let i = chunks.length - 2; i >= 0 && gathered < needed; i--) {
          const c = chunks[i];
          const take = Math.min(c.length, needed - gathered);
          gatherChunks.unshift(c.subarray(c.length - take));
          gathered += take;
        }
        checkBuf = Buffer.concat(gatherChunks);
      }
      
      if (checkBuf.indexOf(BOUNDARY) !== -1 || chunksLength >= maxBufferLimit) {
        let pendingBuffer = Buffer.concat(chunks, chunksLength);
        let nextIdx = pendingBuffer.indexOf(BOUNDARY);
        while (nextIdx !== -1) {
          if (nextIdx > 0) {
            yield pendingBuffer.subarray(0, nextIdx);
          }
          pendingBuffer = pendingBuffer.subarray(nextIdx + BOUNDARY.length);
          nextIdx = pendingBuffer.indexOf(BOUNDARY);
        }
        if (pendingBuffer.length > maxBufferLimit) {
          console.warn(`Warning: Git binary buffer exceeded ${Math.round(maxBufferLimit/1024/1024)}MB. Dropping buffer to prevent memory exhaustion.`);
          chunks = [];
          chunksLength = 0;
        } else {
          chunks = pendingBuffer.length > 0 ? [pendingBuffer] : [];
          chunksLength = pendingBuffer.length;
        }
      }
    }
    await processComplete;
    if (chunksLength > 0) {
      yield Buffer.concat(chunks, chunksLength);
    }
  } finally {
    cleanup();
  }
}
