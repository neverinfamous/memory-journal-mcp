// @ts-nocheck
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CliArgs } from './cli.js';

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

export function getGitTagRange(cwd: string = process.cwd()): { range: string; isFallback: boolean; headSha: string } {
  let headSha = 'HEAD';
  const execOpts = { cwd, encoding: 'utf-8' as const, stdio: 'pipe' as const, timeout: 10000, maxBuffer: 10 * 1024 * 1024, windowsHide: true };
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
  const gitArgs: string[] = [];
  gitArgs.push('-M');
  if (args['include-merges']) gitArgs.push('--cc');
  else gitArgs.push('--no-merges');

  if (args.limit) gitArgs.push('-n', args.limit);
  if (args.author) gitArgs.push(`--author=${args.author}`);
  if (args.search) gitArgs.push(`-S${args.search}`);
  if (args.grep) gitArgs.push(`--grep=${args.grep}`);
  if (args.author || args.search || args.grep) {
    if (!gitArgs.includes('-i')) gitArgs.push('-i');
  }
  if (args.since) gitArgs.push(`--since=${args.since}`);
  if (args.until) gitArgs.push(`--until=${args.until}`);
  if (args['first-parent']) gitArgs.push('--first-parent');
  if (args['patch-search']) gitArgs.push(`-G${args['patch-search']}`);
  if (args['diff-filter']) gitArgs.push(`--diff-filter=${args['diff-filter']}`);
  if (args.reverse) gitArgs.push('--reverse');

  const hasTsFilters = args.category || args.type || args.breaking || args['changelog-only'];

  if (args.all) {
    gitArgs.push('--all');
  } else if (!targetRange || targetRange === 'HEAD') {
    if (!args.limit && !hasTsFilters) gitArgs.push('-n', '100');
    else if (!args.limit && hasTsFilters) gitArgs.push('-n', '50000');
    gitArgs.push('HEAD');
  } else {
    gitArgs.push(targetRange);
  }

  if (args.limit && !hasTsFilters && !args.all && (!targetRange || targetRange !== 'HEAD')) {
    gitArgs.push('-n', args.limit);
  } else if (args.limit && !hasTsFilters && !args.all && targetRange && targetRange === 'HEAD') {
    if (!gitArgs.includes('-n')) gitArgs.push('-n', args.limit);
  }

  if (args.path) gitArgs.push('--', args.path);
  return gitArgs;
}

export async function* streamGitRecords(args: string[], cwd: string = process.cwd()): AsyncGenerator<string> {
  const ac = new AbortController();
  let idleTimeout = setTimeout(() => ac.abort(), 300000);
  idleTimeout.unref();
  const absoluteTimeout = setTimeout(() => {
    console.warn('Warning: streamGitRecords exceeded 15 minute absolute timeout. Aborting.');
    ac.abort();
  }, 900000);
  absoluteTimeout.unref();
  const resetTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => ac.abort(), 300000);
    idleTimeout.unref();
  };
  
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn('git', ['--no-pager', ...args], { cwd, signal: ac.signal, windowsHide: true });
    activeProcesses.add(proc);
  } catch (err) {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    if (err instanceof Error && ('code' in err) && err.code === 'ENOENT') {
      throw new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
    }
    throw err;
  }
  
  if (!proc.stdout || !proc.stderr) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    throw new Error('Missing stdio');
  }

  proc.stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  const errChunks: string[] = [];
  let errLength = 0;
  let hasTruncatedErr = false;
  proc.stderr.on('data', d => {
    if (errLength < 100000) {
      errChunks.push(d);
      errLength += d.length;
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
          const err = new Error(`Git process timed out and was aborted: ${errChunks.join('')}`);
          streamError = err;
          reject(err);
        } else if (signal === 'SIGKILL' || signal === 'SIGTERM') {
          const err = new Error(`Git process was killed with signal ${signal}`);
          streamError = err;
          reject(err);
        } else if ((code !== 0 && code !== null && code !== 141) || (signal && signal !== 'SIGPIPE')) {
          const err = new Error(`Git failed with code ${code} and signal ${signal}: ${errChunks.join('')}`);
          streamError = err;
          reject(err);
        } else {
          resolve();
        }
      }
    });
    proc.on('error', err => {
      if (!resolved) {
        resolved = true;
        if (err instanceof Error && ('code' in err) && err.code === 'ENOENT') {
          streamError = new Error(JSON.stringify({ error: 'GitExecutableNotFound', message: 'The git binary is missing from the environment PATH.' }), { cause: err });
        } else {
          streamError = err;
        }
        reject(streamError);
      }
    });
  });
  processComplete.catch(() => {});

  let buffer = '';
  let droppingMassiveCommit = false;
  try {
    try {
      for await (const chunk of proc.stdout) {
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
            lastSlice = 0;
          } else {
            buffer = buffer.length > RECORD_SEPARATOR.length ? buffer.slice(-(RECORD_SEPARATOR.length - 1)) : buffer;
            continue;
          }
        }

        while ((sepIdx = buffer.indexOf(RECORD_SEPARATOR, lastSlice)) !== -1) {
          const record = buffer.slice(lastSlice, sepIdx);
          if (record.length < 100 * 1024 * 1024 && record.trim()) {
            yield record;
          } else if (record.length >= 100 * 1024 * 1024) {
            console.warn('Warning: Git record exceeded 100MB. Dropping massive commit.');
          }
          lastSlice = sepIdx + RECORD_SEPARATOR.length;
        }
        if (lastSlice > 0) {
          buffer = (' ' + buffer.slice(lastSlice)).slice(1);
        }
        if (buffer.length > 100 * 1024 * 1024) {
          console.warn('Warning: Git record buffer exceeded 100MB. Dropping massive commit to prevent memory exhaustion.');
          buffer = buffer.length > RECORD_SEPARATOR.length ? buffer.slice(-(RECORD_SEPARATOR.length - 1)) : buffer;
          droppingMassiveCommit = true;
        }
      }
    } catch (err: unknown) {
      if (streamError) throw streamError;
      if (err instanceof Error && err.message === 'Premature close') {
        await processComplete;
      } else {
        throw err;
      }
    }
    await processComplete;
    if (!droppingMassiveCommit && buffer.trim() && buffer.length < 100 * 1024 * 1024) yield buffer;
  } finally {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch (_e) { void _e; }
    }
    activeProcesses.delete(proc);
  }
}

