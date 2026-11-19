// @ts-nocheck
import { ChildProcess, spawnSync } from 'node:child_process';
import { match } from 'ts-pattern';

export const processManagerHooks: { onKill?: (pid: number) => void }[] = [];

function isPidStillRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      return (err as { code?: string }).code === 'EPERM';
    }
    return false;
  }
}

/**
 * [INTENT]: Enumerate Windows parent->children PID edges via CIM (`Win32_Process`) when `taskkill /T` fails
 * under concurrent WMI contention (`wmic.exe` is removed on Windows 11 24H2+).
 */
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
    if (ps.error || typeof ps.stdout !== 'string' || ps.stdout.length === 0) {
      return;
    }

    const parentMap = new Map<number, number[]>();
    for (const rawLine of ps.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      const commaIdx = line.indexOf(',');
      if (commaIdx === -1) continue;
      const ppid = parseInt(line.slice(0, commaIdx), 10);
      const childPid = parseInt(line.slice(commaIdx + 1), 10);
      if (!Number.isNaN(ppid) && !Number.isNaN(childPid) && childPid > 0) {
        const list = parentMap.get(ppid);
        if (list !== undefined) {
          list.push(childPid);
        } else {
          parentMap.set(ppid, [childPid]);
        }
      }
    }

    const ordered: number[] = [];
    const visited = new Set<number>([rootPid]);
    const queue: number[] = [rootPid];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const children = parentMap.get(current);
      if (children !== undefined) {
        for (const childPid of children) {
          if (!visited.has(childPid) && childPid !== process.pid) {
            visited.add(childPid);
            ordered.push(childPid);
            queue.push(childPid);
          }
        }
      }
    }

    // Terminate deepest descendants first, then intermediate parents
    for (let i = ordered.length - 1; i >= 0; i--) {
      const targetPid = ordered[i];
      if (targetPid === undefined) continue;
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
  } catch { /* ignore fallback errors */ }
}

export function killProcessTree(child: ChildProcess) {
  if (!child.pid || child.killed || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;

  for (const hook of processManagerHooks) {
    if (hook.onKill) {
      try { hook.onKill(pid); } catch { /* ignore */ }
    }
  }
  
  match(process.platform)
    .with('win32', () => {
    const spawnfile = child.spawnfile || '';
    const spawnargs: string[] = child.spawnargs || [];
    if (spawnfile.toLowerCase().endsWith('wsl.exe')) {
      const uuidArg = spawnargs.find((a: string) => a.startsWith('AGENT_EXEC_WSL_UUID='));
      if (uuidArg !== undefined) {
        try {
          const killScript = `pids=$(grep -l -z '${uuidArg}' /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); if [ -n "$pids" ]; then for pid in $pids; do kill -9 -$pid 2>/dev/null || kill -9 $pid 2>/dev/null; done; fi`;
          spawnSync('wsl.exe', ['-u', 'root', '-e', 'sh', '-c', killScript], { stdio: 'ignore', timeout: 10000, windowsHide: true });
        } catch { /* ignore */ }
      }
    }

    let taskkillSuccess = false;
    for (let attempt = 0; attempt < 2 && !taskkillSuccess; attempt++) {
      try {
        const result = spawnSync('taskkill.exe', ['/pid', pid.toString(), '/t', '/f'], {
          shell: false,
          timeout: 10000,
          stdio: 'ignore',
          windowsHide: true,
        });
        if (!result.error && (result.status === 0 || !isPidStillRunning(pid))) {
          taskkillSuccess = true;
        }
      } catch { /* ignore */ }
    }

    if (!taskkillSuccess) {
      killWindowsDescendantsFallback(pid);
    }

    try {
      child.kill('SIGKILL');
    } catch { /* ignore */ }
  })
  .otherwise(() => {
    try {
      // Graceful degradation: Attempt SIGTERM first to allow daemons to clean up
      try {
        process.kill(-pid, 'SIGTERM');
      } catch { /* ignore */ }
      
      // Fallback to SIGKILL process group on Unix to prevent zombies after a brief delay
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch { /* ignore */ }
      }, 5000).unref();
    } catch {
      // Fallback if process group killing fails
      try {
         child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
  });
}
