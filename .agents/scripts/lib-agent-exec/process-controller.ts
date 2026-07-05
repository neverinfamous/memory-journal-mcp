import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { IOController } from './io-controller.js';
import { killProcessTree } from './process-manager.js';
import { ExecPayload } from './schema.js';
import { sendWebhook, BUILT_INS, AUTONOMOUS_HEALING_MSG } from './utils.js';

const TIMEOUT_EXIT_FORCE_MS = 5000;
const STREAM_DAEMON_CHECK_MS = 100;
const DAEMON_DATA_STALL_MS = 500;
const DAEMON_EXIT_STALL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 2000;

function isErrnoException(e: Error): e is NodeJS.ErrnoException {
  return 'code' in e || 'syscall' in e;
}

function analyzeExitCode1(payload: ExecPayload, code: number, stdout: string, stderr: string): { isGrepNoMatch: boolean, isDiffFound: boolean, isOutdatedInfo: boolean } {
  let isGrepNoMatch = false;
  let isDiffFound = false;
  let isOutdatedInfo = false;
  
  if (code === 1) {
    let scriptContent = '';
    
    if (payload.type === 'command') {
      const origCmd = path.basename(payload.command).toLowerCase();
      const isWrapper = ['wsl', 'wsl.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'cmd', 'cmd.exe', 'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(origCmd);
      const allArgsStr = payload.args ? payload.args.join(' ').toLowerCase() : '';
      const commandBoundaryRegex = /(?:^|[|;&\n]\s*|\b(?:time|xargs|sudo|nohup|wsl)\s+|(?:^|\s)(?:-c|\/c|-command)\s+)(?:[a-zA-Z0-9_\-/.]*\/)?/;
      
      if (['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe'].includes(origCmd)) {
          isGrepNoMatch = true;
      } else if (isWrapper && new RegExp(commandBoundaryRegex.source + '(grep|egrep|fgrep|rg)\\b').test(allArgsStr)) {
          isGrepNoMatch = true;
      }

      if (['diff', 'diff.exe', 'cmp', 'cmp.exe'].includes(origCmd)) {
          isDiffFound = true;
      } else if (isWrapper && new RegExp(commandBoundaryRegex.source + '(diff|cmp)\\b').test(allArgsStr)) {
          isDiffFound = true;
      }

      if (['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.cmd', 'bun.exe'].includes(origCmd)) {
          const origArgs = payload.args || [];
          const firstNonFlag = origArgs.find(a => !a.startsWith('-'));
          if (firstNonFlag && firstNonFlag.toLowerCase() === 'outdated') {
              isOutdatedInfo = true;
          }
      } else if (isWrapper && new RegExp(commandBoundaryRegex.source + '(npm|pnpm|yarn|bun)\\s+(?:--?\\w+\\s+)*outdated\\b').test(allArgsStr)) {
          isOutdatedInfo = true;
      } else if (['git', 'git.exe'].includes(origCmd)) {
          const origArgs = payload.args || [];
          const diffIndex = origArgs.indexOf('diff');
          if (diffIndex === 0 || (diffIndex === 1 && origArgs[0].startsWith('-'))) {
              isDiffFound = true;
          }
      }
    } else if (payload.type === 'eval') {
      scriptContent = payload.code.toLowerCase();
    } else if (payload.type === 'script') {
      if (payload.scriptPath && fs.existsSync(payload.scriptPath)) {
        try {
          scriptContent = fs.readFileSync(payload.scriptPath, 'utf8').toLowerCase();
        } catch { /* ignore */ }
      }
    }

    if (scriptContent) {
      const commandBoundaryRegex = /(?:^|[|;&\n]\s*|\b(?:time|xargs|sudo|nohup|wsl)\s+)(?:[a-zA-Z0-9_\-/.]*\/)?/;
      
      if (new RegExp(commandBoundaryRegex.source + '(grep|egrep|fgrep|rg)\\b').test(scriptContent)) {
        isGrepNoMatch = true;
      }
      if (new RegExp(commandBoundaryRegex.source + '(diff|cmp)\\b').test(scriptContent)) {
        isDiffFound = true;
      }
      if (new RegExp(commandBoundaryRegex.source + '(npm|pnpm|yarn|bun)\\s+(?:--?\\w+\\s+)*outdated\\b').test(scriptContent)) {
        isOutdatedInfo = true;
      }
    }
  }

  // Refine heuristic by analyzing stderr to prevent swallowing true faults (like package installation errors)
  if (isOutdatedInfo && (stderr.includes('ERR_PNPM') || stderr.includes('npm ERR!') || stderr.includes('error:') || stderr.includes('Error:'))) {
    isOutdatedInfo = false;
  }
  if (isGrepNoMatch && (stderr.includes('No such file or directory') || stderr.includes('grep:'))) {
    isGrepNoMatch = false;
  }
  if (isDiffFound && (stderr.includes('No such file or directory') || stderr.includes('diff:'))) {
    isDiffFound = false;
  }

  return { isGrepNoMatch, isDiffFound, isOutdatedInfo };
}

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
    private tempScriptPath: string | null,
    private isJson: boolean = false
  ) {}

  public start() {
    try {
      this.spawnChild();
      this.setupIOController();
      this.setupEventHandlers();
      this.setupTimeouts();
    } catch (err) {
      this.cleanupTempScript();
      if (err instanceof Error) {
        if (isErrnoException(err) && (err.code || err.syscall === 'uv_spawn')) {
          this.onChildError(err);
          return;
        }
      }
      if (!this.isJson) console.error(`❌ Unexpected error during spawn setup:`, err);
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
      this.cwd,
      (reason) => this.handleStall(reason),
      (reason) => this.handleMaxBuffer(reason),
      this.isJson
    );
    this.ioController.setupStreams();
  }

  private cleanupTempScript() {
    if (this.tempScriptPath && fs.existsSync(this.tempScriptPath)) {
      try { fs.unlinkSync(this.tempScriptPath); } catch { /* ignore */ }
    }
  }

  private handleStall(reason: string) { console.error(`\n❌ ${reason} Forcing termination...`);
    this.ioController.destroyStreams();
    killProcessTree(this.child);
    this.handleFinish(1, null, false);
  }

  private handleMaxBuffer(reason: string) { if (!this.isJson) console.error(`\n❌ ${reason}`);
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

    const onUncaughtException = (err: Error) => { if (!this.isJson) console.error(`❌ Uncaught Exception in agent-exec:`, err);
      this.cleanupTempScript();
      this.ioController.closeFileStreams().then(() => {
        killProcessTree(this.child);
        process.exit(1);
      });
    };
    process.on('uncaughtException', onUncaughtException);
    this.cleanupProcessHandlers.push(() => process.off('uncaughtException', onUncaughtException));

    const onUnhandledRejection = (reason: unknown) => { if (!this.isJson) console.error(`❌ Unhandled Rejection in agent-exec:`, reason);
      this.cleanupTempScript();
      this.ioController.closeFileStreams().then(() => {
        killProcessTree(this.child);
        process.exit(1);
      });
    };
    process.on('unhandledRejection', onUnhandledRejection);
    this.cleanupProcessHandlers.push(() => process.off('unhandledRejection', onUnhandledRejection));

    const handleSignal = (signal: NodeJS.Signals) => { if (!this.isJson) console.error(`\n⚠️ Received ${signal}, terminating process tree...`);
      killProcessTree(this.child);
      this.ioController.destroyStreams();
      this.handleFinish(null, signal, false);
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

      if (timeSinceData > DAEMON_DATA_STALL_MS || timeSinceExit > DAEMON_EXIT_STALL_MS) {
        if (timeSinceData <= DAEMON_DATA_STALL_MS) { if (!this.isJson) console.error(`\n⚠️ Main process exited, but stdio streams are still actively receiving data from a daemon. Forcing severing of streams...`);
        } else { if (!this.isJson) console.error(`\n⚠️ Main process exited, but stdio streams remain open and idle (daemon detected). Severing streams to allow exit...`);
        }
        this.ioController.destroyStreams();
        if (code !== 0) { if (!this.isJson) console.error(`\n❌ Process exited with error code ${code}, but left daemons running. Killing process tree...`);
           killProcessTree(this.child);
        }
        this.handleFinish(code, signal, true);
        clearInterval(checkStreams);
      }
    }, STREAM_DAEMON_CHECK_MS);
    checkStreams.unref();
  }

  private onChildError(error: unknown) {
    this.isFinished = true;
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.forceKillTimer) clearTimeout(this.forceKillTimer);
    this.cleanupTempScript();

    const handleError = () => {
      const msg = error instanceof Error ? error.message : String(error);
      const errCode = error instanceof Error && isErrnoException(error) && error.code ? String(error.code) : undefined;
      const errSyscall = error instanceof Error && isErrnoException(error) && error.syscall ? String(error.syscall) : undefined; if (!this.isJson) console.error(`❌ Execution Error: ${msg}`);
      if (errCode === 'ENOENT' || errCode === 'EUNKNOWN' || errSyscall === 'uv_spawn') { if (!this.isJson) console.error(`   Executable '${this.cmd}' was not found in PATH or working directory.`);
         if (process.platform === 'win32') {
             if (BUILT_INS.includes(this.cmd.toLowerCase())) { if (!this.isJson) console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n${AUTONOMOUS_HEALING_MSG}`);
             }
             if (this.cmd === 'npm' || this.cmd === 'npx' || this.cmd === 'tsc') { if (!this.isJson) console.error(`\n   💡 AGENT HINT: On Windows, '${this.cmd}' is usually a .cmd or .ps1 script, not an .exe.\n${AUTONOMOUS_HEALING_MSG}`); if (!this.isJson) console.error(`   You may need to specify the extension (e.g. '${this.cmd}.cmd') or run it via 'pwsh.exe'.`);
             }
         }
         if (process.platform === 'win32' && this.cwd && this.cwd.length >= 260) { if (!this.isJson) console.error(`\n   💡 AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit (260 characters).\n${AUTONOMOUS_HEALING_MSG}`); if (!this.isJson) console.error(`   This causes libuv to fail to spawn the process with an ENOENT error.`);
         }
         if (this.cmd.includes('-') && /^[A-Z][a-z]+-[A-Z][a-zA-Z]+$/.test(this.cmd)) { if (!this.isJson) console.error(`\n   💡 AGENT HINT: '${this.cmd}' appears to be a PowerShell cmdlet (e.g. Get-Item, Write-Host).\n${AUTONOMOUS_HEALING_MSG}`); if (!this.isJson) console.error(`   You cannot execute cmdlets directly as files. Please wrap them using: {"command": "pwsh", "args": ["-c", "${this.cmd}"]}`);
         } else if (this.cmd.toLowerCase().endsWith('.sh') || this.cmd.toLowerCase().endsWith('.ps1') || this.cmd.toLowerCase().endsWith('.bat') || this.cmd.toLowerCase().endsWith('.cmd')) { if (!this.isJson) console.error(`\n   💡 AGENT HINT: You attempted to run a script file ('${this.cmd}') as a direct command.\n${AUTONOMOUS_HEALING_MSG}`); if (!this.isJson) console.error(`   Please use the {"type": "script", "scriptPath": "${this.cmd}"} payload type instead.`);
         } else if (this.cmd.includes(' ')) {
           const parts = this.cmd.split(' ');
           const rootCmd = parts[0];
           const errArgs = parts.slice(1).map((s: string) => `"${s}"`).join(', '); if (!this.isJson) console.error(`\n   💡 AGENT HINT: Your command contains spaces. Because shell: false is used,\n${AUTONOMOUS_HEALING_MSG}`); if (!this.isJson) console.error(`   you MUST pass arguments in the 'args' array, not in the 'command' string.`); if (!this.isJson) console.error(`   ❌ BAD: {"command": "${this.cmd}"}`); if (!this.isJson) console.error(`   ✅ GOOD: {"command": "${rootCmd}", "args": [${errArgs}]}`);
         }
      }
      this.isFinished = false;
      this.handleFinish(1, null, false);
    };

    if (this.ioController) {
      this.ioController.closeFileStreams().then(handleError);
    } else {
      handleError();
    }
  }

  private setupTimeouts() {
    const timeoutMs = this.payload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => { 
        console.error(`\n❌ Execution timed out after ${timeoutMs}ms. Attempting graceful shutdown...`);
        console.error(`   💡 AGENT HINT: If you intended to start a long-running process (like a dev server), you must send it to the background by configuring your tool payload (e.g., using 'WaitMsBeforeAsync') AND set 'timeoutMs' to a large value (e.g. 86400000) in the JSON payload.\n${AUTONOMOUS_HEALING_MSG}`);
        try {
          if (this.child.pid) {
            if (process.platform === 'win32') {
              killProcessTree(this.child);
            } else {
              process.kill(-this.child.pid, 'SIGTERM');
            }
          }
        } catch { /* ignore */ }
        
        this.forceKillTimer = setTimeout(() => {
          if (!this.isFinished) { if (!this.isJson) console.error(`❌ Process did not exit gracefully. Force killing process tree...`);
             killProcessTree(this.child);
             this.ioController.destroyStreams();
             this.handleFinish(null, 'SIGKILL', false);
             setTimeout(() => { if (!this.isJson) console.error(`❌ Ultimate fallback: Process exit forced.`);
               process.exit(1);
             }, TIMEOUT_EXIT_FORCE_MS).unref();
          }
        }, FORCE_KILL_DELAY_MS);
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
    if (this.ioController) {
      this.ioController.flushAll();
    }

    const finalizeFinish = async () => {
      let computedCode = code;
      const envData = this.ioController && typeof this.ioController.getParsedEnvelope === 'function' ? this.ioController.getParsedEnvelope() : null;
      if (this.payload.expectJsonEnvelope && envData) {
         if (envData.status === 'error' || (envData.exit_code !== undefined && envData.exit_code !== 0)) {
             computedCode = typeof envData.exit_code === 'number' ? envData.exit_code : 1;
         } else if (envData.status === 'success') {
             computedCode = 0;
         }
      }
      code = computedCode;

      if (this.isJson) {
         const { isGrepNoMatch, isDiffFound, isOutdatedInfo } = (computedCode !== null && computedCode !== 0) ? analyzeExitCode1(this.payload, computedCode, this.ioController?.stdoutTail || '', this.ioController?.stderrTail || '') : { isGrepNoMatch: false, isDiffFound: false, isOutdatedInfo: false };
         const isGraceful = isGrepNoMatch || isDiffFound || isOutdatedInfo;
         const finalCode = isGraceful ? 0 : computedCode;

         if (this.payload.onFailure && finalCode !== 0) {
            await sendWebhook(this.payload, this.payload.onFailure, {
              stdout: this.ioController?.stdoutTail || '',
              stderr: this.ioController?.stderrTail || '',
              code: finalCode,
              signal,
              success: false,
              envData
            });
         }
         if (this.payload.onSuccess && finalCode === 0) {
            await sendWebhook(this.payload, this.payload.onSuccess, {
              stdout: this.ioController?.stdoutTail || '',
              stderr: this.ioController?.stderrTail || '',
              code: finalCode,
              signal,
              success: true,
              envData
            });
         }
         console.log(JSON.stringify({
           status: finalCode === 0 ? "success" : "error",
           code: finalCode,
           signal,
           stdout: this.ioController?.stdoutTail || '',
           stderr: this.ioController?.stderrTail || '',
           envData
         }));
         process.exit(finalCode === 0 ? 0 : (finalCode ?? 1));
      }

      if (code !== 0) {
        if (this.payload.onFailure) {
          await sendWebhook(this.payload, this.payload.onFailure, {
            stdout: this.ioController?.stdoutTail || '',
            stderr: this.ioController?.stderrTail || '',
            code,
            signal,
            success: false,
            envData
          });
        }
        if (code === null && signal) { if (!this.isJson) console.error(`\n❌ Command was terminated by signal ${signal}`);
          process.exit(1);
        } else if (code !== null) {
          const { isGrepNoMatch, isDiffFound, isOutdatedInfo } = analyzeExitCode1(this.payload, code, this.ioController?.stdoutTail || '', this.ioController?.stderrTail || '');
          
          if (isGrepNoMatch) { if (!this.isJson) console.error(`\nℹ️  No matches found (exit code 1).`);
            process.exit(0);
          } else if (isDiffFound) { if (!this.isJson) console.error(`\nℹ️  Differences found (exit code 1).`);
            process.exit(0);
          } else if (isOutdatedInfo) { if (!this.isJson) console.error(`\nℹ️  Outdated packages found (exit code 1).`);
            process.exit(0);
          } else {
            let suppressRedundantExit = false;
            if (this.payload.type === 'command' && typeof this.payload.command === 'string') {
                if (['pnpm', 'npm', 'bun', 'yarn', 'node'].includes(this.payload.command)) {
                    suppressRedundantExit = true;
                }
            }
            if (!this.isJson && !suppressRedundantExit) console.error(`\n❌ Command exited with code ${code}`);
            if (process.platform === 'win32') {
                if (BUILT_INS.includes(this.cmd.toLowerCase())) { if (!this.isJson) console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n${AUTONOMOUS_HEALING_MSG}`);
                }
            }
            process.exit(code);
          }
        }
      } if (!this.isJson) console.error(`\n✅ Command succeeded${isDaemon ? ' (background process detached)' : ''}.`);
      if (this.payload.onSuccess) {
        await sendWebhook(this.payload, this.payload.onSuccess, {
          stdout: this.ioController?.stdoutTail || '',
          stderr: this.ioController?.stderrTail || '',
          code: computedCode,
          signal,
          success: computedCode === 0,
          envData
        });
      }
      process.exit(0);
    };
    
    if (this.ioController) {
      return this.ioController.closeFileStreams().then(finalizeFinish);
    } else {
      return finalizeFinish();
    }
  }
}
