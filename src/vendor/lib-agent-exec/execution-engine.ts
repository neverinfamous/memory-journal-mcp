// @ts-nocheck
import { ProcessController } from './process-controller.js';
import { isPidAlive } from './process-manager.js';
import { convertToWindowsPath } from './command-utils.js';
import { resolvePackageProjectDir } from './interceptors/package-manager-js-rewrites.js';
import { acquireValidationLock, classifyValidationCommand } from './validation-lock.js';
import { ExecPayload } from './schema.js';

import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';

const WSL_LOCK_DIR = path.join(os.tmpdir(), 'agent-exec-wsl-lock');

function parsePositiveSafeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function pruneExpiredMutexDir(mutexPath: string): void {
  try {
    const st = fs.statSync(mutexPath, { throwIfNoEntry: false });
    if (st !== undefined && Date.now() - st.mtimeMs > 15000) {
      fs.rmdirSync(mutexPath);
    }
  } catch { /* ignore */ }
}

async function tryAcquireMutex(mutexPath: string, deadlineMs: number): Promise<boolean> {
  do {
    try {
      fs.mkdirSync(mutexPath); // Atomic operation
      return true;
    } catch (err: unknown) {
      const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
      if (code !== undefined && code !== 'EEXIST') return false;
      pruneExpiredMutexDir(mutexPath);
      if (Date.now() >= deadlineMs) break;
      await new Promise(r => setTimeout(r, 20 + Math.random() * 50));
    }
  } while (Date.now() < deadlineMs);
  return false;
}

function releaseMutexDir(mutexPath: string): void {
  try { fs.rmdirSync(mutexPath); } catch { /* ignore */ }
}

function isLockFileStale(lPath: string, nowMs: number): boolean {
  const content = fs.readFileSync(lPath, 'utf8').trim();
  const mtimeMs = fs.statSync(lPath).mtimeMs;
  const ageMs = nowMs - mtimeMs;
  const lockPid = parsePositiveSafeInt(content);
  if (lockPid !== null) {
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
  try {
    if (!fs.existsSync(WSL_LOCK_DIR)) {
      fs.mkdirSync(WSL_LOCK_DIR, { recursive: true, mode: 0o700 });
    }
  } catch (err: unknown) {
    console.error(`⚠️ WSL lock dir creation failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }

  const mutexPath = path.join(WSL_LOCK_DIR, 'mutex.dir');
  const lockFile = path.join(WSL_LOCK_DIR, `${Date.now()}-${crypto.randomUUID()}.lock`);
  const deadlineMs = Date.now() + timeoutMs;

  do {
    const acquiredMutex = await tryAcquireMutex(mutexPath, deadlineMs);
    if (!acquiredMutex) break;
    let writeFailed = false;
    try {
      const activeLockCount = countActiveAndPruneStaleLocks();
      if (activeLockCount < maxConcurrent) {
        fs.writeFileSync(lockFile, process.pid.toString(), { encoding: 'utf8', mode: 0o600 });
        return lockFile;
      }
    } catch (err: unknown) {
      writeFailed = true;
      console.error(`⚠️ WSL lock file write failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      releaseMutexDir(mutexPath);
    }
    if (writeFailed || Date.now() >= deadlineMs) break;
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
  } while (Date.now() < deadlineMs);
  // If we timeout or cannot persist a lock file, proceed without poisoning activeLockCount
  return '';
}

function registerProcessCleanup(cleanupFn: () => void): void {
  let done = false;
  const releaseAll = () => {
    if (done) return;
    done = true;
    try { cleanupFn(); } catch { /* ignore */ }
    process.off('exit', releaseAll);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('uncaughtException', onUncaught);
  };
  const onSignal = (sig: NodeJS.Signals) => {
    if (process.listenerCount(sig) === 0) {
      releaseAll();
      process.kill(process.pid, sig);
    }
  };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  const onUncaught = (err: unknown) => {
    releaseAll();
    if (process.listenerCount('uncaughtException') === 0) {
      console.error(err);
      process.exit(1);
    }
  };
  process.once('exit', releaseAll);
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('uncaughtException', onUncaught);
}

function deductTimeout(baseTimeoutMs: number | undefined, elapsedMs: number): number | undefined {
  if (baseTimeoutMs === undefined || baseTimeoutMs <= 0) return undefined;
  const floor = Math.min(5000, baseTimeoutMs);
  return Math.max(floor, baseTimeoutMs - elapsedMs);
}

function runCleanupHandlers(cleanups: readonly (() => void)[]): void {
  for (let i = cleanups.length - 1; i >= 0; i--) {
    try { cleanups[i]?.(); } catch { /* ignore */ }
  }
}

async function acquireExecutionLocks(
  payload: ExecPayload,
  cwd: string,
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  isJson: boolean,
): Promise<number | undefined> {
  let effectiveTimeoutMs: number | undefined;
  const cleanups: Array<() => void> = [];
  let cleanupRegistered = false;
  const addCleanup = (fn: () => void): void => {
    cleanups.push(fn);
    if (!cleanupRegistered) {
      cleanupRegistered = true;
      registerProcessCleanup(() => runCleanupHandlers(cleanups));
    }
  };

  const logicalCmd = payload.type === 'command' ? payload.command : cmd;
  const logicalArgs = payload.type === 'command' ? (payload.args ?? []) : args;
  const classification = classifyValidationCommand(logicalCmd, logicalArgs);
  if (classification !== null) {
    const rawPayloadCwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : '';
    const isWslPosixCwd = payload.target === 'wsl2' && rawPayloadCwd.length > 0
      && ((rawPayloadCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawPayloadCwd)) || rawPayloadCwd.startsWith('~'));
    const projectBaseCwd = isWslPosixCwd ? rawPayloadCwd : cwd;
    const rawProjectDir = resolvePackageProjectDir(logicalArgs, projectBaseCwd);
    const projectDir = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawProjectDir)
      ? convertToWindowsPath(rawProjectDir)
      : rawProjectDir;
    const baseTimeout = effectiveTimeoutMs ?? payload.timeoutMs;
    const customWaitMs = parsePositiveSafeInt(env['AGENT_EXEC_VALIDATION_LOCK_TIMEOUT_MS'] ?? process.env['AGENT_EXEC_VALIDATION_LOCK_TIMEOUT_MS'] ?? '');
    const defaultWaitMs = baseTimeout !== undefined && baseTimeout > 0
      ? Math.min(Math.max(15_000, Math.floor(baseTimeout * 0.5)), 120_000)
      : 90_000;
    const lockStartMs = Date.now();
    const handle = await acquireValidationLock({
      projectDir,
      classification,
      timeoutMs: customWaitMs ?? defaultWaitMs,
      isJson,
      env,
    });
    effectiveTimeoutMs = deductTimeout(baseTimeout, Date.now() - lockStartMs) ?? effectiveTimeoutMs;
    if (handle !== null) addCleanup(handle.release);
  }

  if (payload.target === 'wsl2') {
    const parsedConcurrency = parsePositiveSafeInt(process.env['AGENT_WSL_CONCURRENCY'] ?? '');
    const maxConcurrency = parsedConcurrency ?? 4;
    const baseWaitTimeout = effectiveTimeoutMs ?? payload.timeoutMs;
    const lockWaitMs = baseWaitTimeout !== undefined && baseWaitTimeout > 0
      ? Math.min(Math.max(1000, Math.floor(baseWaitTimeout * 0.5)), 45000)
      : 30000;
    const lockStartMs = Date.now();
    const lockFile = await acquireWslLock(maxConcurrency, lockWaitMs);
    effectiveTimeoutMs = deductTimeout(baseWaitTimeout, Date.now() - lockStartMs) ?? effectiveTimeoutMs;
    if (lockFile.length > 0) {
      addCleanup(() => { fs.unlinkSync(lockFile); });
    }
  }
  return effectiveTimeoutMs;
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

  const effectiveTimeoutMs = await acquireExecutionLocks(payload, cwd, cmd, args, env, isJson);

  const controller = new ProcessController(
    payload,
    cwd,
    cmd,
    args,
    env,
    tempScriptPath || null,
    isJson,
    effectiveTimeoutMs,
  );

  controller.start();
}
