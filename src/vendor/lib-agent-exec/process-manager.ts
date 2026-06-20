// @ts-nocheck
import { ChildProcess, spawnSync } from 'node:child_process';

export function killProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  
  if (process.platform === 'win32') {
    try {
      const result = spawnSync('taskkill.exe', ['/pid', child.pid.toString(), '/t', '/f'], { shell: false, timeout: 2000, stdio: 'ignore' });
      if (result.error || result.status !== 0) {
        // Fallback to powershell CIM instance if taskkill fails or isn't available
        try {
          spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${child.pid} -or $_.ParentProcessId -eq ${child.pid} } | Invoke-CimMethod -MethodName Terminate`], { shell: false, timeout: 2000, stdio: 'ignore' });
        } catch { /* ignore fallback errors */ }
        throw result.error || new Error('taskkill returned non-zero');
      }
    } catch {
      try {
         child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
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
      }, 50).unref();
    } catch {
      // Fallback if process group killing fails
      try {
         child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
  }
}
