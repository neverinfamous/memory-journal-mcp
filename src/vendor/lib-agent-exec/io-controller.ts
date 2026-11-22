// @ts-nocheck
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { StreamManager } from './stream-manager.js';
import { checkPrompt } from './prompt-detector.js';
import { ExecPayload } from './schema.js';
import { recordAgentIssue, replaceIntegrationContext, validateWebhookUrl } from './utils.js';
import {
  DEFAULT_MAX_BUFFER,
  INFINITE_MAX_BUFFER,
  appendOutputTail,
  closeStreamsWithTimeout,
  createWebhookStream,
  extractEnvelope,
  hasAnsiTuiSequence,
  isEnvelopeObject,
  parseEnvelopeFromTail,
  pauseStreamUntilDrained,
} from './io-utils.js';

const STDIN_CHUNK_SIZE = 64 * 1024;
const PROMPT_STALL_TIMEOUT_MS = 2000;
const FLUSH_TIMEOUT_MS = 200;
const PENDING_STDOUT_LIMIT = 1024 * 1024;

export class IOController {
  private stdoutDecoder = new StringDecoder('utf8');
  private stderrDecoder = new StringDecoder('utf8');
  private _stdoutTail = '';
  private _stderrTail = '';
  private _lastParsedEnvelope: Record<string, unknown> | null = null;
  private pendingStdout = '';
  private _lastDataTime = Date.now();
  
  public get stdoutTail() { return this._stdoutTail; }
  public get stderrTail() { return this._stderrTail; }
  public get lastDataTime() { return this._lastDataTime; }
  
  public getParsedEnvelope(): Record<string, unknown> | null {
    if (!this.payload.expectJsonEnvelope) return null;
    
    const current = parseEnvelopeFromTail(this.pendingStdout || this._stdoutTail);
    if (current) return current;
    
    return this._lastParsedEnvelope;
  }
  
  // [INTENT]: Extracts JSON envelope data from the final output chunk without truncating the standard logs. 
  // [INVARIANT]: The payload must strictly match JsonEnvelopeSchema. Invalid JSON is gracefully printed to stdout instead of crashing.
  private finalizeStdout(decoded: string): string {
    if (!this.payload.expectJsonEnvelope) return decoded;
    this.pendingStdout += decoded;
    
    if (this.pendingStdout.length > PENDING_STDOUT_LIMIT) {
      this._lastParsedEnvelope = null;
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
          this.pendingStdout = this.pendingStdout.slice(0, idx);
          if (this.pendingStdout.length > 0 && !this.pendingStdout.endsWith('\n')) {
             this.pendingStdout += '\n';
          }
       }
    }
    if (!parsedEnvelope) this._lastParsedEnvelope = null;
    const res = this.pendingStdout;
    this.pendingStdout = '';
    return res;
  }
  
  private outStream?: fs.WriteStream | Writable;
  private errStream?: fs.WriteStream | Writable;
  
  private stallTimer: NodeJS.Timeout | null = null;
  private promptStallTimer: NodeJS.Timeout | null = null;
  private stdoutFlushTimer: NodeJS.Timeout | null = null;
  private stderrFlushTimer: NodeJS.Timeout | null = null;
  
  private isStdinBroken = false;
  private isStdinClosed = false;
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

  public setupStreams() {
    this.setupFileStreams();
    this.setupStdin();
    this.bindStdout();
    this.bindStderr();
    this.resetStallTimer();
  }

  private setupFileStreams() {
    const ensureDir = (filePath: string) => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    };

    const getStream = (filePath: string) => {
      const expanded = replaceIntegrationContext(filePath, this.payload);
      if (/^https?:\/\//i.test(expanded)) {
        if (validateWebhookUrl(expanded) === null) throw new Error('Invalid or unsafe webhook stream URL.');
        return createWebhookStream(expanded, this.payload);
      }
      const outPath = path.resolve(this.cwd, expanded);
      ensureDir(outPath);
      return fs.createWriteStream(outPath);
    };

    if (this.payload.stdoutFile) {
      try {
        this.outStream = getStream(this.payload.stdoutFile);
        this.outStream.on('error', (err) => {
          if (this.isJson) recordAgentIssue('IO_STREAM_ERROR', `STDOUT File Stream Error: ${err.message}`, this.payload, { file: this.payload.stdoutFile });
          else console.error(`❌ STDOUT File Stream Error: ${err.message}. Agent execution will continue, but output capturing to file may be incomplete.`);
          this.outStream?.destroy();
        });
        if (!this.isJson) console.error(`\n✅ STDOUT successfully streaming to ${this.payload.stdoutFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (this.isJson) recordAgentIssue('IO_STREAM_ERROR', `STDOUT File Setup Error: ${msg}`, this.payload, { file: this.payload.stdoutFile });
        else console.error(`❌ STDOUT File Setup Error: ${msg}. Output will not be captured to file.`);
      }
    }
    if (this.payload.stderrFile) {
      try {
        this.errStream = getStream(this.payload.stderrFile);
        this.errStream.on('error', (err) => {
          if (this.isJson) recordAgentIssue('IO_STREAM_ERROR', `STDERR File Stream Error: ${err.message}`, this.payload, { file: this.payload.stderrFile });
          else console.error(`❌ STDERR File Stream Error: ${err.message}. Agent execution will continue, but output capturing to file may be incomplete.`);
          this.errStream?.destroy();
        });
        if (!this.isJson) console.error(`\n✅ STDERR successfully streaming to ${this.payload.stderrFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (this.isJson) recordAgentIssue('IO_STREAM_ERROR', `STDERR File Setup Error: ${msg}`, this.payload, { file: this.payload.stderrFile });
        else console.error(`❌ STDERR File Setup Error: ${msg}. Output will not be captured to file.`);
      }
    }

    // Re-initialize stream manager with the correct streams
    this.streamManager = new StreamManager(this.payload.truncateOutputLength, this.outStream, this.errStream, this.isJson);
  }

  private setupStdin() {
    const input = this.payload.stdin;
    const stdin = this.child.stdin;
    if (!stdin) return;
    stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE' || err.code === 'EOF' || err.code === 'ECONNRESET') {
        this.isStdinBroken = true;
        try { stdin.destroy(); } catch { /* ignore */ }
      } else {
        console.error(`❌ STDIN Stream Error:`, err);
      }
    });
    if (!input) {
      stdin.end();
      this.isStdinClosed = true;
      return;
    }

    const inputBuffer = Buffer.from(input, 'utf8');
    let offset = 0;
    const writeNextChunk = () => {
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
          console.error('❌ STDIN Stream Error:', err);
        }
      }
    };

    stdin.on('drain', writeNextChunk);
    writeNextChunk();
  }

  private resetStallTimer() {
    const currentStallTimeoutMs = this.payload.stallTimeoutMs ?? 0;
    if (currentStallTimeoutMs > 0) {
      if (this.stallTimer) clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        this.aborted = true;
        this.onStall(`Execution stalled: No output received for ${currentStallTimeoutMs}ms.`);
      }, currentStallTimeoutMs);
    }
  }

  private evaluatePromptStall() {
    if (this.payload.bypassInterceptors) return;
    if (this.payload.stdin && !this.isStdinClosed && !this.isStdinBroken) return;
    if (hasAnsiTuiSequence(this._stdoutTail) || hasAnsiTuiSequence(this._stderrTail)) {
      this.aborted = true;
      this.onStall('Execution stalled: Process attempted to enter an interactive alternate screen buffer or TUI.');
      return;
    }
    if (this.promptStallTimer) { clearTimeout(this.promptStallTimer); this.promptStallTimer = null; }
    const isStdoutPrompt = checkPrompt(this._stdoutTail);
    const isStderrPrompt = checkPrompt(this._stderrTail);
    if (isStdoutPrompt || isStderrPrompt) {
      this.promptStallTimer = setTimeout(() => {
        this.aborted = true;
        this.onStall(`Execution stalled: Process appears to be waiting for interactive input on ${isStdoutPrompt ? 'stdout' : 'stderr'}.`);
      }, PROMPT_STALL_TIMEOUT_MS);
    }
  }

  private scheduleStreamFlush(isErr: boolean) {
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
      return full;
    }
    const lines = this.pendingStdout.split('\n');
    let toEmit = '';
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i] ?? '';
      if (!this.tryConsumeEnvelopeLine(line)) {
        if (line.trim().length > 0) this._lastParsedEnvelope = null;
        toEmit += `${line}\n`;
      }
    }
    const trailing = lines[lines.length - 1] ?? '';
    if (trailing.length > 0 && !trailing.trimStart().startsWith('{')) {
      if (trailing.trim().length > 0) this._lastParsedEnvelope = null;
      this.pendingStdout = '';
      return `${toEmit}${trailing}`;
    }
    this.pendingStdout = trailing;
    return toEmit;
  }

  private tryConsumeEnvelopeLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isEnvelopeObject(parsed)) { this._lastParsedEnvelope = parsed; return true; }
    } catch { /* ignore non-JSON envelope line */ }
    return false;
  }

  private enforceBufferLimits(): boolean {
    if (this.payload.maxBuffer !== undefined) {
      const totalLen = this.streamManager.getBufferedLength(false) + this.streamManager.getBufferedLength(true);
      if (totalLen > this.payload.maxBuffer) {
        this.aborted = true;
        this.onMaxBuffer(`Output exceeded maxBuffer of ${this.payload.maxBuffer} bytes.`);
        return false;
      }
      return true;
    }
    if (this.payload.truncateOutputLength !== undefined) return true;
    const outMax = this.payload.stdoutFile ? INFINITE_MAX_BUFFER : DEFAULT_MAX_BUFFER;
    const errMax = this.payload.stderrFile ? INFINITE_MAX_BUFFER : DEFAULT_MAX_BUFFER;
    const combinedMax = (this.payload.stdoutFile || this.payload.stderrFile) ? (outMax + errMax) : DEFAULT_MAX_BUFFER;
    const outLen = this.streamManager.getBufferedLength(false);
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

  private processData(isErr: boolean, data: Buffer) {
    if (this.aborted) return;
    this._lastDataTime = Date.now();
    let decoded = isErr ? this.stderrDecoder.write(data) : this.stdoutDecoder.write(data);
    if (!isErr && this.payload.expectJsonEnvelope) {
      decoded = this.processEnvelopeStreaming(decoded);
    }
    if (isErr) {
      this._stderrTail = appendOutputTail(this._stderrTail, decoded);
    } else {
      this._stdoutTail = appendOutputTail(this._stdoutTail, decoded);
      if (this.payload.expectJsonEnvelope) {
        const parsed = parseEnvelopeFromTail(this.pendingStdout || this._stdoutTail);
        if (parsed) this._lastParsedEnvelope = parsed;
      }
    }
    this.evaluatePromptStall();
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

  private processEnd(isErr: boolean) {
    if (this.aborted) return;
    let decoded = isErr ? this.stderrDecoder.end() : this.stdoutDecoder.end();
    if (!isErr) {
      decoded = this.finalizeStdout(decoded);
      this._stdoutTail = appendOutputTail(this._stdoutTail, decoded);
    }
    let str = this.streamManager.processChunk(isErr, decoded);
    str += this.streamManager.flushChunk(isErr);
    if (str) {
      this.streamManager.addLength(isErr, str.length);
      this.streamManager.writeData(isErr, str, this.payload.stdoutFile, this.payload.stderrFile);
    }
  }

  private bindStdout() {
    if (this.child.stdout) {
      this.child.stdout.on('data', (data: Buffer) => this.processData(false, data));
      this.child.stdout.on('end', () => this.processEnd(false));
    }
  }

  private bindStderr() {
    if (this.child.stderr) {
      this.child.stderr.on('data', (data: Buffer) => this.processData(true, data));
      this.child.stderr.on('end', () => this.processEnd(true));
    }
  }

  public flushAll() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    if (this.promptStallTimer) clearTimeout(this.promptStallTimer);
    if (this.stdoutFlushTimer) clearTimeout(this.stdoutFlushTimer);
    if (this.stderrFlushTimer) clearTimeout(this.stderrFlushTimer);

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
    const hasWebhook = [this.payload.stdoutFile, this.payload.stderrFile]
      .some((f) => {
        if (typeof f !== 'string') return false;
        const expanded = replaceIntegrationContext(f, this.payload);
        return expanded.startsWith('http://') || expanded.startsWith('https://');
      });
    const timeoutMs = hasWebhook
      ? Math.min(Math.max(2000, (this.payload.webhookTimeoutMs ?? 5000) + 500), 15000)
      : 2000;
    await closeStreamsWithTimeout([this.outStream, this.errStream], timeoutMs);
  }

  public destroyStreams() {
    this.aborted = true;
    if (this.child.stdout) this.child.stdout.destroy();
    if (this.child.stderr) this.child.stderr.destroy();
    if (this.child.stdin) this.child.stdin.destroy();
  }
}
