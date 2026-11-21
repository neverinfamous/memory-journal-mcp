// @ts-nocheck
import { ProcessController } from './process-controller.js';
import { ExecPayload } from './schema.js';

import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';

const WSL_LOCK_DIR = path.join(os.tmpdir(), 'agent-exec-wsl-lock');

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      return err.code === 'EPERM';
    }
    return false;
  }
}

async function tryAcquireMutex(mutexPath: string, deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    try {
      fs.mkdirSync(mutexPath); // Atomic operation
      return true;
    } catch {
      try {
        if (Date.now() - fs.statSync(mutexPath).mtimeMs > 15000) {
          fs.rmdirSync(mutexPath);
        }
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 20 + Math.random() * 50));
    }
  }
  return false;
}

function releaseMutexDir(mutexPath: string): void {
  try { fs.rmdirSync(mutexPath); } catch { /* ignore */ }
}

function isLockFileStale(lPath: string, nowMs: number): boolean {
  const content = fs.readFileSync(lPath, 'utf8').trim();
  const mtimeMs = fs.statSync(lPath).mtimeMs;
  const ageMs = nowMs - mtimeMs;
  const lockPid = Number.parseInt(content, 10);
  if (!Number.isNaN(lockPid) && lockPid > 0) {
    return !isPidAlive(lockPid) || ageMs > 7_200_000;
  }
  return ageMs > 10_000;
}

function countActiveAndPruneStaleLocks(): number {
  const allLocks = fs.readdirSync(WSL_LOCK_DIR).filter(f => f.endsWith('.lock'));
  const nowMs = Date.now();
  let activeLockCount = 0;
  for (const fileName of allLocks) {
    const lPath = path.join(WSL_LOCK_DIR, fileName);
    try {
      if (isLockFileStale(lPath, nowMs)) {
        fs.unlinkSync(lPath);
      } else {
        activeLockCount++;
      }
    } catch { /* ignore */ }
  }
  return activeLockCount;
}

export async function acquireWslLock(maxConcurrent = 4, timeoutMs = 30000): Promise<string> {
  if (!fs.existsSync(WSL_LOCK_DIR)) {
    try { fs.mkdirSync(WSL_LOCK_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  const mutexPath = path.join(WSL_LOCK_DIR, 'mutex.dir');
  const lockFile = path.join(WSL_LOCK_DIR, `${Date.now()}-${crypto.randomUUID()}.lock`);
  const deadlineMs = Date.now() + timeoutMs;

  while (Date.now() < deadlineMs) {
    const acquiredMutex = await tryAcquireMutex(mutexPath, deadlineMs);
    if (!acquiredMutex) break;
    try {
      const activeLockCount = countActiveAndPruneStaleLocks();
      if (activeLockCount < maxConcurrent) {
        fs.writeFileSync(lockFile, process.pid.toString(), { encoding: 'utf8', mode: 0o600 });
        return lockFile;
      }
    } catch { /* ignore */ } finally {
      releaseMutexDir(mutexPath);
    }
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
  }
  // If we timeout, proceed without writing an overflow lock file so activeLockCount is not poisoned for subsequent callers
  return '';
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

  if (payload.target === 'wsl2') {
    const rawConcurrency = process.env['AGENT_WSL_CONCURRENCY'] ?? '';
    const parsedConcurrency = Number.parseInt(rawConcurrency, 10);
    const maxConcurrency = Number.isFinite(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : 4;
    const lockWaitMs = payload.timeoutMs !== undefined && payload.timeoutMs > 30000
      ? Math.min(Math.floor(payload.timeoutMs * 0.5), 45000)
      : 30000;
    const lockStartMs = Date.now();
    const lockFile = await acquireWslLock(maxConcurrency, lockWaitMs);
    if (payload.timeoutMs !== undefined && payload.timeoutMs > 0) {
      const elapsedLockMs = Date.now() - lockStartMs;
      payload.timeoutMs = Math.max(5000, payload.timeoutMs - elapsedLockMs);
    }
    
    if (lockFile.length > 0) {
      const releaseLock = () => {
        try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch { /* ignore */ }
        process.off('exit', releaseLock);
        process.off('SIGINT', releaseLock);
        process.off('SIGTERM', releaseLock);
        process.off('uncaughtException', releaseLock);
      };
      process.once('exit', releaseLock);
      process.once('SIGINT', releaseLock);
      process.once('SIGTERM', releaseLock);
      process.once('uncaughtException', releaseLock);
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
  
  controller.start();
}
