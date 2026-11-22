// @ts-nocheck
import { ChildProcess, spawnSync } from 'node:child_process';

export const processManagerHooks: { onKill?: (pid: number) => void }[] = [];

export function isPidAlive(pid: number): boolean {
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
  while (state.queue.length > 0) {
    const current = state.queue.shift();
    const children = current === undefined ? undefined : parentMap.get(current);
    if (children === undefined) continue;
    for (const childPid of children) enqueueChild(state, childPid);
  }
  return state.ordered;
}

function killPidHard(targetPid: number): void {
  try {
    spawnSync('taskkill.exe', ['/pid', String(targetPid), '/t', '/f'], {
      shell: false,
      timeout: 5000,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch { /* ignore */ }
  try {
    process.kill(targetPid, 'SIGKILL');
  } catch { /* ignore */ }
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
    for (let i = ordered.length - 1; i >= 0; i--) {
      const targetPid = ordered[i];
      if (targetPid !== undefined) killPidHard(targetPid);
    }
  } catch { /* ignore fallback errors */ }
}

const WSL_UUID_ARG = /^AGENT_EXEC_WSL_UUID=[0-9a-f-]+$/i;

function killWslProcessGroup(spawnargs: readonly string[]): void {
  const uuidArg = spawnargs.find((arg) => arg.startsWith('AGENT_EXEC_WSL_UUID='));
  if (uuidArg === undefined || !WSL_UUID_ARG.test(uuidArg)) return;
  try {
    const killScript = `pids=$(grep -l -z '${uuidArg}' /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); if [ -n "$pids" ]; then for pid in $pids; do kill -9 -$pid 2>/dev/null || kill -9 $pid 2>/dev/null; done; fi`;
    spawnSync('wsl.exe', ['-u', 'root', '-e', 'sh', '-c', killScript], { stdio: 'ignore', timeout: 10000, windowsHide: true });
  } catch { /* ignore */ }
}

function taskkillTree(pid: number): boolean {
  let taskkillSuccess = false;
  for (let attempt = 0; attempt < 2 && !taskkillSuccess; attempt++) {
    try {
      const result = spawnSync('taskkill.exe', ['/pid', pid.toString(), '/t', '/f'], {
        shell: false,
        timeout: 10000,
        stdio: 'ignore',
        windowsHide: true,
      });
      if (!result.error && result.status === 0) taskkillSuccess = true;
      else if (!isPidStillRunning(pid)) break;
    } catch { /* ignore */ }
  }
  return taskkillSuccess;
}

function killWindowsTree(child: ChildProcess, pid: number, parentGone: boolean): void {
  const spawnfile = child.spawnfile || '';
  const spawnargs: string[] = child.spawnargs || [];
  if (spawnfile.toLowerCase().endsWith('wsl.exe')) killWslProcessGroup(spawnargs);
  if (parentGone || !taskkillTree(pid)) killWindowsDescendantsFallback(pid);
  try {
    child.kill('SIGKILL');
  } catch { /* ignore */ }
}

function killUnixTree(child: ChildProcess, pid: number, force = true): void {
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  let killedGroup = false;
  try {
    process.kill(-pid, signal);
    killedGroup = true;
  } catch {
    // Fallback to direct pid when process is not a process group leader
  }
  if (!killedGroup) {
    try {
      process.kill(pid, signal);
    } catch { /* ignore */ }
  }
  if (force) {
    try {
      child.kill('SIGKILL');
    } catch { /* ignore */ }
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch { /* ignore */ }
    try {
      child.kill('SIGKILL');
    } catch { /* ignore */ }
  }, 5000).unref();
}

export function killProcessTree(child: ChildProcess, force = true): void {
  if (!child.pid) return;
  const pid = child.pid;
  const parentGone = child.killed || child.exitCode !== null || child.signalCode !== null;
  for (const hook of processManagerHooks) {
    if (hook.onKill) {
      try { hook.onKill(pid); } catch { /* ignore */ }
    }
  }
  if (process.platform === 'win32') killWindowsTree(child, pid, parentGone);
  else killUnixTree(child, pid, force);
}
