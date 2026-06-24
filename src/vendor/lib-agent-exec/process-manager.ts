// @ts-nocheck
import { ChildProcess, spawnSync } from 'node:child_process';

export const processManagerHooks: { onKill?: (pid: number) => void }[] = [];

export function killProcessTree(child: ChildProcess) {
  if (!child.pid || child.killed || child.exitCode !== null || child.signalCode !== null) return;

  
  for (const hook of processManagerHooks) {
    if (hook.onKill) {
      try { hook.onKill(child.pid); } catch { /* ignore */ }
    }
  }
  
  if (process.platform === 'win32') {
    const childWithArgs = child as unknown as { spawnfile?: string, spawnargs?: string[] };
    const spawnfile = childWithArgs.spawnfile || '';
    const spawnargs = childWithArgs.spawnargs || [];
    if (spawnfile.toLowerCase().endsWith('wsl.exe')) {
      const uuidArg = spawnargs.find((a: string) => a.startsWith('AGENT_EXEC_WSL_UUID='));
      if (uuidArg) {
        try {
          const killScript = `pids=$(grep -l -z '${uuidArg}' /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); if [ -n "$pids" ]; then for pid in $pids; do kill -9 -$pid 2>/dev/null || kill -9 $pid 2>/dev/null; done; fi`;
          spawnSync('wsl.exe', ['-u', 'root', '-e', 'sh', '-c', killScript], { stdio: 'ignore' });
        } catch { /* ignore */ }
      }
    }

    let taskkillSuccess = false;
    try {
      const result = spawnSync('taskkill.exe', ['/pid', child.pid.toString(), '/t', '/f'], { shell: false, timeout: 2000, stdio: 'ignore' });
      if (!result.error && result.status === 0) {
        taskkillSuccess = true;
      }
    } catch { /* ignore */ }

    if (!taskkillSuccess) {
      try {
        const wmic = spawnSync('wmic', ['process', 'get', 'processid,parentprocessid', '/format:csv'], { encoding: 'utf8' });
        if (!wmic.error && wmic.stdout) {
          const lines = wmic.stdout.split('\n');
          const parentMap = new Map<number, number[]>();
          for (const line of lines) {
            const parts = line.trim().split(',');
            if (parts.length >= 3) {
              const ppid = parseInt(parts[parts.length - 2], 10);
              const pid = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(ppid) && !isNaN(pid)) {
                if (!parentMap.has(ppid)) parentMap.set(ppid, []);
                parentMap.get(ppid)!.push(pid);
              }
            }
          }
          
          const toKill = new Set<number>();
          const queue = [child.pid];
          while (queue.length > 0) {
            const current = queue.shift()!;
            toKill.add(current);
            const children = parentMap.get(current);
            if (children) queue.push(...children);
          }
          
          for (const pid of toKill) {
            if (pid === child.pid) continue;
            try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore fallback errors */ }
    }

    try {
       child.kill('SIGKILL');
    } catch { /* ignore */ }
  } else {
    try {
      // Graceful degradation: Attempt SIGTERM first to allow daemons to clean up
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch { /* ignore */ }
      
      // Fallback to SIGKILL process group on Unix to prevent zombies after a brief delay
      setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch { /* ignore */ }
      }, 5000).unref();
    } catch {
      // Fallback if process group killing fails
      try {
         child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
  }
}
