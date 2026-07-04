import { ChildProcess, spawnSync } from 'node:child_process';
import { match } from 'ts-pattern';

export const processManagerHooks: { onKill?: (pid: number) => void }[] = [];

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
      if (uuidArg) {
        try {
          const killScript = `pids=$(grep -l -z '${uuidArg}' /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); if [ -n "$pids" ]; then for pid in $pids; do kill -9 -$pid 2>/dev/null || kill -9 $pid 2>/dev/null; done; fi`;
          spawnSync('wsl.exe', ['-u', 'root', '-e', 'sh', '-c', killScript], { stdio: 'ignore' });
        } catch { /* ignore */ }
      }
    }

    let taskkillSuccess = false;
    try {
      const result = spawnSync('taskkill.exe', ['/pid', pid.toString(), '/t', '/f'], { shell: false, timeout: 2000, stdio: 'ignore' });
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
          const queue = [pid];
          while (queue.length > 0) {
            const current = queue.shift()!;
            toKill.add(current);
            const children = parentMap.get(current);
            if (children) queue.push(...children);
          }
          
          for (const processPid of toKill) {
            if (processPid === pid) continue;
            try { process.kill(processPid, 'SIGKILL'); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore fallback errors */ }
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
