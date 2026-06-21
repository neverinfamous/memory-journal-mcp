// @ts-nocheck
import { spawn } from 'node:child_process';
import { activeProcesses, PATCH_BOUNDARY_STR } from './git-runner.js';
import type { CliArgs } from './cli.js';

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
