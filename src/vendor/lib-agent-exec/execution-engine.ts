// @ts-nocheck
import { ProcessController } from './process-controller.js';
import { ExecPayload } from './schema.js';

import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';

const WSL_LOCK_DIR = path.join(os.tmpdir(), 'agent-exec-wsl-lock');

async function acquireWslLock(maxConcurrent = 4, timeoutMs = 30000): Promise<string> {
  if (!fs.existsSync(WSL_LOCK_DIR)) {
    try { fs.mkdirSync(WSL_LOCK_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  const mutexPath = path.join(WSL_LOCK_DIR, 'mutex.dir');
  const acquireMutex = async () => {
    while (true) {
      try {
        fs.mkdirSync(mutexPath); // Atomic operation
        return;
      } catch {
        try {
          if (Date.now() - fs.statSync(mutexPath).mtimeMs > 15000) {
            fs.rmdirSync(mutexPath);
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 20 + Math.random() * 50));
      }
    }
  };

  const releaseMutex = () => {
    try { fs.rmdirSync(mutexPath); } catch { /* ignore */ }
  };

  const lockFile = path.join(WSL_LOCK_DIR, `${Date.now()}-${crypto.randomUUID()}.lock`);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    await acquireMutex();
    try {
      const locks = fs.readdirSync(WSL_LOCK_DIR).filter(f => f.endsWith('.lock'));
      // Clean up stale locks (older than 60s to prevent deadlocks from crashed processes)
      for (const l of locks) {
        const lPath = path.join(WSL_LOCK_DIR, l);
        try {
          const stats = fs.statSync(lPath);
          if (Date.now() - stats.mtimeMs > 60000) fs.unlinkSync(lPath);
        } catch { /* ignore */ }
      }
      const activeLocks = fs.readdirSync(WSL_LOCK_DIR).filter(f => f.endsWith('.lock'));
      if (activeLocks.length < maxConcurrent) {
        fs.writeFileSync(lockFile, process.pid.toString(), 'utf8');
        releaseMutex();
        return lockFile;
      }
    } catch { /* ignore */ } finally {
      releaseMutex();
    }
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
  }
  // If we timeout, we proceed anyway to avoid completely deadlocking the agent, but write the lock
  try { fs.writeFileSync(lockFile, process.pid.toString(), 'utf8'); } catch { /* ignore */ }
  return lockFile;
}

export async function executeCommand(
  payload: ExecPayload,
  cwd: string,
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  tempScriptPath?: string | null,
  isJson: boolean = false
) {
  if (payload.target === 'wsl2') {
    const hasUuid = args.some(a => typeof a === 'string' && a.startsWith('AGENT_EXEC_WSL_UUID='));
    if (!hasUuid) {
      if (isJson) {
         console.log(JSON.stringify({ status: "error", message: `Execution Error: Target is 'wsl2', but AGENT_EXEC_WSL_UUID was not found in the execution arguments. You MUST route WSL2 execution through 'buildCommand' to prevent zombie processes.` }));
      } else {
         console.error(`❌ Execution Error: Target is 'wsl2', but AGENT_EXEC_WSL_UUID was not found in the execution arguments. You MUST route WSL2 execution through 'buildCommand' to prevent zombie processes.`);
      }
      process.exit(1);
    }
  }
  const controller = new ProcessController(
    payload,
    cwd,
    cmd,
    args,
    env,
    tempScriptPath || null,
    isJson
  );
  
  if (payload.target === 'wsl2') {
    const maxConcurrency = process.env.AGENT_WSL_CONCURRENCY ? parseInt(process.env.AGENT_WSL_CONCURRENCY, 10) : 4;
    const lockFile = await acquireWslLock(maxConcurrency);
    
    // Ensure we release the lock when the process exits
    const releaseLock = () => {
      try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch { /* ignore */ }
    };
    process.on('exit', releaseLock);
    process.on('SIGINT', releaseLock);
    process.on('SIGTERM', releaseLock);
    process.on('uncaughtException', () => releaseLock());
  }
  
  controller.start();
}
