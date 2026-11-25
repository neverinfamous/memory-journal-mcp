// @ts-nocheck
import { type ChildProcess, spawnSync } from 'node:child_process';
import path from 'node:path';

export const processManagerHooks: { onKill?: (pid: number) => void }[] = [];

export function isPidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
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

const isPidStillRunning = isPidAlive;

/**
 * [INTENT]: Enumerate Windows parent->children PID edges via CIM (`Win32_Process`) when `taskkill /T` fails
 * under concurrent WMI contention (`wmic.exe` is removed on Windows 11 24H2+).
 */
function rememberChild(parentMap: Map<number, number[]>, rawLine: string): void {
  const line = rawLine.trim();
  if (line.length === 0) return;
  const commaIdx = line.indexOf(',');
  if (commaIdx === -1) return;
  const ppid = parseInt(line.slice(0, commaIdx), 10);
  const childPid = parseInt(line.slice(commaIdx + 1), 10);
  if (Number.isNaN(ppid) || Number.isNaN(childPid) || childPid <= 0) return;
  const list = parentMap.get(ppid);
  if (list !== undefined) list.push(childPid);
  else parentMap.set(ppid, [childPid]);
}

function enqueueChild(state: { ordered: number[]; visited: Set<number>; queue: number[] }, childPid: number): void {
  if (state.visited.has(childPid) || childPid === process.pid) return;
  state.visited.add(childPid);
  state.ordered.push(childPid);
  state.queue.push(childPid);
}

function collectDescendants(parentMap: Map<number, number[]>, rootPid: number): number[] {
  const state = { ordered: [] as number[], visited: new Set<number>([rootPid]), queue: [rootPid] };
  let head = 0;
  while (head < state.queue.length) {
    const current = state.queue[head++];
    const children = current === undefined ? undefined : parentMap.get(current);
    if (children === undefined) continue;
    for (const childPid of children) enqueueChild(state, childPid);
  }
  return state.ordered;
}

function isIgnorableKillError(err: unknown): boolean {
  const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
  return code === 'ESRCH' || code === 'EPERM' || code === 'ENOENT';
}

function logUnexpectedKillError(scope: string, err: unknown): void {
  if (!isIgnorableKillError(err)) {
    console.error(`⚠️ [process-manager] ${scope} warning: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function killPidBatchHard(targetPids: readonly number[]): void {
  const alivePids = targetPids.filter((pid) => isPidAlive(pid));
  if (alivePids.length === 0) return;
  for (let i = 0; i < alivePids.length; i += 32) {
    const slice = alivePids.slice(i, i + 32);
    const tkArgs: string[] = [];
    for (const pid of slice) tkArgs.push('/pid', String(pid));
    tkArgs.push('/t', '/f');
    try {
      spawnSync('taskkill.exe', tkArgs, {
        shell: false,
        timeout: 5000,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (err: unknown) {
      logUnexpectedKillError('taskkill batch', err);
    }
    for (const pid of slice) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err: unknown) {
        logUnexpectedKillError(`SIGKILL pid ${pid}`, err);
      }
    }
  }
}

function killWindowsDescendantsFallback(rootPid: number): void {
  try {
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ParentProcessId),$($_.ProcessId)" }',
      ],
      { encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    if (ps.error || typeof ps.stdout !== 'string' || ps.stdout.length === 0) return;
    const parentMap = new Map<number, number[]>();
    for (const rawLine of ps.stdout.split(/\r?\n/)) rememberChild(parentMap, rawLine);
    const ordered = collectDescendants(parentMap, rootPid);
    const bottomUp = ordered.slice().reverse();
    killPidBatchHard(bottomUp);
  } catch (err: unknown) {
    logUnexpectedKillError('Windows descendant snapshot', err);
  }
}

const WSL_UUID_ARG = /^AGENT_EXEC_WSL_UUID=[0-9a-f-]+$/i;

export function extractWslDistroArgs(spawnargs: readonly string[]): string[] {
  for (let i = 0; i < spawnargs.length; i++) {
    const arg = spawnargs[i];
    if (arg === undefined) continue;
    if (arg === '--' || arg === '-e' || arg === '--exec') break;
    if ((arg === '-d' || arg === '--distribution') && spawnargs[i + 1] !== undefined) {
      return ['-d', spawnargs[i + 1] ?? ''];
    }
    if (arg.startsWith('--distribution=')) {
      const distro = arg.slice('--distribution='.length);
      if (distro.length > 0) return ['-d', distro];
    }
  }
  return [];
}

function killWslProcessGroup(spawnargs: readonly string[]): void {
  const uuidArg = spawnargs.find((arg) => arg.startsWith('AGENT_EXEC_WSL_UUID='));
  if (uuidArg === undefined || !WSL_UUID_ARG.test(uuidArg)) return;
  try {
    const distroArgs = extractWslDistroArgs(spawnargs);
    const killScript = `pids=$(grep -l -z '${uuidArg}' /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); if [ -n "$pids" ]; then for pid in $pids; do kill -9 -$pid 2>/dev/null || kill -9 $pid 2>/dev/null; done; fi`;
    spawnSync('wsl.exe', [...distroArgs, '-u', 'root', '-e', 'sh', '-c', killScript], { stdio: 'ignore', timeout: 10000, windowsHide: true });
  } catch (err: unknown) {
    logUnexpectedKillError('WSL process group kill', err);
  }
}

function taskkillTree(pid: number): 'killed' | 'exited' | 'failed' {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = spawnSync('taskkill.exe', ['/pid', pid.toString(), '/t', '/f'], {
        shell: false,
        timeout: 10000,
        stdio: 'ignore',
        windowsHide: true,
      });
      if (!result.error && result.status === 0) return 'killed';
      if (!isPidStillRunning(pid)) return 'exited';
    } catch (err: unknown) {
      if (!isIgnorableKillError(err)) {
        logUnexpectedKillError(`taskkill tree pid ${pid}`, err);
        break;
      }
    }
  }
  return 'failed';
}

function killWindowsTree(child: ChildProcess, pid: number, parentGone: boolean): void {
  const spawnfile = child.spawnfile || '';
  const spawnargs: string[] = child.spawnargs;
  const baseSpawn = path.basename(spawnfile).toLowerCase().replace(/\.exe$/, '');
  if (baseSpawn === 'wsl') killWslProcessGroup(spawnargs);
  if (parentGone) {
    if (child.killed || isPidStillRunning(pid)) killWindowsDescendantsFallback(pid);
  } else {
    const tkStatus = taskkillTree(pid);
    if (tkStatus === 'failed') killWindowsDescendantsFallback(pid);
  }
  try {
    child.kill('SIGKILL');
  } catch (err: unknown) {
    logUnexpectedKillError(`child.kill SIGKILL pid ${pid}`, err);
  }
}

function killUnixTree(child: ChildProcess, pid: number, force = true): void {
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  let killedGroup = false;
  try {
    process.kill(-pid, signal);
    killedGroup = true;
  } catch (err: unknown) {
    logUnexpectedKillError(`process.kill -${pid} ${signal}`, err);
  }
  if (!killedGroup) {
    try {
      process.kill(pid, signal);
    } catch (err: unknown) {
      logUnexpectedKillError(`process.kill ${pid} ${signal}`, err);
    }
  }
  if (force) {
    try {
      child.kill('SIGKILL');
    } catch (err: unknown) {
      logUnexpectedKillError(`child.kill SIGKILL pid ${pid}`, err);
    }
    return;
  }
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err: unknown) {
      logUnexpectedKillError(`delayed process.kill -${pid}`, err);
    }
    try {
      child.kill('SIGKILL');
    } catch (err: unknown) {
      logUnexpectedKillError(`delayed child.kill ${pid}`, err);
    }
  }, 5000).unref();
}

export function killProcessTree(child: ChildProcess, force = true): void {
  if (child.pid === undefined || child.pid === 0) return;
  const pid = child.pid;
  const parentGone = child.killed || child.exitCode !== null || child.signalCode !== null;
  for (const hook of processManagerHooks) {
    if (hook.onKill) {
      try { hook.onKill(pid); } catch (err: unknown) {
        console.error(`⚠️ Process kill hook error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (process.platform === 'win32') killWindowsTree(child, pid, parentGone);
  else killUnixTree(child, pid, force);
}
