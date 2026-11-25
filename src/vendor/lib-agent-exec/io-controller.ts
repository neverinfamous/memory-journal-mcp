// @ts-nocheck
import type * as fs from 'node:fs';
import { type Writable } from 'node:stream';
import { type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { StreamManager } from './stream-manager.js';
import { checkPrompt } from './prompt-detector.js';
import { type ExecPayload } from './schema.js';
import {
  DEFAULT_MAX_BUFFER,
  INFINITE_MAX_BUFFER,
  appendOutputTail,
  closeStreamsWithTimeout,
  createConfiguredOutputStream,
  extractEnvelope,
  hasAnsiTuiSequence,
  hasWebhookStream,
  isEnvelopeObject,
  parseEnvelopeFromTail,
  pauseStreamUntilDrained,
} from './io-utils.js';
import { recordAgentIssue } from './utils.js';

const STDIN_CHUNK_SIZE = 64 * 1024;
const PROMPT_DEBOUNCE_MS = 250;
const PROMPT_STALL_TIMEOUT_MS = 2000;
const FLUSH_TIMEOUT_MS = 200;
const PENDING_STDOUT_LIMIT = 1024 * 1024;

export class IOController {
  private stdoutDecoder = new StringDecoder('utf8');
  private stderrDecoder = new StringDecoder('utf8');
  private _stdoutTail = '';
  private _stderrTail = '';
  private _lastParsedEnvelope: Record<string, unknown> | null = null;
  private consumedEnvelopeIsLatest = false;
  private pendingStdout = '';
  private _lastDataTime = Date.now();
  
  public get stdoutTail(): string { return this._stdoutTail; }
  public get stderrTail(): string { return this._stderrTail; }
  public get lastDataTime(): number { return this._lastDataTime; }
  
  public getParsedEnvelope(): Record<string, unknown> | null {
    if (!this.payload.expectJsonEnvelope) return null;
    
    const tailToParse = this.consumedEnvelopeIsLatest ? this.pendingStdout : (this.pendingStdout || this._stdoutTail);
    if (tailToParse.trim().length > 0) {
      const current = parseEnvelopeFromTail(tailToParse);
      if (current) return current;
    }
    
    return this._lastParsedEnvelope;
  }
  
  // [INTENT]: Extracts JSON envelope data from the final output chunk without truncating the standard logs. 
  // [INVARIANT]: The payload must strictly match JsonEnvelopeSchema. Invalid JSON is gracefully printed to stdout instead of crashing.
  private finalizeStdout(decoded: string): string {
    if (!this.payload.expectJsonEnvelope) return decoded;
    this.pendingStdout += decoded;
    
    if (this.pendingStdout.length > PENDING_STDOUT_LIMIT) {
      this._lastParsedEnvelope = null;
      this.consumedEnvelopeIsLatest = false;
      const res = this.pendingStdout;
      this.pendingStdout = '';
      return res;
    }

    const tail = this.pendingStdout.trim();
    if (!tail) {
       const res = this.pendingStdout;
       this.pendingStdout = '';
       return res;
    }

    let parsedEnvelope = false;
    const result = extractEnvelope(tail);
    if (result) {
       const envString = tail.slice(result.start, result.end);
       const idx = this.pendingStdout.lastIndexOf(envString);
       const afterEnv = idx === -1 ? tail : this.pendingStdout.slice(idx + envString.length);
       if (idx !== -1 && afterEnv.trim().length === 0) {
          parsedEnvelope = true;
          this._lastParsedEnvelope = result.parsed;
          this.consumedEnvelopeIsLatest = true;
          this.pendingStdout = this.pendingStdout.slice(0, idx);
          if (this.pendingStdout.length > 0 && !this.pendingStdout.endsWith('\n')) {
             this.pendingStdout += '\n';
          }
       }
    }
    if (!parsedEnvelope) {
      this._lastParsedEnvelope = null;
      this.consumedEnvelopeIsLatest = false;
    }
    const res = this.pendingStdout;
    this.pendingStdout = '';
    return res;
  }
  
  private outStream?: fs.WriteStream | Writable | undefined;
  private errStream?: fs.WriteStream | Writable | undefined;
  
  private stallTimer: NodeJS.Timeout | null = null;
  private promptStallTimer: NodeJS.Timeout | null = null;
  private stdoutFlushTimer: NodeJS.Timeout | null = null;
  private stderrFlushTimer: NodeJS.Timeout | null = null;
  
  private isStdinBroken = false;
  private isStdinClosed = false;
  private stdoutEnded = false;
  private stderrEnded = false;
  private aborted = false;

  private streamManager: StreamManager;

  constructor(
    private child: ChildProcess,
    private payload: ExecPayload,
    private cwd: string,
    private onStall: (reason: string) => void,
    private onMaxBuffer: (reason: string) => void,
    private isJson: boolean = false
  ) {
    this.streamManager = new StreamManager(payload.truncateOutputLength, undefined, undefined, isJson);
  }

  public setupStreams(): void {
    this.setupFileStreams();
    this.setupStdin();
    this.bindStdout();
    this.bindStderr();
    this.resetStallTimer();
  }

  private setupFileStreams(): void {
    if (this.payload.stdoutFile) {
      this.outStream = createConfiguredOutputStream('STDOUT', this.payload.stdoutFile, this.payload, this.cwd, this.isJson);
    }
    if (this.payload.stderrFile) {
      this.errStream = createConfiguredOutputStream('STDERR', this.payload.stderrFile, this.payload, this.cwd, this.isJson);
    }

    if (this.outStream !== undefined || this.errStream !== undefined) {
      this.streamManager = new StreamManager(this.payload.truncateOutputLength, this.outStream, this.errStream, this.isJson);
    }
  }

  private setupStdin(): void {
    const input = this.payload.stdin;
    const stdin = this.child.stdin;
    if (!stdin) return;
    stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE' || err.code === 'EOF' || err.code === 'ECONNRESET') {
        this.isStdinBroken = true;
        try { stdin.destroy(); } catch (dErr: unknown) {
          if (dErr instanceof Error && !this.isJson) console.error(`⚠️ STDIN destroy warning: ${dErr.message}`);
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (this.isJson) recordAgentIssue('IO_STREAM_ERROR', `STDIN Stream Error: ${msg}`, this.payload);
        else console.error(`❌ STDIN Stream Error:`, err);
      }
    });
    if (!input) {
      stdin.end();
      this.isStdinClosed = true;
      return;
    }

    const inputBuffer = Buffer.from(input, 'utf8');
    let offset = 0;
    const writeNextChunk = (): void => {
      if (this.isStdinBroken) return;
      let canWrite = true;
      try {
        while (offset < inputBuffer.length && canWrite && !this.isStdinBroken) {
          const chunk = inputBuffer.subarray(offset, offset + STDIN_CHUNK_SIZE);
          offset += STDIN_CHUNK_SIZE;
          canWrite = stdin.write(chunk);
        }
        if (offset >= inputBuffer.length && !this.isStdinBroken) {
          stdin.end();
          this.isStdinClosed = true;
        }
      } catch (err: unknown) {
        this.isStdinBroken = true;
        const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
        if (code !== 'EPIPE' && code !== 'EOF' && code !== 'ECONNRESET') {
          const msg = err instanceof Error ? err.message : String(err);
          if (this.isJson) recordAgentIssue('IO_STREAM_ERROR', `STDIN Stream Error: ${msg}`, this.payload);
          else console.error('❌ STDIN Stream Error:', err);
        }
      }
    };

    stdin.on('drain', writeNextChunk);
    writeNextChunk();
  }

  private resetStallTimer(): void {
    const currentStallTimeoutMs = this.payload.stallTimeoutMs ?? 0;
    if (currentStallTimeoutMs > 0) {
      if (this.stallTimer) clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        this.aborted = true;
        this.onStall(`Execution stalled: No output received for ${currentStallTimeoutMs}ms.`);
      }, currentStallTimeoutMs);
    }
  }

  private evaluatePromptStall(decodedChunk: string = this._stdoutTail): void {
    if (this.payload.bypassInterceptors) return;
    if (this.payload.stdin && !this.isStdinClosed && !this.isStdinBroken) return;
    if (decodedChunk.includes('\u001b[?') && hasAnsiTuiSequence(decodedChunk)) {
      this.aborted = true;
      this.onStall('Execution stalled: Process attempted to enter an interactive alternate screen buffer or TUI.');
      return;
    }
    if (this.promptStallTimer) { clearTimeout(this.promptStallTimer); this.promptStallTimer = null; }
    this.promptStallTimer = setTimeout(() => {
      this.promptStallTimer = null;
      if (this.aborted || (this.stdoutEnded && this.stderrEnded)) return;
      const isStdoutPrompt = checkPrompt(this._stdoutTail);
      const isStderrPrompt = !isStdoutPrompt && checkPrompt(this._stderrTail);
      if (isStdoutPrompt || isStderrPrompt) {
        this.promptStallTimer = setTimeout(() => {
          this.promptStallTimer = null;
          this.aborted = true;
          this.onStall(`Execution stalled: Process appears to be waiting for interactive input on ${isStdoutPrompt ? 'stdout' : 'stderr'}.`);
        }, PROMPT_STALL_TIMEOUT_MS - PROMPT_DEBOUNCE_MS);
      }
    }, PROMPT_DEBOUNCE_MS);
  }

  private scheduleStreamFlush(isErr: boolean): void {
    const timer = isErr ? this.stderrFlushTimer : this.stdoutFlushTimer;
    if (timer) return;
    const newTimer = setTimeout(() => {
      if (isErr) this.stderrFlushTimer = null;
      else this.stdoutFlushTimer = null;
      if (this.aborted) return;
      const str = this.streamManager.flushPendingLine(isErr);
      if (str) {
        this.streamManager.addLength(isErr, str.length);
        if (!this.enforceBufferLimits()) return;
        const streamsToDrain = this.streamManager.writeData(isErr, str, this.payload.stdoutFile, this.payload.stderrFile);
        const stream = isErr ? this.child.stderr : this.child.stdout;
        pauseStreamUntilDrained(stream, streamsToDrain);
      }
    }, FLUSH_TIMEOUT_MS);
    if (isErr) this.stderrFlushTimer = newTimer;
    else this.stdoutFlushTimer = newTimer;
  }

  private processEnvelopeStreaming(decoded: string): string {
    this.pendingStdout += decoded;
    if (this.pendingStdout.length > PENDING_STDOUT_LIMIT) {
      const full = this.pendingStdout;
      this.pendingStdout = '';
      this._lastParsedEnvelope = null;
      this.consumedEnvelopeIsLatest = false;
      return full;
    }
    const lastNl = this.pendingStdout.lastIndexOf('\n');
    const outParts: string[] = [];
    const clearLastEnvelope = (): void => { this._lastParsedEnvelope = null; this.consumedEnvelopeIsLatest = false; };
    if (lastNl !== -1) {
      for (const line of this.pendingStdout.slice(0, lastNl).split('\n')) {
        if (!this.tryConsumeEnvelopeLine(line)) {
          if (line.trim().length > 0) clearLastEnvelope();
          outParts.push(`${line}\n`);
        }
      }
      this.pendingStdout = this.pendingStdout.slice(lastNl + 1);
    }
    if (this.pendingStdout.length > 0 && !this.pendingStdout.trimStart().startsWith('{')) {
      if (this.pendingStdout.trim().length > 0) clearLastEnvelope();
      outParts.push(this.pendingStdout);
      this.pendingStdout = '';
    }
    return outParts.join('');
  }

  private tryConsumeEnvelopeLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isEnvelopeObject(parsed)) return false;
      this._lastParsedEnvelope = parsed;
      this.consumedEnvelopeIsLatest = true;
      return true;
    } catch (err: unknown) {
      if (!(err instanceof SyntaxError)) console.error(`[agent-exec] envelope check error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private enforceBufferLimits(): boolean {
    if (this.payload.maxBuffer !== undefined) {
      const totalLen = this.streamManager.getBufferedLength(false) + this.pendingStdout.length + this.streamManager.getBufferedLength(true);
      if (totalLen > this.payload.maxBuffer) {
        this.aborted = true;
        this.onMaxBuffer(`Output exceeded maxBuffer of ${this.payload.maxBuffer} bytes.`);
        return false;
      }
      return true;
    }
    if (this.payload.truncateOutputLength !== undefined) return true;
    const outMax = this.outStream !== undefined ? INFINITE_MAX_BUFFER : DEFAULT_MAX_BUFFER;
    const errMax = this.errStream !== undefined ? INFINITE_MAX_BUFFER : DEFAULT_MAX_BUFFER;
    const combinedMax = (this.outStream !== undefined || this.errStream !== undefined) ? (outMax + errMax) : DEFAULT_MAX_BUFFER;
    const outLen = this.streamManager.getBufferedLength(false) + this.pendingStdout.length;
    const errLen = this.streamManager.getBufferedLength(true);
    const exceededLimit =
      outLen > outMax ? outMax :
      errLen > errMax ? errMax :
      (outLen + errLen) > combinedMax ? combinedMax : undefined;
    if (exceededLimit !== undefined) {
      this.aborted = true;
      this.onMaxBuffer(`Output exceeded maxBuffer of ${exceededLimit} bytes.`);
      return false;
    }
    return true;
  }

  private updateEnvelopeTail(decoded: string): void {
    this._stdoutTail = appendOutputTail(this._stdoutTail, decoded);
    if (!this.payload.expectJsonEnvelope) return;
    const candidate = this.consumedEnvelopeIsLatest ? this.pendingStdout : (this.pendingStdout || this._stdoutTail);
    if (!candidate.trimEnd().endsWith('}')) return;
    const parsed = parseEnvelopeFromTail(candidate);
    if (!parsed) return;
    this._lastParsedEnvelope = parsed;
    if (candidate === this._stdoutTail) this.consumedEnvelopeIsLatest = false;
  }

  private processData(isErr: boolean, data: Buffer): void {
    if (this.aborted) return;
    this._lastDataTime = Date.now();
    let decoded = isErr ? this.stderrDecoder.write(data) : this.stdoutDecoder.write(data);
    if (!isErr && this.payload.expectJsonEnvelope) {
      decoded = this.processEnvelopeStreaming(decoded);
    }
    if (isErr) this._stderrTail = appendOutputTail(this._stderrTail, decoded);
    else this.updateEnvelopeTail(decoded);
    this.evaluatePromptStall(decoded);
    if (this.aborted) return;
    this.resetStallTimer();
    this.scheduleStreamFlush(isErr);

    const str = this.streamManager.processChunk(isErr, decoded);
    this.streamManager.addLength(isErr, str.length);
    if (!this.enforceBufferLimits()) return;

    const streamsToDrain = this.streamManager.writeData(isErr, str, this.payload.stdoutFile, this.payload.stderrFile);
    const stream = isErr ? this.child.stderr : this.child.stdout;
    pauseStreamUntilDrained(stream, streamsToDrain);
  }

  private processEnd(isErr: boolean): void {
    if (isErr) this.stderrEnded = true;
    else this.stdoutEnded = true;
    if (isErr && this.stderrFlushTimer) { clearTimeout(this.stderrFlushTimer); this.stderrFlushTimer = null; }
    if (!isErr && this.stdoutFlushTimer) { clearTimeout(this.stdoutFlushTimer); this.stdoutFlushTimer = null; }
    if (this.stdoutEnded && this.stderrEnded && this.promptStallTimer) { clearTimeout(this.promptStallTimer); this.promptStallTimer = null; }
    if (this.stdoutEnded && this.stderrEnded && this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
    if (this.aborted) return;
    let decoded = isErr ? this.stderrDecoder.end() : this.stdoutDecoder.end();
    if (!isErr) {
      decoded = this.finalizeStdout(decoded);
      this._stdoutTail = appendOutputTail(this._stdoutTail, decoded);
    } else if (decoded) {
      this._stderrTail = appendOutputTail(this._stderrTail, decoded);
    }
    let str = this.streamManager.processChunk(isErr, decoded);
    str += this.streamManager.flushChunk(isErr);
    if (str) {
      this.streamManager.addLength(isErr, str.length);
      if (!this.enforceBufferLimits()) return;
      this.streamManager.writeData(isErr, str, this.payload.stdoutFile, this.payload.stderrFile);
    }
  }

  private bindStdout(): void {
    if (this.child.stdout) {
      this.child.stdout.on('data', (data: Buffer) => this.processData(false, data));
      this.child.stdout.on('end', () => this.processEnd(false));
    }
  }

  private bindStderr(): void {
    if (this.child.stderr) {
      this.child.stderr.on('data', (data: Buffer) => this.processData(true, data));
      this.child.stderr.on('end', () => this.processEnd(true));
    }
  }

  public flushAll(): void {
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
    if (this.promptStallTimer) { clearTimeout(this.promptStallTimer); this.promptStallTimer = null; }
    if (this.stdoutFlushTimer) { clearTimeout(this.stdoutFlushTimer); this.stdoutFlushTimer = null; }
    if (this.stderrFlushTimer) { clearTimeout(this.stderrFlushTimer); this.stderrFlushTimer = null; }

    if (this.child.stdout) {
      if (this.pendingStdout) {
        const finalStr = this.finalizeStdout('');
        if (finalStr) {
          this._stdoutTail = appendOutputTail(this._stdoutTail, finalStr);
          const str = this.streamManager.processChunk(false, finalStr);
          this.streamManager.addLength(false, str.length);
          this.streamManager.writeData(false, str, this.payload.stdoutFile, this.payload.stderrFile);
        }
      }
      const str = this.streamManager.flushChunk(false);
      if (str) {
        this.streamManager.addLength(false, str.length);
        this.streamManager.writeData(false, str, this.payload.stdoutFile, this.payload.stderrFile);
      }
    }
    if (this.child.stderr) {
      const str = this.streamManager.flushChunk(true);
      if (str) {
        this.streamManager.addLength(true, str.length);
        this.streamManager.writeData(true, str, this.payload.stdoutFile, this.payload.stderrFile);
      }
    }
  }

  public async closeFileStreams(): Promise<void> {
    const timeoutMs = hasWebhookStream(this.payload)
      ? Math.min(Math.max(2000, (this.payload.webhookTimeoutMs ?? 5000) + 500), 15000)
      : 2000;
    await closeStreamsWithTimeout([this.outStream, this.errStream], timeoutMs);
  }

  public destroyStreams(): void {
    this.aborted = true;
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
    if (this.promptStallTimer) { clearTimeout(this.promptStallTimer); this.promptStallTimer = null; }
    if (this.stdoutFlushTimer) { clearTimeout(this.stdoutFlushTimer); this.stdoutFlushTimer = null; }
    if (this.stderrFlushTimer) { clearTimeout(this.stderrFlushTimer); this.stderrFlushTimer = null; }
    if (this.child.stdout) this.child.stdout.destroy();
    if (this.child.stderr) this.child.stderr.destroy();
    if (this.child.stdin) this.child.stdin.destroy();
  }
}
