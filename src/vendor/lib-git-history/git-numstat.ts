// @ts-nocheck
import { spawn } from 'node:child_process';
import { activeProcesses, NUMSTAT_BOUNDARY_STR } from './git-runner.js';

export async function getNumstatMap(lockedArgs: string[], stdinShas?: string) {
  const numstatArgs = ['--no-pager', '-c', 'core.quotePath=false', 'log', '--numstat', '-z', `--pretty=format:${NUMSTAT_BOUNDARY_STR}%H`];
  if (stdinShas) numstatArgs.push('--stdin', '--no-walk');
  numstatArgs.push(...lockedArgs);
  const ac = new AbortController();
  let idleTimeout = setTimeout(() => ac.abort(), 300000);
  idleTimeout.unref();
  const absoluteTimeout = setTimeout(() => {
    console.warn('Warning: getNumstatMap exceeded 15 minute absolute timeout. Aborting.');
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
    proc = spawn('git', numstatArgs, { signal: ac.signal, windowsHide: true });
    activeProcesses.add(proc);
  } catch (err) {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    throw err;
  }
  
  if (!proc.stdout || !proc.stderr || !proc.stdin) {
    activeProcesses.delete(proc);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    throw new Error('Missing stdio');
  }

  const outChunks: Buffer[] = [];
  const errChunks: string[] = [];
  
  if (stdinShas) {
    proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE' && err.code !== 'EOF') console.error('stdin error:', err.message);
    });
    try {
      proc.stdin.write(stdinShas);
      proc.stdin.end();
    } catch { /* ignore synchronous EPIPE */ }
  }

  let errLength = 0;
  let hasTruncatedErr = false;
  proc.stderr.on('data', d => {
    const s = d.toString('utf-8');
    if (errLength < 100000) {
      errChunks.push(s);
      errLength += s.length;
    } else if (!hasTruncatedErr) {
      errChunks.push('\n...[stderr truncated]');
      hasTruncatedErr = true;
    }
  });

  const processOutput = new Promise<void>((resolve, reject) => {
    let resolved = false;
    proc.on('close', (code, signal) => {
      if (!resolved) {
        resolved = true;
        // Ignore code 141 (SIGPIPE) which happens if we kill the process or close early
        if (ac.signal.aborted) {
          reject(new Error(`Git numstat timed out and was aborted: ${errChunks.join('')}`));
        } else if (((code !== 0 && code !== null && code !== 141) || (signal && signal !== 'SIGTERM' && signal !== 'SIGKILL' && signal !== 'SIGPIPE')) && !oomError) {
          reject(new Error(`Git numstat failed with code ${code} and signal ${signal}: ${errChunks.join('')}`));
        } else {
          resolve();
        }
      }
    });
    proc.on('error', err => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
  processOutput.catch(() => {});

  let totalBytes = 0;
  const MAX_BYTES = 200 * 1024 * 1024;
  let oomError: Error | null = null;

  try {
    for await (const chunk of proc.stdout) {
      resetTimeout();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_BYTES) {
        proc.kill('SIGKILL');
        oomError = new Error('Git numstat output exceeded 200MB memory limit');
        break;
      }
      outChunks.push(buf);
    }
  } catch {
    /* ignore */
  } finally {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch (_e) { void _e; }
    }
    activeProcesses.delete(proc);
  }
  
  if (oomError) {
    console.warn(`Warning: ${oomError.message}. Some file numstats may be missing.`);
  }
  await processOutput.catch(err => { throw err; });
  const fullBuffer = Buffer.concat(outChunks);
  
  const BOUNDARY = Buffer.from(NUMSTAT_BOUNDARY_STR);
  const map = new Map<string, Map<string, { insertions: number; deletions: number; path: string; isBinary?: boolean }>>();
  let currentSha = '';
  
  let i = 0;
  const readUntilNulOrBoundary = (nextBoundaryIdx: number) => {
    if (i >= fullBuffer.length) return '';
    const start = i;
    const maxLen = Math.min(fullBuffer.length, nextBoundaryIdx);
    const nulIdx = fullBuffer.indexOf(0, start);
    const endIdx = nulIdx !== -1 && nulIdx < maxLen ? nulIdx : maxLen;
    const str = fullBuffer.toString('utf-8', start, endIdx);
    i = endIdx < maxLen && fullBuffer[endIdx] === 0 ? endIdx + 1 : endIdx;
    return str;
  };

  while (i < fullBuffer.length) {
    if (fullBuffer[i] === 0x1E && fullBuffer.indexOf(BOUNDARY, i) === i) {
      i += BOUNDARY.length;
      let shaEnd = fullBuffer.indexOf(0x0A, i);
      const nullIdx = fullBuffer.indexOf(0x00, i);
      
      if (shaEnd === -1 || (nullIdx !== -1 && nullIdx < shaEnd)) {
        shaEnd = nullIdx;
      }
      
      if (shaEnd === -1) {
        shaEnd = fullBuffer.length;
      }
      
      const nextRecord = fullBuffer.indexOf(BOUNDARY, i);
      
      if (nextRecord !== -1 && nextRecord < shaEnd) {
        shaEnd = nextRecord;
      }
      
      currentSha = fullBuffer.toString('utf-8', i, shaEnd).trim();
      i = shaEnd;
      if (i < fullBuffer.length && (fullBuffer[i] === 0x0A || fullBuffer[i] === 0x00)) i++;
      map.set(currentSha, new Map());
      continue;
    }
    
    if (fullBuffer[i] === 0) {
      i++;
      continue;
    }

    let nextBoundaryIdx = fullBuffer.indexOf(BOUNDARY, i);
    if (nextBoundaryIdx === -1) nextBoundaryIdx = fullBuffer.length;

    let firstStr = readUntilNulOrBoundary(nextBoundaryIdx);
    firstStr = firstStr.replace(/^\n+/, '');
    const parts = firstStr.split('\t');
    
    if (parts.length >= 2) {
      const pathStartIndex = 2;
      
      if (pathStartIndex >= 2) {
        let isBinary = false;
        let ins = 0;
        let del = 0;
        for (let j = 0; j < pathStartIndex - 1; j += 2) {
           if (parts[j] === '-' || parts[j+1] === '-') isBinary = true;
           const parsedIns = parseInt(parts[j], 10) || 0;
           const parsedDel = parseInt(parts[j+1], 10) || 0;
           ins += Math.min(parsedIns, Number.MAX_SAFE_INTEGER);
           del += Math.min(parsedDel, Number.MAX_SAFE_INTEGER);
        }
        
        let oldPath: string | undefined;
        let newPath: string;
        
        if (pathStartIndex < parts.length && parts[pathStartIndex] === '') {
          oldPath = readUntilNulOrBoundary(nextBoundaryIdx);
          newPath = readUntilNulOrBoundary(nextBoundaryIdx);
        } else if (pathStartIndex < parts.length) {
          newPath = parts.slice(pathStartIndex).join('\t');
        } else {
          oldPath = readUntilNulOrBoundary(nextBoundaryIdx);
          newPath = readUntilNulOrBoundary(nextBoundaryIdx);
        }
        
        // Defensive check against truncated/malformed stat buffers
        if (!newPath) newPath = 'unknown_path_due_to_malformed_buffer';
        
        const stats = { insertions: ins, deletions: del, path: newPath, ...(isBinary ? { isBinary: true } : {}) };
      
        const fileStats = map.get(currentSha);
        if (fileStats) {
          fileStats.set(newPath, stats);
          if (oldPath) fileStats.set(oldPath, stats);
        }
      }
    }
  }
  return map;
}
