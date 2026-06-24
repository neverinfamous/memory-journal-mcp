// @ts-nocheck
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { IOController } from './io-controller.js';
import { killProcessTree } from './process-manager.js';
import { ExecPayload } from './schema.js';

export class ProcessController {
  private child!: ChildProcess;
  private ioController!: IOController;
  
  private isFinished = false;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private forceKillTimer: NodeJS.Timeout | null = null;
  private cleanupProcessHandlers: (() => void)[] = [];

  constructor(
    private payload: ExecPayload,
    private cwd: string,
    private cmd: string,
    private args: string[],
    private env: Record<string, string | undefined>,
    private tempScriptPath: string | null
  ) {}

  public start() {
    try {
      this.spawnChild();
      this.setupIOController();
      this.setupEventHandlers();
      this.setupTimeouts();
    } catch (err) {
      this.cleanupTempScript();
      if (err instanceof Error && ('code' in err || ('syscall' in err && (err as NodeJS.ErrnoException).syscall === 'uv_spawn'))) {
        this.onChildError(err as NodeJS.ErrnoException);
        return;
      }
      console.error(`❌ Unexpected error during spawn setup:`, err);
      process.exit(1);
    }
  }

  private spawnChild() {
    const isCmd = path.basename(this.cmd).toLowerCase() === 'cmd.exe' || path.basename(this.cmd).toLowerCase() === 'cmd';
    this.child = spawn(this.cmd, this.args, { 
      cwd: this.cwd, 
      env: this.env, 
      stdio: ['pipe', 'pipe', 'pipe'], 
      shell: false, 
      detached: process.platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: isCmd
    });
  }

  private setupIOController() {
    this.ioController = new IOController(
      this.child, 
      this.payload, 
      (reason) => this.handleStall(reason),
      (reason) => this.handleMaxBuffer(reason)
    );
    this.ioController.setupStreams();
  }

  private cleanupTempScript() {
    if (this.tempScriptPath && fs.existsSync(this.tempScriptPath)) {
      try { fs.unlinkSync(this.tempScriptPath); } catch { /* ignore */ }
    }
  }

  private handleStall(reason: string) {
    console.error(`\n❌ ${reason} Forcing termination...`);
    this.ioController.destroyStreams();
    killProcessTree(this.child);
    this.handleFinish(1, null, false);
  }

  private handleMaxBuffer(reason: string) {
    console.error(`\n❌ ${reason}`);
    this.ioController.destroyStreams();
    killProcessTree(this.child);
    this.handleFinish(1, null, false);
  }

  private setupEventHandlers() {
    const onExit = () => {
      this.cleanupTempScript();
      if (!this.isFinished) killProcessTree(this.child);
    };
    process.on('exit', onExit);
    this.cleanupProcessHandlers.push(() => process.off('exit', onExit));

    const onUncaughtException = (err: Error) => {
      console.error(`❌ Uncaught Exception in agent-exec:`, err);
      this.cleanupTempScript();
      this.ioController.closeFileStreams().then(() => {
        killProcessTree(this.child);
        process.exit(1);
      });
    };
    process.on('uncaughtException', onUncaughtException);
    this.cleanupProcessHandlers.push(() => process.off('uncaughtException', onUncaughtException));

    const onUnhandledRejection = (reason: unknown) => {
      console.error(`❌ Unhandled Rejection in agent-exec:`, reason);
      this.cleanupTempScript();
      this.ioController.closeFileStreams().then(() => {
        killProcessTree(this.child);
        process.exit(1);
      });
    };
    process.on('unhandledRejection', onUnhandledRejection);
    this.cleanupProcessHandlers.push(() => process.off('unhandledRejection', onUnhandledRejection));

    const handleSignal = (signal: string) => {
      console.error(`\n⚠️ Received ${signal}, terminating process tree...`);
      killProcessTree(this.child);
      this.ioController.destroyStreams();
      this.handleFinish(null, signal as NodeJS.Signals, false);
    };

    const onSigInt = () => handleSignal('SIGINT');
    process.on('SIGINT', onSigInt);
    this.cleanupProcessHandlers.push(() => process.off('SIGINT', onSigInt));

    const onSigTerm = () => handleSignal('SIGTERM');
    process.on('SIGTERM', onSigTerm);
    this.cleanupProcessHandlers.push(() => process.off('SIGTERM', onSigTerm));

    this.child.on('exit', (code, signal) => this.onChildExit(code, signal));
    this.child.on('close', (code, signal) => this.handleFinish(code, signal, false));
    this.child.on('error', (error) => this.onChildError(error));
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null) {
    let lastDataTime = Date.now();
    const updateDataTime = () => { lastDataTime = Date.now(); };
    if (this.child.stdout) this.child.stdout.on('data', updateDataTime);
    if (this.child.stderr) this.child.stderr.on('data', updateDataTime);

    const exitTime = Date.now();
    const checkStreams = setInterval(() => {
      if (this.isFinished) {
        clearInterval(checkStreams);
        return;
      }
      const timeSinceData = Date.now() - lastDataTime;
      const timeSinceExit = Date.now() - exitTime;

      if (timeSinceData > 500 || timeSinceExit > 2000) {
        if (timeSinceData <= 500) {
          console.error(`\n⚠️ Main process exited, but stdio streams are still actively receiving data from a daemon. Forcing severing of streams...`);
        } else {
          console.error(`\n⚠️ Main process exited, but stdio streams remain open and idle (daemon detected). Severing streams to allow exit...`);
        }
        this.ioController.destroyStreams();
        if (code !== 0) {
           console.error(`\n❌ Process exited with error code ${code}, but left daemons running. Killing process tree...`);
           killProcessTree(this.child);
        }
        this.handleFinish(code, signal, true);
        clearInterval(checkStreams);
      }
    }, 100);
    checkStreams.unref();
  }

  private onChildError(error: NodeJS.ErrnoException) {
    this.isFinished = true;
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.forceKillTimer) clearTimeout(this.forceKillTimer);
    this.cleanupTempScript();

    const handleError = () => {
      console.error(`❌ Execution Error: ${error.message}`);
      if (error.code === 'ENOENT' || error.code === 'EUNKNOWN' || (error as NodeJS.ErrnoException).syscall === 'uv_spawn') {
         console.error(`   Executable '${this.cmd}' was not found in PATH or working directory.`);
         if (process.platform === 'win32') {
             const builtIns = ['dir', 'echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
             if (builtIns.includes(this.cmd.toLowerCase())) {
                 console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
             }
             if (this.cmd === 'npm' || this.cmd === 'npx' || this.cmd === 'tsc') {
                 console.error(`\n   💡 AGENT HINT: On Windows, '${this.cmd}' is usually a .cmd or .ps1 script, not an .exe.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
                 console.error(`   You may need to specify the extension (e.g. '${this.cmd}.cmd') or run it via 'pwsh.exe'.`);
             }
         }
         if (process.platform === 'win32' && this.cwd && this.cwd.length >= 260) {
             console.error(`\n   💡 AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit (260 characters).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
             console.error(`   This causes libuv to fail to spawn the process with an ENOENT error.`);
         }
         if (this.cmd.includes('-') && /^[A-Z][a-z]+-[A-Z][a-zA-Z]+$/.test(this.cmd)) {
           console.error(`\n   💡 AGENT HINT: '${this.cmd}' appears to be a PowerShell cmdlet (e.g. Get-Item, Write-Host).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
           console.error(`   You cannot execute cmdlets directly as files. Please wrap them using: {"command": "pwsh", "args": ["-c", "${this.cmd}"]}`);
         } else if (this.cmd.toLowerCase().endsWith('.sh') || this.cmd.toLowerCase().endsWith('.ps1') || this.cmd.toLowerCase().endsWith('.bat') || this.cmd.toLowerCase().endsWith('.cmd')) {
           console.error(`\n   💡 AGENT HINT: You attempted to run a script file ('${this.cmd}') as a direct command.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
           console.error(`   Please use the {"type": "script", "scriptPath": "${this.cmd}"} payload type instead.`);
         } else if (this.cmd.includes(' ')) {
           const parts = this.cmd.split(' ');
           const rootCmd = parts[0];
           const errArgs = parts.slice(1).map((s: string) => `"${s}"`).join(', ');
           console.error(`\n   💡 AGENT HINT: Your command contains spaces. Because shell: false is used,\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
           console.error(`   you MUST pass arguments in the 'args' array, not in the 'command' string.`);
           console.error(`   ❌ BAD: {"command": "${this.cmd}"}`);
           console.error(`   ✅ GOOD: {"command": "${rootCmd}", "args": [${errArgs}]}`);
         }
      }
      process.exit(1);
    };

    if (this.ioController) {
      this.ioController.closeFileStreams().then(handleError);
    } else {
      handleError();
    }
  }

  private setupTimeouts() {
    const timeoutMs = this.payload.timeoutMs ?? 15 * 60 * 1000;
    if (timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        console.error(`\n❌ Execution timed out after ${timeoutMs}ms. Attempting graceful shutdown...`);
        console.error(`   💡 AGENT HINT: If you intended to start a long-running process (like a dev server), you must send it to the background by configuring your tool payload (e.g., using 'WaitMsBeforeAsync') AND set 'timeoutMs' to a large value (e.g. 86400000) in the JSON payload.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        try {
          if (this.child.pid) {
            if (process.platform === 'win32') {
              this.child.kill('SIGINT');
            } else {
              process.kill(-this.child.pid, 'SIGTERM');
            }
          }
        } catch { /* ignore */ }
        
        this.forceKillTimer = setTimeout(() => {
          if (!this.isFinished) {
             console.error(`❌ Process did not exit gracefully. Force killing process tree...`);
             killProcessTree(this.child);
             this.ioController.destroyStreams();
             this.handleFinish(null, 'SIGKILL' as NodeJS.Signals, false);
             setTimeout(() => {
               console.error(`❌ Ultimate fallback: Process exit forced.`);
               process.exit(1);
             }, 5000).unref();
          }
        }, 2000);
      }, timeoutMs);
    }
  }

  private handleFinish(code: number | null, signal: NodeJS.Signals | null, isDaemon: boolean) {
    if (this.isFinished) return;
    this.isFinished = true;

    for (const cleanup of this.cleanupProcessHandlers) {
      cleanup();
    }
    this.cleanupProcessHandlers = [];

    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.forceKillTimer) clearTimeout(this.forceKillTimer);
    
    this.cleanupTempScript();
    this.ioController.flushAll();

    this.ioController.closeFileStreams().then(async () => {
      if (code !== 0) {
        if (this.payload.onFailure) {
          const headers = { 'Content-Type': 'application/json', ...(this.payload.webhookHeaders || {}) };
          const replaceCtx = (str: string) => {
            if (!('integrationContext' in this.payload) || !this.payload.integrationContext) return str;
            return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
              if (!pathStr) return JSON.stringify(this.payload.integrationContext);
              let current: unknown = this.payload.integrationContext;
              const keys = pathStr.split('.');
              for (const key of keys) {
                if (current == null || typeof current !== 'object') return match;
                current = (current as Record<string, unknown>)[key];
              }
              return typeof current === 'object' ? JSON.stringify(current) : (typeof current === 'string' ? JSON.stringify(current).slice(1, -1) : String(current));
            });
          };

          let body: string;
          if ('webhookPayloadTemplate' in this.payload && this.payload.webhookPayloadTemplate) {
            body = replaceCtx(this.payload.webhookPayloadTemplate);
            body = body.replace(/\{\{stdout\}\}/g, () => JSON.stringify(this.ioController.stdoutTail).slice(1, -1))
              .replace(/\{\{stderr\}\}/g, () => JSON.stringify(this.ioController.stderrTail).slice(1, -1))
              .replace(/\{\{code\}\}/g, String(code))
              .replace(/\{\{signal\}\}/g, String(signal));
          } else {
            body = JSON.stringify({ code, signal, stdout: this.ioController.stdoutTail, stderr: this.ioController.stderrTail });
            body = replaceCtx(body);
          }
          
          const targetUrl = replaceCtx(this.payload.onFailure);
          const method = this.payload.webhookMethod || 'POST';
          const timeoutMs = this.payload.webhookTimeoutMs || 5000;

          try { await fetch(targetUrl, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) }).catch((err) => { console.error(`❌ Webhook Error: Failed to invoke onFailure webhook: ${err.message}`); }); } catch (err) { console.error(`❌ Webhook Error: ${err instanceof Error ? err.message : String(err)}`); }
        }
        if (code === null && signal) {
          console.error(`\n❌ Command was terminated by signal ${signal}`);
          process.exit(1);
        } else if (code !== null) {
          const baseCmd = path.basename(this.cmd).toLowerCase();
          const isGrepNoMatch = code === 1 && ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe'].includes(baseCmd);
          const isDiffFound = code === 1 && ['diff', 'diff.exe', 'cmp', 'cmp.exe'].includes(baseCmd);
          
          let isOutdatedInfo = false;
          if (code === 1 && this.payload.type === 'command') {
             const origCmd = path.basename(this.payload.command).toLowerCase();
             if (['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.cmd', 'bun.exe'].includes(origCmd)) {
                 const origArgs = this.payload.args || [];
                 if (origArgs.includes('outdated')) {
                     isOutdatedInfo = true;
                 }
             }
          }
          
          if (isGrepNoMatch) {
            console.error(`\nℹ️  No matches found (exit code 1).`);
            process.exit(0);
          } else if (isDiffFound) {
            console.error(`\nℹ️  Differences found (exit code 1).`);
            process.exit(0);
          } else if (isOutdatedInfo) {
            console.error(`\nℹ️  Outdated packages found (exit code 1).`);
            process.exit(0);
          } else {
            console.error(`\n❌ Command exited with code ${code}`);
            if (process.platform === 'win32') {
                const builtIns = ['dir', 'echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
                if (builtIns.includes(this.cmd.toLowerCase())) {
                    console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
                }
            }
            process.exit(code);
          }
        }
      }

      console.error(`\n✅ Command succeeded${isDaemon ? ' (background process detached)' : ''}.`);
      if (this.payload.onSuccess) {
        const headers = { 'Content-Type': 'application/json', ...(this.payload.webhookHeaders || {}) };
        
        const replaceCtx = (str: string) => {
          if (!('integrationContext' in this.payload) || !this.payload.integrationContext) return str;
          return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
            if (!pathStr) return JSON.stringify(this.payload.integrationContext);
            let current: unknown = this.payload.integrationContext;
            const keys = pathStr.split('.');
            for (const key of keys) {
              if (current == null || typeof current !== 'object') return match;
              current = (current as Record<string, unknown>)[key];
            }
            return typeof current === 'object' ? JSON.stringify(current) : (typeof current === 'string' ? JSON.stringify(current).slice(1, -1) : String(current));
          });
        };

        let body: string;
        if ('webhookPayloadTemplate' in this.payload && this.payload.webhookPayloadTemplate) {
          body = replaceCtx(this.payload.webhookPayloadTemplate);
          body = body.replace(/\{\{stdout\}\}/g, () => JSON.stringify(this.ioController.stdoutTail).slice(1, -1))
            .replace(/\{\{stderr\}\}/g, () => JSON.stringify(this.ioController.stderrTail).slice(1, -1))
            .replace(/\{\{success\}\}/g, 'true');
        } else {
          body = JSON.stringify({ success: true, stdout: this.ioController.stdoutTail, stderr: this.ioController.stderrTail });
          body = replaceCtx(body);
        }
        
        const targetUrl = replaceCtx(this.payload.onSuccess);
        const method = this.payload.webhookMethod || 'POST';
        const timeoutMs = this.payload.webhookTimeoutMs || 5000;

        try { await fetch(targetUrl, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) }).catch((err) => { console.error(`❌ Webhook Error: Failed to invoke onSuccess webhook: ${err.message}`); }); } catch (err) { console.error(`❌ Webhook Error: ${err instanceof Error ? err.message : String(err)}`); }
      }
      process.exit(0);
    });
  }
}
