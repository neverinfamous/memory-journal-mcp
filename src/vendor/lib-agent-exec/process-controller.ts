// @ts-nocheck
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { IOController } from './io-controller.js';
import { killProcessTree } from './process-manager.js';
import { ExecPayload } from './schema.js';
import { sendWebhook, sendDatadogTelemetry, BUILT_INS, AUTONOMOUS_HEALING_MSG, setLastStderrTail } from './utils.js';
import { analyzeExitCode1, isGracefulExitAnalysis, type ExitCodeAnalysis } from './exit-code-policy.js';
export { analyzeExitCode1 };

const TIMEOUT_EXIT_FORCE_MS = 5000;
const STREAM_DAEMON_CHECK_MS = 100;
const DAEMON_DATA_STALL_MS = 500;
const DAEMON_EXIT_STALL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 2000;

function isErrnoException(e: Error): e is NodeJS.ErrnoException {
  return 'code' in e || 'syscall' in e;
}

export class ProcessController {
  private child?: ChildProcess;
  private ioController?: IOController;

  private isFinished = false;
  private timedOut = false;
  private abortedInternally = false;
  private hasRetriedWsl = false;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private forceKillTimer: NodeJS.Timeout | null = null;
  private daemonCheckInterval: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private cleanupProcessHandlers: (() => void)[] = [];

  constructor(
    private payload: ExecPayload,
    private cwd: string,
    private cmd: string,
    private args: string[],
    private env: Record<string, string | undefined>,
    private tempScriptPath: string | null,
    private isJson: boolean = false,
    private timeoutOverrideMs?: number
  ) {}

  public start() {
    try {
      this.spawnChild();
      this.setupIOController();
      this.setupEventHandlers();
      this.setupTimeouts();
    } catch (err) {
      if (this.child && !this.isFinished) killProcessTree(this.child);
      this.clearActiveTimersAndHandlers();
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
    const child = this.child;
    if (child === undefined) return;
    this.ioController = new IOController(
      child,
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

  private clearActiveTimersAndHandlers() {
    for (const cleanup of this.cleanupProcessHandlers) {
      cleanup();
    }
    this.cleanupProcessHandlers = [];
    if (this.timeoutTimer) { clearTimeout(this.timeoutTimer); this.timeoutTimer = null; }
    if (this.forceKillTimer) { clearTimeout(this.forceKillTimer); this.forceKillTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.daemonCheckInterval) { clearInterval(this.daemonCheckInterval); this.daemonCheckInterval = null; }
  }

  private handleStall(reason: string) {
    console.error(`\n❌ ${reason} Forcing termination...`);
    this.abortedInternally = true;
    this.ioController?.destroyStreams();
    if (this.child) killProcessTree(this.child);
    this.handleFinish(1, null, false);
  }

  private handleMaxBuffer(reason: string) {
    if (!this.isJson) console.error(`\n❌ ${reason}`);
    this.abortedInternally = true;
    this.ioController?.destroyStreams();
    if (this.child) killProcessTree(this.child);
    this.handleFinish(1, null, false);
  }

  private setupEventHandlers() {
    const child = this.child;
    if (child === undefined) return;

    const onExit = () => {
      this.cleanupTempScript();
      if (!this.isFinished && this.child) killProcessTree(this.child);
    };
    process.on('exit', onExit);
    this.cleanupProcessHandlers.push(() => process.off('exit', onExit));

    const crashShutdown = (label: string, err: unknown) => {
      if (this.isFinished) return;
      this.isFinished = true;
      this.abortedInternally = true;
      this.clearActiveTimersAndHandlers();
      if (!this.isJson) console.error(`❌ ${label}:`, err);
      if (typeof this.ioController?.flushAll === 'function') this.ioController.flushAll();
      if (typeof this.ioController?.destroyStreams === 'function') this.ioController.destroyStreams();
      if (this.child) killProcessTree(this.child);
      this.cleanupTempScript();
      const finish = () => {
        process.exit(1);
      };
      if (this.ioController) this.ioController.closeFileStreams().then(finish, finish);
      else finish();
    };
    const onUncaught = (err: Error) => crashShutdown('Uncaught Exception in agent-exec', err);
    const onUnhandled = (reason: unknown) => crashShutdown('Unhandled Rejection in agent-exec', reason);
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
    this.cleanupProcessHandlers.push(
      () => process.off('uncaughtException', onUncaught),
      () => process.off('unhandledRejection', onUnhandled),
    );

    const handleSignal = (signal: NodeJS.Signals) => {
      if (!this.isJson) console.error(`\n⚠️ Received ${signal}, terminating process tree...`);
      if (this.child) killProcessTree(this.child);
      this.ioController?.destroyStreams();
      this.handleFinish(null, signal, false);
    };
    const onSigint = () => handleSignal('SIGINT');
    const onSigterm = () => handleSignal('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    this.cleanupProcessHandlers.push(
      () => process.off('SIGINT', onSigint),
      () => process.off('SIGTERM', onSigterm),
    );

    child.on('exit', (code, signal) => this.onChildExit(code, signal));
    child.on('close', (code, signal) => this.handleFinish(code, signal, false));
    child.on('error', (error) => this.onChildError(error));
  }

  // [INTENT]: Resolves zombie processes where the main shell exits but leaves a background daemon holding stdout/stderr open.
  // [SIDE-EFFECT]: Forcibly destroys IO streams and kills the process tree if stalls exceed DAEMON_EXIT_STALL_MS.
  // [AGENT-HINT]: Do NOT decrease this timeout, or you will prematurely kill valid background compilation tasks.
  private onChildExit(code: number | null, signal: NodeJS.Signals | null) {
    if (this.daemonCheckInterval) {
      clearInterval(this.daemonCheckInterval);
      this.daemonCheckInterval = null;
    }
    const exitTime = Date.now();
    this.daemonCheckInterval = setInterval(() => {
      if (this.isFinished) {
        if (this.daemonCheckInterval) { clearInterval(this.daemonCheckInterval); this.daemonCheckInterval = null; }
        return;
      }
      const lastDataTime = this.ioController?.lastDataTime ?? exitTime;
      const timeSinceData = Date.now() - Math.max(lastDataTime, exitTime);
      const timeSinceExit = Date.now() - exitTime;

      if (timeSinceData <= DAEMON_DATA_STALL_MS && timeSinceExit <= DAEMON_EXIT_STALL_MS) return;

      if (!this.isJson) {
        const msg = timeSinceData <= DAEMON_DATA_STALL_MS
          ? '\n⚠️ Main process exited, but stdio streams are still actively receiving data from a daemon. Forcing severing of streams...'
          : '\n⚠️ Main process exited, but stdio streams remain open and idle (daemon detected). Severing streams to allow exit...';
        console.error(msg);
      }
      this.ioController?.destroyStreams();
      if (code !== 0) {
        if (!this.isJson) console.error(`\n❌ Process exited with error code ${code}, but left daemons running. Killing process tree...`);
        if (this.child) killProcessTree(this.child);
      }
      this.handleFinish(code, signal, true);
    }, STREAM_DAEMON_CHECK_MS);
    this.daemonCheckInterval.unref();
  }

  private printSpawnHints(errCode: string | undefined, errSyscall: string | undefined) {
    if (this.isJson || (errCode !== 'ENOENT' && errCode !== 'EUNKNOWN' && errSyscall !== 'uv_spawn')) return;
    console.error(`   Executable '${this.cmd}' was not found in PATH or working directory.`);
    if (process.platform === 'win32') {
      if (BUILT_INS.includes(this.cmd.toLowerCase())) {
        console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n${AUTONOMOUS_HEALING_MSG}`);
      }
      if (this.cmd === 'npm' || this.cmd === 'npx' || this.cmd === 'tsc') {
        console.error(`\n   💡 AGENT HINT: On Windows, '${this.cmd}' is usually a .cmd or .ps1 script, not an .exe.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   You may need to specify the extension (e.g. '${this.cmd}.cmd') or run it via 'pwsh.exe'.`);
      }
      if (this.cwd && this.cwd.length >= 260) {
        console.error(`\n   💡 AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit (260 characters).\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   This causes libuv to fail to spawn the process with an ENOENT error.`);
      }
    }
    if (this.cmd.includes('-') && /^[A-Z][a-z]+-[A-Z][a-zA-Z]+$/.test(this.cmd)) {
      console.error(`\n   💡 AGENT HINT: '${this.cmd}' appears to be a PowerShell cmdlet (e.g. Get-Item, Write-Host).\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   You cannot execute cmdlets directly as files. Please wrap them using: {"command": "pwsh", "args": ["-c", "${this.cmd}"]}`);
    } else if (/\.(?:sh|ps1|bat|cmd)$/i.test(this.cmd)) {
      console.error(`\n   💡 AGENT HINT: You attempted to run a script file ('${this.cmd}') as a direct command.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Please use the {"type": "script", "scriptPath": "${this.cmd}"} payload type instead.`);
    } else if (this.cmd.includes(' ')) {
      const parts = this.cmd.split(' ');
      const errArgs = parts.slice(1).map((s: string) => `"${s}"`).join(', ');
      console.error(`\n   💡 AGENT HINT: Your command contains spaces. Because shell: false is used,\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   you MUST pass arguments in the 'args' array, not in the 'command' string.`);
      console.error(`   ❌ BAD: {"command": "${this.cmd}"}`);
      console.error(`   ✅ GOOD: {"command": "${parts[0]}", "args": [${errArgs}]}`);
    }
  }

  private onChildError(error: unknown) {
    if (this.isFinished) return;
    this.abortedInternally = true;
    this.isFinished = true;
    this.clearActiveTimersAndHandlers();
    this.cleanupTempScript();
    this.ioController?.flushAll();

    const handleError = () => {
      const msg = error instanceof Error ? error.message : String(error);
      const errCode = error instanceof Error && isErrnoException(error) && error.code ? String(error.code) : undefined;
      const errSyscall = error instanceof Error && isErrnoException(error) && error.syscall ? String(error.syscall) : undefined;
      if (!this.isJson) console.error(`❌ Execution Error: ${msg}`);
      this.printSpawnHints(errCode, errSyscall);
      this.isFinished = false;
      this.handleFinish(1, null, false);
    };

    if (this.ioController) {
      this.ioController.closeFileStreams().then(handleError, handleError);
    } else {
      handleError();
    }
  }

  private setupTimeouts() {
    const timeoutMs = this.timeoutOverrideMs ?? this.payload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) return;

    this.timeoutTimer = setTimeout(() => {
      this.timedOut = true;
      console.error(`\n❌ Execution timed out after ${timeoutMs}ms. Attempting graceful shutdown...`);
      console.error(`   💡 AGENT HINT: If you intended to start a long-running process (like a dev server), you must send it to the background by configuring your tool payload (e.g., using 'WaitMsBeforeAsync') AND set 'timeoutMs' to a large value (e.g. 86400000) in the JSON payload.`);
      try {
        if (this.child?.pid) {
          if (process.platform === 'win32') killProcessTree(this.child);
          else process.kill(-this.child.pid, 'SIGTERM');
        }
      } catch { /* ignore */ }

      this.forceKillTimer = setTimeout(() => {
        if (this.isFinished) return;
        if (!this.isJson) console.error(`${this.timedOut ? 'ℹ️' : '❌'} Process did not exit gracefully. Force killing process tree...`);
        if (this.child) killProcessTree(this.child);
        this.ioController?.destroyStreams();
        this.handleFinish(null, 'SIGKILL', false);
        setTimeout(() => {
          if (!this.isJson) console.error(`${this.timedOut ? 'ℹ️' : '❌'} Ultimate fallback: Process exit forced.`);
          process.exit(1);
        }, TIMEOUT_EXIT_FORCE_MS).unref();
      }, FORCE_KILL_DELAY_MS);
    }, timeoutMs);
  }

  private retryWslLaunch() {
    this.hasRetriedWsl = true;
    const ioCtrl = this.ioController;
    if (ioCtrl) {
      ioCtrl.flushAll();
      ioCtrl.destroyStreams();
    }
    console.error(`\n   💡 AGENT HINT: 'wsl.exe' exited with code 255 (transient WSL VM startup/pipe issue).`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically retrying command in WSL2 after 500ms... (Frictionless Recovery)\x1b[0m`);

    const scheduleRetry = () => {
      this.isFinished = false;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        try {
          this.spawnChild();
          this.setupIOController();
          this.setupEventHandlers();
          this.setupTimeouts();
        } catch (retryErr: unknown) {
          if (this.child) killProcessTree(this.child);
          if (!this.isJson) console.error('❌ WSL retry spawn failed:', retryErr);
          this.abortedInternally = true;
          this.handleFinish(1, null, false);
        }
      }, 500);
    };

    if (ioCtrl) {
      ioCtrl.closeFileStreams().then(scheduleRetry, scheduleRetry);
    } else {
      scheduleRetry();
    }
  }

  private computeFinalCode(code: number | null, signal: NodeJS.Signals | null, envData: Record<string, unknown> | null): number | null {
    if (this.timedOut || this.abortedInternally) {
      return typeof code === 'number' && code !== 0 ? code : 1;
    }
    if (envData === null) return code;
    const status = envData.status;
    const exitCode = envData.exit_code;
    if (status === 'error' || (typeof exitCode === 'number' && exitCode !== 0)) {
      return typeof exitCode === 'number' && exitCode !== 0 ? exitCode : 1;
    }
    if (status === 'success' && signal === null) {
      return 0;
    }
    return code;
  }

  private async dispatchWebhook(target: string | string[] | undefined, finalCode: number | null, signal: NodeJS.Signals | null, success: boolean, envData: Record<string, unknown> | null): Promise<void> {
    if (!target) return;
    await sendWebhook(this.payload, target, {
      stdout: this.ioController?.stdoutTail || '', stderr: this.ioController?.stderrTail || '',
      code: finalCode, signal, success, envData,
    });
  }

  private logGracefulReason(code: number, analysis: ExitCodeAnalysis): void {
    if (this.isJson) return;
    if (analysis.isGrepNoMatch) console.error(`\nℹ️  No matches found (exit code ${code}).`);
    else if (analysis.isDiffFound) console.error(`\nℹ️  Differences found (exit code ${code}).`);
    else if (analysis.isOutdatedInfo) console.error(`\nℹ️  Outdated packages found (exit code ${code}).`);
  }

  private async finishJsonMode(computedCode: number | null, signal: NodeJS.Signals | null, envData: Record<string, unknown> | null, analysis: ExitCodeAnalysis | null): Promise<never> {
    const finalCode = analysis !== null && isGracefulExitAnalysis(analysis) ? 0 : computedCode;
    await this.dispatchWebhook(finalCode !== 0 ? this.payload.onFailure : this.payload.onSuccess, finalCode, signal, finalCode === 0, envData);
    console.log(JSON.stringify({ status: finalCode === 0 ? 'success' : 'error', code: finalCode, signal, stdout: this.ioController?.stdoutTail || '', stderr: this.ioController?.stderrTail || '', envData }));
    process.exit(finalCode === 0 ? 0 : (finalCode ?? 1));
  }

  private async finishTextMode(code: number | null, signal: NodeJS.Signals | null, envData: Record<string, unknown> | null, isDaemon: boolean, analysis: ExitCodeAnalysis | null): Promise<never> {
    if (code === 0) {
      if (!this.isJson) console.error(`\n✅ Command succeeded${isDaemon ? ' (background process detached)' : ''}.`);
      await this.dispatchWebhook(this.payload.onSuccess, 0, signal, true, envData);
      process.exit(0);
    }
    if (code === null) {
      await this.dispatchWebhook(this.payload.onFailure, code, signal, false, envData);
      if (signal && !this.isJson) console.error(`\n${this.timedOut ? 'ℹ️' : '❌'} Command was terminated by signal ${signal}`);
      process.exit(1);
    }
    if (analysis !== null && isGracefulExitAnalysis(analysis)) {
      this.logGracefulReason(code, analysis);
      await this.dispatchWebhook(this.payload.onSuccess, 0, signal, true, envData);
      process.exit(0);
    }
    await this.dispatchWebhook(this.payload.onFailure, code, signal, false, envData);
    const rawCmdBase = this.payload.type === 'command' && typeof this.payload.command === 'string'
      ? path.basename(this.payload.command).replace(/\.(cmd|exe)$/i, '').toLowerCase()
      : '';
    const suppressRedundantExit = ['pnpm', 'npm', 'bun', 'yarn', 'node'].includes(rawCmdBase);
    setLastStderrTail(this.ioController?.stderrTail || '');
    if (!this.isJson && !suppressRedundantExit) console.error(`\n❌ Command exited with code ${code}`);
    if (process.platform === 'win32' && BUILT_INS.includes(this.cmd.toLowerCase()) && !this.isJson) {
      console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n${AUTONOMOUS_HEALING_MSG}`);
    }
    process.exit(code);
  }

  private handleFinish(code: number | null, signal: NodeJS.Signals | null, isDaemon: boolean) {
    if (this.isFinished) return;
    this.isFinished = true;
    this.clearActiveTimersAndHandlers();
    if (code === 255 && path.basename(this.cmd).toLowerCase() === 'wsl.exe' && !this.hasRetriedWsl && !signal && !this.timedOut && !this.abortedInternally) {
      this.retryWslLaunch();
      return;
    }
    this.cleanupTempScript();
    this.ioController?.flushAll();
    const finalizeFinish = async () => {
      const envData = this.ioController && typeof this.ioController.getParsedEnvelope === 'function' ? this.ioController.getParsedEnvelope() : null;
      const computedCode = this.computeFinalCode(code, signal, envData);
      const analysis = (!this.timedOut && !this.abortedInternally && signal === null && envData?.status !== 'error' && computedCode === 1)
        ? analyzeExitCode1(this.payload, computedCode, this.ioController?.stdoutTail || '', this.ioController?.stderrTail || '')
        : null;
      const telemetryCode = analysis !== null && isGracefulExitAnalysis(analysis) ? 0 : computedCode;
      await sendDatadogTelemetry(
        this.payload, this.cwd, 'agent_exec.command.count',
        telemetryCode === 0 ? 'success' : 'error', computedCode,
        this.ioController?.stdoutTail || '', this.ioController?.stderrTail || '',
      );
      if (this.isJson) return this.finishJsonMode(computedCode, signal, envData, analysis);
      return this.finishTextMode(computedCode, signal, envData, isDaemon, analysis);
    };
    const finishPromise = this.ioController
      ? this.ioController.closeFileStreams().then(finalizeFinish, finalizeFinish)
      : finalizeFinish();
    return finishPromise.catch((err: unknown) => {
      if (!this.isJson) console.error('❌ Finalization error:', err);
      process.exit(1);
    });
  }
}
