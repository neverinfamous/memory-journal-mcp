// @ts-nocheck
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { IOController } from './io-controller.js';
import { killProcessTree } from './process-manager.js';
import { type ExecPayload } from './schema.js';
import { sendWebhook, sendDatadogTelemetry, BUILT_INS, AUTONOMOUS_HEALING_MSG, setLastStderrTail, recordAgentIssue } from './utils.js';
import { analyzeExitCode1, isGracefulExitAnalysis, type ExitCodeAnalysis } from './exit-code-policy.js';
import { isErrnoException, logGracefulExitReason, printProcessSpawnHints, resolveFinalExitCode } from './process-exit-helpers.js';
export { analyzeExitCode1 };

const TIMEOUT_EXIT_FORCE_MS = 5000;
const STREAM_DAEMON_CHECK_MS = 100;
const DAEMON_DATA_STALL_MS = 500;
const DAEMON_EXIT_STALL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 2000;

export class ProcessController {
  private child?: ChildProcess | undefined;
  private ioController?: IOController;

  private isFinished = false;
  private timedOut = false;
  private abortedInternally = false;
  private spawnFailed = false;
  private spawnErrorMessage: string | null = null;
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

  public start(): void {
    try {
      this.spawnChild();
      this.setupIOController();
      this.setupEventHandlers();
      this.setupTimeouts();
    } catch (err) {
      if (this.child && !this.isFinished) killProcessTree(this.child);
      this.clearActiveTimersAndHandlers();
      this.cleanupTempScript();
      if (err instanceof Error && isErrnoException(err) && (err.code || err.syscall === 'uv_spawn')) {
        this.onChildError(err);
        return;
      }
      this.failFatal('Unexpected error during spawn setup', err);
    }
  }

  private spawnChild(): void {
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

  private setupIOController(): void {
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

  private cleanupTempScript(): void {
    if (this.tempScriptPath && fs.existsSync(this.tempScriptPath)) {
      try { fs.unlinkSync(this.tempScriptPath); } catch { /* ignore */ }
    }
  }

  private clearActiveTimersAndHandlers(): void {
    for (const cleanup of this.cleanupProcessHandlers) {
      cleanup();
    }
    this.cleanupProcessHandlers = [];
    if (this.timeoutTimer) { clearTimeout(this.timeoutTimer); this.timeoutTimer = null; }
    if (this.forceKillTimer) { clearTimeout(this.forceKillTimer); this.forceKillTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.daemonCheckInterval) { clearInterval(this.daemonCheckInterval); this.daemonCheckInterval = null; }
  }

  private handleStall(reason: string): void {
    if (this.isJson) recordAgentIssue('STALL_DETECTED', `❌ ${reason} Forcing termination...`, this.payload);
    else console.error(`\n❌ ${reason} Forcing termination...`);
    this.abortedInternally = true;
    this.ioController?.destroyStreams();
    if (this.child) killProcessTree(this.child);
    void this.handleFinish(1, null, false);
  }

  private handleMaxBuffer(reason: string): void {
    if (!this.isJson) console.error(`\n❌ ${reason}`);
    this.abortedInternally = true;
    this.ioController?.destroyStreams();
    if (this.child) killProcessTree(this.child);
    void this.handleFinish(1, null, false);
  }

  private setupEventHandlers(): void {
    const child = this.child;
    if (child === undefined) return;

    const onExit = (): void => {
      this.cleanupTempScript();
      if (!this.isFinished && this.child) killProcessTree(this.child);
    };
    process.on('exit', onExit);
    this.cleanupProcessHandlers.push(() => process.off('exit', onExit));

    const crashShutdown = (label: string, err: unknown): void => {
      if (this.isFinished) return;
      this.isFinished = true;
      this.abortedInternally = true;
      this.clearActiveTimersAndHandlers();
      const errMsg = err instanceof Error ? err.message : String(err);
      if (this.isJson) recordAgentIssue('EXECUTION_ERROR', `❌ ${label}: ${errMsg}`, this.payload);
      else console.error(`❌ ${label}:`, err);
      if (typeof this.ioController?.flushAll === 'function') this.ioController.flushAll();
      if (typeof this.ioController?.destroyStreams === 'function') this.ioController.destroyStreams();
      if (this.child) killProcessTree(this.child);
      this.cleanupTempScript();
      const finish = (): void => { if (this.isJson) console.log(JSON.stringify({ status: 'error', code: 1, message: `${label}: ${errMsg}` })); process.exit(1); };
      if (this.ioController) this.ioController.closeFileStreams().then(finish, finish);
      else finish();
    };
    const onUncaught = (err: Error): void => crashShutdown('Uncaught Exception in agent-exec', err);
    const onUnhandled = (reason: unknown): void => crashShutdown('Unhandled Rejection in agent-exec', reason);
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
    this.cleanupProcessHandlers.push(
      () => process.off('uncaughtException', onUncaught),
      () => process.off('unhandledRejection', onUnhandled),
    );

    const handleSignal = (signal: NodeJS.Signals): void => {
      if (!this.isJson) console.error(`\n⚠️ Received ${signal}, terminating process tree...`);
      if (this.child) killProcessTree(this.child);
      this.ioController?.destroyStreams();
      void this.handleFinish(null, signal, false);
    };
    const onSigint = (): void => handleSignal('SIGINT');
    const onSigterm = (): void => handleSignal('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    this.cleanupProcessHandlers.push(
      () => process.off('SIGINT', onSigint),
      () => process.off('SIGTERM', onSigterm),
    );

    child.on('exit', (code, signal) => { if (this.child === child) this.onChildExit(code, signal); });
    child.on('close', (code, signal) => { if (this.child === child) void this.handleFinish(code, signal, false); });
    child.on('error', (error) => { if (this.child === child) this.onChildError(error); });
  }

  // [INTENT]: Resolves zombie processes where the main shell exits but leaves a background daemon holding stdout/stderr open.
  // [SIDE-EFFECT]: Forcibly destroys IO streams and kills the process tree if stalls exceed DAEMON_EXIT_STALL_MS.
  // [AGENT-HINT]: Do NOT decrease this timeout, or you will prematurely kill valid background compilation tasks.
  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
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
      void this.handleFinish(code, signal, true);
    }, STREAM_DAEMON_CHECK_MS);
    this.daemonCheckInterval.unref();
  }

  private printSpawnHints(errCode: string | undefined, errSyscall: string | undefined): void {
    if (this.isJson) return;
    printProcessSpawnHints(this.cmd, this.cwd, errCode, errSyscall);
  }

  private onChildError(error: unknown): void {
    if (this.isFinished) return;
    this.spawnFailed = true;
    this.abortedInternally = true;
    this.isFinished = true;
    this.clearActiveTimersAndHandlers();
    this.cleanupTempScript();
    this.ioController?.flushAll();

    const handleError = (): void => {
      const msg = error instanceof Error ? error.message : String(error);
      this.spawnErrorMessage = msg;
      const errCode = error instanceof Error && isErrnoException(error) && error.code ? String(error.code) : undefined;
      const errSyscall = error instanceof Error && isErrnoException(error) && error.syscall ? String(error.syscall) : undefined;
      if (this.isJson) recordAgentIssue('EXECUTION_ERROR', `❌ Execution Error: ${msg}`, this.payload);
      else console.error(`❌ Execution Error: ${msg}`);
      this.printSpawnHints(errCode, errSyscall);
      this.isFinished = false;
      void this.handleFinish(1, null, false);
    };

    if (this.ioController) {
      this.ioController.closeFileStreams().then(handleError, handleError);
    } else {
      handleError();
    }
  }

  private setupTimeouts(): void {
    const timeoutMs = this.timeoutOverrideMs ?? this.payload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) return;

    this.timeoutTimer = setTimeout(() => {
      this.timedOut = true;
      if (this.isJson) {
        recordAgentIssue('TIMEOUT', `❌ Execution timed out after ${timeoutMs}ms. Attempting graceful shutdown...`, this.payload);
      } else {
        console.error(`\n❌ Execution timed out after ${timeoutMs}ms. Attempting graceful shutdown...`);
        console.error(`   💡 AGENT HINT: If you intended to start a long-running process (like a dev server), you must send it to the background by configuring your tool payload (e.g., using 'WaitMsBeforeAsync') AND set 'timeoutMs' to a large value (e.g. 86400000) in the JSON payload.`);
      }
      try {
        if (this.child?.pid !== undefined) {
          if (process.platform === 'win32') killProcessTree(this.child);
          else process.kill(-this.child.pid, 'SIGTERM');
        }
      } catch { /* ignore */ }

      this.forceKillTimer = setTimeout(() => {
        if (this.isFinished) return;
        if (!this.isJson) console.error(`${this.timedOut ? 'ℹ️' : '❌'} Process did not exit gracefully. Force killing process tree...`);
        if (this.child) killProcessTree(this.child);
        this.ioController?.destroyStreams();
        void this.handleFinish(null, 'SIGKILL', false);
        setTimeout(() => {
          if (!this.isJson) console.error(`${this.timedOut ? 'ℹ️' : '❌'} Ultimate fallback: Process exit forced.`);
          process.exit(1);
        }, TIMEOUT_EXIT_FORCE_MS).unref();
      }, FORCE_KILL_DELAY_MS);
    }, timeoutMs);
  }

  private executeWslRetry(): void {
    try {
      this.spawnChild();
      this.setupIOController();
      this.setupEventHandlers();
      this.setupTimeouts();
    } catch (retryErr: unknown) {
      if (this.child) killProcessTree(this.child);
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      this.spawnFailed = true;
      this.spawnErrorMessage = msg;
      if (this.isJson) recordAgentIssue('EXECUTION_ERROR', `❌ WSL retry spawn failed: ${msg}`, this.payload);
      else console.error('❌ WSL retry spawn failed:', retryErr);
      this.abortedInternally = true;
      void this.handleFinish(1, null, false);
    }
  }

  private retryWslLaunch(): void {
    this.hasRetriedWsl = true;
    this.child = undefined;
    const ioCtrl = this.ioController;
    if (ioCtrl) { ioCtrl.flushAll(); ioCtrl.destroyStreams(); }
    if (this.isJson) {
      recordAgentIssue(
        'AUTONOMOUS_HEALING_TRIGGERED',
        `🛠️ AUTONOMOUS HEALING: 'wsl.exe' exited with code 255; automatically retrying command in WSL2 after 500ms...`,
        this.payload,
      );
    } else {
      console.error(`\n   💡 AGENT HINT: 'wsl.exe' exited with code 255 (transient WSL VM startup/pipe issue).`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically retrying command in WSL2 after 500ms... (Frictionless Recovery)\x1b[0m`);
    }

    const scheduleRetry = (): void => {
      const onRetryExit = (): void => this.cleanupTempScript();
      process.on('exit', onRetryExit);
      const removeRetryExit = (): void => { process.off('exit', onRetryExit); };
      this.cleanupProcessHandlers.push(removeRetryExit);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.isFinished = false;
        removeRetryExit();
        this.executeWslRetry();
      }, 500);
    };

    if (ioCtrl) ioCtrl.closeFileStreams().then(scheduleRetry, scheduleRetry);
    else scheduleRetry();
  }

  private computeFinalCode(code: number | null, signal: NodeJS.Signals | null, envData: Record<string, unknown> | null): number | null {
    return resolveFinalExitCode(this.timedOut || this.abortedInternally, code, signal, envData);
  }

  private failFatal(label: string, err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (this.isJson) {
      recordAgentIssue('EXECUTION_ERROR', `❌ ${label}: ${msg}`, this.payload);
      console.log(JSON.stringify({ status: 'error', code: 1, message: msg }));
    } else console.error(`❌ ${label}:`, err);
    process.exit(1);
  }

  private async dispatchWebhook(target: string | string[] | undefined, finalCode: number | null, signal: NodeJS.Signals | null, success: boolean, envData: Record<string, unknown> | null): Promise<void> {
    if (target === undefined || target.length === 0) return;
    await sendWebhook(
      this.payload,
      target,
      { stdout: this.ioController?.stdoutTail || '', stderr: this.ioController?.stderrTail || '', code: finalCode, signal, success, envData },
      this.isJson,
    );
  }

  private logGracefulReason(code: number, analysis: ExitCodeAnalysis): void {
    if (!this.isJson) logGracefulExitReason(code, analysis);
  }

  private async finishJsonMode(computedCode: number | null, signal: NodeJS.Signals | null, envData: Record<string, unknown> | null, analysis: ExitCodeAnalysis | null): Promise<never> {
    const finalCode = analysis !== null && isGracefulExitAnalysis(analysis) ? 0 : computedCode;
    await this.dispatchWebhook(finalCode !== 0 ? this.payload.onFailure : this.payload.onSuccess, finalCode, signal, finalCode === 0, envData);
    const jsonOut: Record<string, unknown> = { status: finalCode === 0 ? 'success' : 'error', code: finalCode, signal, stdout: this.ioController?.stdoutTail || '', stderr: this.ioController?.stderrTail || '', envData };
    if (this.spawnErrorMessage !== null) jsonOut['message'] = this.spawnErrorMessage;
    console.log(JSON.stringify(jsonOut));
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
      ? path.basename(this.payload.command).replace(/\.(cmd|exe)$/i, '').toLowerCase() : '';
    const suppressRedundantExit = ['pnpm', 'npm', 'bun', 'yarn', 'node'].includes(rawCmdBase);
    setLastStderrTail(this.ioController?.stderrTail || '');
    if (!this.isJson && !suppressRedundantExit && !this.spawnFailed && !this.timedOut) console.error(`\n❌ Command exited with code ${code}`);
    if (process.platform === 'win32' && BUILT_INS.includes(this.cmd.toLowerCase()) && !this.isJson) {
      console.error(`\n   💡 AGENT HINT: '${this.cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n${AUTONOMOUS_HEALING_MSG}`);
    }
    process.exit(code);
  }

  private handleFinish(code: number | null, signal: NodeJS.Signals | null, isDaemon: boolean): Promise<void> {
    if (this.isFinished) return Promise.resolve();
    this.isFinished = true;
    this.clearActiveTimersAndHandlers();
    if (code === 255 && path.basename(this.cmd).toLowerCase() === 'wsl.exe' && !this.hasRetriedWsl && !signal && !this.timedOut && !this.abortedInternally) {
      this.retryWslLaunch();
      return Promise.resolve();
    }
    this.cleanupTempScript();
    this.ioController?.flushAll();
    const finalizeFinish = async (): Promise<never> => {
      const envData = this.ioController && typeof this.ioController.getParsedEnvelope === 'function' ? this.ioController.getParsedEnvelope() : null;
      const computedCode = this.computeFinalCode(code, signal, envData);
      const analysis = (!this.timedOut && !this.abortedInternally && signal === null && envData?.['status'] !== 'error' && computedCode === 1)
        ? analyzeExitCode1(this.payload, computedCode, this.ioController?.stdoutTail || '', this.ioController?.stderrTail || '')
        : null;
      const telemetryCode = analysis !== null && isGracefulExitAnalysis(analysis) ? 0 : computedCode;
      await sendDatadogTelemetry(this.payload, this.cwd, 'agent_exec.command.count', telemetryCode === 0 ? 'success' : 'error', computedCode, this.ioController?.stdoutTail || '', this.ioController?.stderrTail || '');
      return this.isJson ? this.finishJsonMode(computedCode, signal, envData, analysis) : this.finishTextMode(computedCode, signal, envData, isDaemon, analysis);
    };
    const finishPromise = this.ioController ? this.ioController.closeFileStreams().then(finalizeFinish, finalizeFinish) : finalizeFinish();
    return finishPromise.catch((err: unknown) => this.failFatal('Finalization error', err));
  }
}
