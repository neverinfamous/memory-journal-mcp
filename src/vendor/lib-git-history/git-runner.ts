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
export const NUMSTAT_BOUNDARY_STR = `\x1E<GIT_NUMSTAT_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const PATCH_BOUNDARY_STR = `\x1E<GIT_PATCH_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const FIELD_SEPARATOR = '\x00';

export function getGitTagRange(): { range: string; isFallback: boolean; headSha: string } {
  let headSha = 'HEAD';
  const execOpts = { encoding: 'utf-8' as const, stdio: 'pipe' as const, timeout: 10000, maxBuffer: 10 * 1024 * 1024, windowsHide: true };
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

export async function* streamGitRecords(args: string[]): AsyncGenerator<string> {
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
    proc = spawn('git', ['--no-pager', ...args], { signal: ac.signal, windowsHide: true });
    activeProcesses.add(proc);
  } catch (err) {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    throw err;
  }
  
  if (!proc.stdout || !proc.stderr) throw new Error('Missing stdio');

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

  const processComplete = new Promise<void>((resolve, reject) => {
    let resolved = false;
    proc.on('close', (code, signal) => {
      if (!resolved) {
        resolved = true;
        if (ac.signal.aborted) {
          reject(new Error(`Git process timed out and was aborted: ${errChunks.join('')}`));
        } else if ((code !== 0 && code !== null && code !== 141) || (signal && signal !== 'SIGTERM' && signal !== 'SIGKILL' && signal !== 'SIGPIPE')) {
          reject(new Error(`Git failed with code ${code} and signal ${signal}: ${errChunks.join('')}`));
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
  processComplete.catch(() => {});

  let buffer = '';
  let droppingMassiveCommit = false;
  try {
    for await (const chunk of proc.stdout) {
      resetTimeout();
      buffer += chunk;
      let sepIdx;
      let lastSlice = 0;

      if (droppingMassiveCommit) {
        const nextBoundary = buffer.indexOf(RECORD_SEPARATOR);
        if (nextBoundary !== -1) {
          droppingMassiveCommit = false;
          lastSlice = nextBoundary + RECORD_SEPARATOR.length;
        } else {
          buffer = buffer.length > RECORD_SEPARATOR.length ? buffer.slice(-(RECORD_SEPARATOR.length - 1)) : buffer;
          continue;
        }
      }

      while ((sepIdx = buffer.indexOf(RECORD_SEPARATOR, lastSlice)) !== -1) {
        const record = buffer.slice(lastSlice, sepIdx);
        if (record.trim()) yield record;
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
    await processComplete;
    if (buffer.trim()) yield buffer;
  } finally {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch (_e) { void _e; }
    }
    activeProcesses.delete(proc);
  }
}

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
  
  if (!proc.stdout || !proc.stderr || !proc.stdin) throw new Error('Missing stdio');

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
           ins += parseInt(parts[j], 10) || 0;
           del += parseInt(parts[j+1], 10) || 0;
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

export async function getPatchMap(lockedArgs: string[], args: CliArgs, stdinShas?: string) {
  if (!args['include-patch']) return new Map();
  const patchBaseArgs = [...lockedArgs];
  const excludes = [
    ':(exclude)*.lock', ':(exclude)*-lock.json', ':(exclude)*.min.js', ':(exclude)*.map',
    ':(exclude)pnpm-workspace.yaml', ':(exclude)pnpm-lock.yaml',
    ':(exclude)*.svg', ':(exclude)*.png', ':(exclude)*.jpg', ':(exclude)*.jpeg', ':(exclude)*.gif',
    ':(exclude)**/dist/*', ':(exclude)**/build/*', ':(exclude)**/coverage/*',
    ':(exclude)*.csv', ':(exclude)*.txt',
    ':(exclude)go.sum', ':(exclude)**/.pnp.*', ':(exclude)**/vendor/*'
  ];
  if (patchBaseArgs.includes('--')) {
    patchBaseArgs.push(...excludes);
  } else {
    patchBaseArgs.push('--', ...excludes);
  }
  const patchArgs = ['--no-pager', '-c', 'core.quotePath=false', 'log', '-p', args['diff-context'] ? `-U${args['diff-context']}` : '-U1', `--pretty=format:${PATCH_BOUNDARY_STR}%H%x0A`];
  if (stdinShas) patchArgs.push('--stdin', '--no-walk');
  patchArgs.push(...patchBaseArgs);

  const map = new Map<string, { patch: string; truncated: boolean }>();
  const ac = new AbortController();
  let idleTimeout = setTimeout(() => ac.abort(), 300000);
  idleTimeout.unref();
  const absoluteTimeout = setTimeout(() => {
    console.warn('Warning: getPatchMap exceeded 15 minute absolute timeout. Aborting.');
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
    proc = spawn('git', patchArgs, { signal: ac.signal, windowsHide: true });
    activeProcesses.add(proc);
  } catch (err) {
    clearTimeout(idleTimeout);
    clearTimeout(absoluteTimeout);
    throw err;
  }
  
  if (!proc.stdout || !proc.stderr || !proc.stdin) throw new Error('Missing stdio');

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
        if (ac.signal.aborted) {
          reject(new Error(`Git patch timed out and was aborted: ${errChunks.join('')}`));
        } else if (((code !== 0 && code !== null && code !== 141) || (signal && signal !== 'SIGTERM' && signal !== 'SIGKILL' && signal !== 'SIGPIPE')) && !oomError) {
          reject(new Error(`Git patch failed with code ${code} and signal ${signal}: ${errChunks.join('')}`));
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

  const outChunks: Buffer[] = [];
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
        oomError = new Error('Git patch output exceeded 200MB memory limit');
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
    console.warn(`Warning: ${oomError.message}. Some patches may be missing.`);
  }
  await processOutput.catch(err => { throw err; });
  const fullBuffer = Buffer.concat(outChunks);

  const parsedMaxPatchLen = args['max-patch-length'] ? parseInt(args['max-patch-length'], 10) : undefined;
  const maxPatchLen = (parsedMaxPatchLen !== undefined && !Number.isNaN(parsedMaxPatchLen) && parsedMaxPatchLen >= 0) ? parsedMaxPatchLen : 20000;
  
  const BOUNDARY = Buffer.from(PATCH_BOUNDARY_STR);

  let i = 0;

  while (i < fullBuffer.length) {
    const nextIdx = fullBuffer.indexOf(BOUNDARY, i);
    if (nextIdx === -1) break;
    
    i = nextIdx + BOUNDARY.length;
    const hashEnd = fullBuffer.indexOf(0x0A, i);
    if (hashEnd !== -1) {
      const hash = fullBuffer.toString('utf-8', i, hashEnd).trim();
      const nextRs = fullBuffer.indexOf(BOUNDARY, hashEnd + 1);
      const patchEnd = nextRs !== -1 ? nextRs : fullBuffer.length;
      
      const patchByteLen = patchEnd - (hashEnd + 1);
      if (patchByteLen > maxPatchLen) {
        const maxEnd = Math.min(hashEnd + 1 + maxPatchLen, fullBuffer.length);
        let safeEnd = maxEnd;
        while (safeEnd > hashEnd + 1 && safeEnd < fullBuffer.length && (fullBuffer[safeEnd] & 0xC0) === 0x80) safeEnd--;
        const patch = fullBuffer.toString('utf-8', hashEnd + 1, safeEnd).trim() + '\n...[patch truncated due to length]';
        map.set(hash, { patch, truncated: true });
      } else {
        const patch = fullBuffer.toString('utf-8', hashEnd + 1, patchEnd).trim();
        map.set(hash, { patch, truncated: false });
      }
      i = patchEnd;
    } else {
      break;
    }
  }
  return map;
}
