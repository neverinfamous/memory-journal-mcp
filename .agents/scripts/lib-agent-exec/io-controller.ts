import * as fs from 'node:fs';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { StreamManager } from './stream-manager.js';
import { checkPrompt } from './prompt-detector.js';
import { ExecPayload, JsonEnvelopeSchema } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';

const STDIN_CHUNK_SIZE = 64 * 1024;
const WEBHOOK_FLUSH_INTERVAL_MS = 100;
const PROMPT_STALL_TIMEOUT_MS = 2000;
const TAIL_MAX_LENGTH = 2048;
const TAIL_TRIM_LENGTH = 1024;
const FLUSH_TIMEOUT_MS = 200;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const INFINITE_MAX_BUFFER = 1024 * 1024 * 1024;
const PENDING_STDOUT_LIMIT = 1024 * 1024;

function isEnvelopeObject(obj: unknown): obj is Record<string, unknown> {
  return JsonEnvelopeSchema.safeParse(obj).success;
}

export class IOController {
  private stdoutDecoder = new StringDecoder('utf8');
  private stderrDecoder = new StringDecoder('utf8');
  private _stdoutTail = '';
  private _stderrTail = '';
  private _lastParsedEnvelope: Record<string, unknown> | null = null;
  private pendingStdout = '';
  
  public get stdoutTail() { return this._stdoutTail; }
  public get stderrTail() { return this._stderrTail; }
  
  public getParsedEnvelope(): Record<string, unknown> | null {
    if (!this.payload.expectJsonEnvelope) return null;
    
    const current = this.parseEnvelopeFromTail(this.pendingStdout || this._stdoutTail);
    if (current) return current;
    
    return this._lastParsedEnvelope;
  }
  
  private extractEnvelope(tail: string): { parsed: Record<string, unknown>, start: number, end: number } | null {
    let braceCount = 0;
    let startIdx = -1;
    let inString = false;
    let escape = false;
    let lastValidEnvelope: { parsed: Record<string, unknown>, start: number, end: number } | null = null;

    for (let i = 0; i < tail.length; i++) {
      const char = tail[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') {
          if (braceCount === 0) startIdx = i;
          braceCount++;
        } else if (char === '}') {
          if (braceCount > 0) {
            braceCount--;
            if (braceCount === 0 && startIdx !== -1) {
              try {
                const candidate = tail.slice(startIdx, i + 1);
                const parsed: unknown = JSON.parse(candidate);
                if (isEnvelopeObject(parsed)) {
                  lastValidEnvelope = { parsed, start: startIdx, end: i + 1 };
                }
              } catch {
                // Ignore parse errors
              }
              startIdx = -1;
            }
          }
        }
      }
    }
    return lastValidEnvelope;
  }

  private parseEnvelopeFromTail(tailStr: string): Record<string, unknown> | null {
    if (!tailStr) return null;
    const tail = tailStr.trim();
    if (tail.length === 0) return null;
    
    const result = this.extractEnvelope(tail);
    return result ? result.parsed : null;
  }
  
  private finalizeStdout(decoded: string): string {
    if (!this.payload.expectJsonEnvelope) return decoded;
    this.pendingStdout += decoded;
    
    if (this.pendingStdout.length > PENDING_STDOUT_LIMIT) {
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
    
    const result = this.extractEnvelope(tail);
    if (result) {
       this._lastParsedEnvelope = result.parsed;
       const envString = tail.slice(result.start, result.end);
       const idx = this.pendingStdout.lastIndexOf(envString);
       if (idx !== -1) {
          const beforeEnv = this.pendingStdout.slice(0, idx);
          const afterEnv = this.pendingStdout.slice(idx + envString.length);
          if (afterEnv.trim().length === 0) {
             this.pendingStdout = beforeEnv;
          } else {
             this.pendingStdout = beforeEnv + afterEnv;
          }
          if (this.pendingStdout.length > 0 && !this.pendingStdout.endsWith('\n')) {
             this.pendingStdout += '\n';
          }
       }
    }
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
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        let buffer: Buffer[] = [];
        let timer: NodeJS.Timeout | null = null;
        const inFlightReqs: Set<Promise<void>> = new Set();
        
        const sendChunk = (data: Buffer) => {
          const method = this.payload.webhookMethod || 'POST';
          const headers: Record<string, string> = { ...this.payload.webhookHeaders };
          let bodyPayload: BodyInit = new Blob([new Uint8Array(data)]);

          if (this.payload.webhookPayloadTemplate) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            const chunkStr = data.toString('utf8');
            const vars = {
              stdout: chunkStr,
              stderr: chunkStr,
              success: true,
              code: null,
              signal: null
            };
            bodyPayload = renderWebhookTemplate(
              this.payload.webhookPayloadTemplate, 
              'integrationContext' in this.payload ? this.payload.integrationContext : null, 
              vars
            );
          }
          const fetchOptions: RequestInit = { method, headers };
          if (method !== 'GET') {
            fetchOptions.body = bodyPayload;
          }
          const timeoutMs = this.payload.webhookTimeoutMs ?? 5000;
          if (timeoutMs > 0) {
            fetchOptions.signal = AbortSignal.timeout(timeoutMs);
          }
          const req = fetch(filePath, fetchOptions).then(res => res.arrayBuffer()).then(() => {}).catch(() => {});
          inFlightReqs.add(req);
          req.finally(() => inFlightReqs.delete(req));
          return req;
        };

        return new Writable({
          write(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
            buffer.push(chunk);
            if (!timer) {
              timer = setTimeout(() => {
                const data = Buffer.concat(buffer);
                buffer = [];
                timer = null;
                sendChunk(data);
              }, WEBHOOK_FLUSH_INTERVAL_MS);
            }
            callback();
          },
          final(callback) {
            const finish = () => {
              if (buffer.length > 0) {
                const data = Buffer.concat(buffer);
                buffer = [];
                if (timer) clearTimeout(timer);
                sendChunk(data).finally(() => callback());
              } else {
                callback();
              }
            };

            if (inFlightReqs.size > 0) {
              Promise.all(Array.from(inFlightReqs)).finally(finish);
            } else {
              finish();
            }
          }
        });
      }
      const outPath = path.resolve(this.cwd, filePath);
      ensureDir(outPath);
      return fs.createWriteStream(outPath);
    };

    if (this.payload.stdoutFile) {
      try {
        this.outStream = getStream(this.payload.stdoutFile);
        this.outStream.on('error', (err) => {
          if (!this.isJson) console.error(`❌ STDOUT File Stream Error: ${err.message}. Agent execution will continue, but output capturing to file may be incomplete.`);
          this.outStream?.destroy();
        });
        if (!this.isJson) console.error(`\n✅ STDOUT successfully streaming to ${this.payload.stdoutFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isJson) console.error(`❌ STDOUT File Setup Error: ${msg}. Output will not be captured to file.`);
      }
    }
    if (this.payload.stderrFile) {
      try {
        this.errStream = getStream(this.payload.stderrFile);
        this.errStream.on('error', (err) => {
          if (!this.isJson) console.error(`❌ STDERR File Stream Error: ${err.message}. Agent execution will continue, but output capturing to file may be incomplete.`);
          this.errStream?.destroy();
        });
        if (!this.isJson) console.error(`\n✅ STDERR successfully streaming to ${this.payload.stderrFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isJson) console.error(`❌ STDERR File Setup Error: ${msg}. Output will not be captured to file.`);
      }
    }

    // Re-initialize stream manager with the correct streams
    this.streamManager = new StreamManager(this.payload.truncateOutputLength, this.outStream, this.errStream, this.isJson);
  }

  private setupStdin() {
    const input = this.payload.stdin;
    if (input && this.child.stdin) {
      this.child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE' || err.code === 'EOF' || err.code === 'ECONNRESET') {
          this.isStdinBroken = true;
          try { this.child.stdin!.destroy(); } catch { /* ignore */ }
        } else {
          console.error(`❌ STDIN Stream Error:`, err);
        }
      });

      const inputBuffer = Buffer.from(input, 'utf8');
      const chunkSize = STDIN_CHUNK_SIZE;
      let offset = 0;
      
      const writeNextChunk = () => {
        const stdin = this.child.stdin;
        if (!stdin || this.isStdinBroken) return;
        let canWrite = true;
        try {
          while (offset < inputBuffer.length && canWrite && !this.isStdinBroken) {
            const chunk = inputBuffer.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            canWrite = stdin.write(chunk);
          }
          if (offset >= inputBuffer.length && !this.isStdinBroken) {
            stdin.end();
            this.isStdinClosed = true;
          }
        } catch {
          this.isStdinBroken = true;
        }
      };

      this.child.stdin.on('drain', writeNextChunk);
      writeNextChunk();
    } else if (this.child.stdin) {
      this.child.stdin.end();
      this.isStdinClosed = true;
    }
  }

  private safelyPauseAndDrain(source: NodeJS.ReadableStream | null | undefined, targets: Writable[]) {
    if (!source || targets.length === 0 || ('isPaused' in source && typeof source.isPaused === 'function' && source.isPaused())) return;
    source.pause();
    let drainCount = targets.length;
    targets.forEach(target => {
      let handled = false;
      const resumeIfDone = () => {
        if (handled) return;
        handled = true;
        target.removeListener('drain', resumeIfDone);
        target.removeListener('close', resumeIfDone);
        target.removeListener('error', resumeIfDone);
        drainCount--;
        if (drainCount === 0) source.resume();
      };
      target.once('drain', resumeIfDone);
      target.once('close', resumeIfDone);
      target.once('error', resumeIfDone);
    });
  }

  private resetStallTimer() {
    const currentStallTimeoutMs = this.payload.stallTimeoutMs ?? 0;
    if (currentStallTimeoutMs > 0) {
      if (this.stallTimer) clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        this.onStall(`Execution stalled: No output received for ${currentStallTimeoutMs}ms.`);
      }, currentStallTimeoutMs);
    }
  }

  // Uses a safer regex that matches incomplete/split ANSI TUI sequences, or just relies on the sliding window
  private hasTuiSequence(tail: string): boolean {
    const ESC = String.fromCharCode(27);
    return tail.includes(`${ESC}[?1049h`) || tail.includes(`${ESC}[?47h`) || 
           tail.includes(`${ESC}[?1047h`) || tail.includes(`${ESC}[?2004h`);
  }

  private evaluatePromptStall() {
    if (this.payload.bypassInterceptors) return;
    if (!this.payload.stdin || this.isStdinClosed) {
      if (this.hasTuiSequence(this._stdoutTail) || this.hasTuiSequence(this._stderrTail)) {
        this.onStall('Execution stalled: Process attempted to enter an interactive alternate screen buffer or TUI.');
        return;
      }

      if (this.promptStallTimer) {
        clearTimeout(this.promptStallTimer);
        this.promptStallTimer = null;
      }
      
      const isStdoutPrompt = checkPrompt(this._stdoutTail);
      const isStderrPrompt = checkPrompt(this._stderrTail);
      
      if (isStdoutPrompt || isStderrPrompt) {
        this.promptStallTimer = setTimeout(() => {
          const source = isStdoutPrompt ? 'stdout' : 'stderr';
          this.onStall(`Execution stalled: Process appears to be waiting for interactive input on ${source}.`);
        }, PROMPT_STALL_TIMEOUT_MS);
      }
    }
  }

  private scheduleStreamFlush(isErr: boolean) {
    const timer = isErr ? this.stderrFlushTimer : this.stdoutFlushTimer;
    if (timer) return;
    
    const newTimer = setTimeout(() => {
      if (isErr) this.stderrFlushTimer = null;
      else this.stdoutFlushTimer = null;
      const str = this.streamManager.flushPendingLine(isErr);
      if (str) {
        this.streamManager.addLength(isErr, str.length);
        const streamsToDrain = this.streamManager.writeData(isErr, str, this.payload.stdoutFile, this.payload.stderrFile);
        const stream = isErr ? this.child.stderr : this.child.stdout;
        this.safelyPauseAndDrain(stream, streamsToDrain);
      }
    }, FLUSH_TIMEOUT_MS);

    if (isErr) this.stderrFlushTimer = newTimer;
    else this.stdoutFlushTimer = newTimer;
  }

  private processData(isErr: boolean, data: Buffer) {
    let decoded = isErr ? this.stderrDecoder.write(data) : this.stdoutDecoder.write(data);
    
    if (!isErr && this.payload.expectJsonEnvelope) {
       this.pendingStdout += decoded;
       
       if (this.pendingStdout.length > PENDING_STDOUT_LIMIT) {
          decoded = this.pendingStdout;
          this.pendingStdout = '';
       } else {
          const lines = this.pendingStdout.split('\n');
          let toEmit = '';
          for (let i = 0; i < lines.length - 1; i++) {
             const line = lines[i];
             let isEnvelope = false;
             const trimmed = line.trim();
             if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                   const parsed = JSON.parse(trimmed);
                   if (isEnvelopeObject(parsed)) {
                      isEnvelope = true;
                      this._lastParsedEnvelope = parsed;
                   }
                } catch { /* ignore */ }
             }
             if (!isEnvelope) {
                toEmit += line + '\n';
             }
          }
          this.pendingStdout = lines[lines.length - 1];
          if (this.pendingStdout.length > 0 && !this.pendingStdout.trimStart().startsWith('{')) {
             toEmit += this.pendingStdout;
             this.pendingStdout = '';
          }
          decoded = toEmit;
       }
    }

    // Robust sliding window for ANSI checking
    if (isErr) {
      this._stderrTail += decoded;
      if (this._stderrTail.length > TAIL_MAX_LENGTH) this._stderrTail = this._stderrTail.slice(-TAIL_TRIM_LENGTH);
    } else {
      this._stdoutTail += decoded;
      if (this.payload.expectJsonEnvelope) {
         const parsed = this.parseEnvelopeFromTail(this.pendingStdout || this._stdoutTail);
         if (parsed) {
            this._lastParsedEnvelope = parsed;
         }
      }
      if (this._stdoutTail.length > TAIL_MAX_LENGTH) this._stdoutTail = this._stdoutTail.slice(-TAIL_TRIM_LENGTH);
    }

    this.evaluatePromptStall();
    this.resetStallTimer();
    this.scheduleStreamFlush(isErr);

    const str = this.streamManager.processChunk(isErr, decoded);
    this.streamManager.addLength(isErr, str.length);
    
    if (this.payload.maxBuffer !== undefined) {
      if ((this.streamManager.getBufferedLength(false) + this.streamManager.getBufferedLength(true)) > this.payload.maxBuffer) {
         this.onMaxBuffer(`Output exceeded maxBuffer of ${this.payload.maxBuffer} bytes.`);
         return;
      }
    } else {
      const stdoutMaxBuffer = this.payload.stdoutFile ? INFINITE_MAX_BUFFER : (this.payload.truncateOutputLength !== undefined ? Infinity : DEFAULT_MAX_BUFFER);
      const stderrMaxBuffer = this.payload.stderrFile ? INFINITE_MAX_BUFFER : (this.payload.truncateOutputLength !== undefined ? Infinity : DEFAULT_MAX_BUFFER);
      
      const combinedMaxBuffer = this.payload.truncateOutputLength !== undefined ? Infinity :
                              (this.payload.stdoutFile || this.payload.stderrFile) ? (stdoutMaxBuffer + stderrMaxBuffer) 
                              : DEFAULT_MAX_BUFFER;

      if (this.streamManager.getBufferedLength(false) > stdoutMaxBuffer) {
         this.onMaxBuffer(`Output exceeded maxBuffer of ${stdoutMaxBuffer} bytes.`);
         return;
      }
      if (this.streamManager.getBufferedLength(true) > stderrMaxBuffer) {
         this.onMaxBuffer(`Output exceeded maxBuffer of ${stderrMaxBuffer} bytes.`);
         return;
      }
      if ((this.streamManager.getBufferedLength(false) + this.streamManager.getBufferedLength(true)) > combinedMaxBuffer) {
         this.onMaxBuffer(`Output exceeded maxBuffer of ${combinedMaxBuffer} bytes.`);
         return;
      }
    }
    
    const streamsToDrain = this.streamManager.writeData(isErr, str, this.payload.stdoutFile, this.payload.stderrFile);
    const stream = isErr ? this.child.stderr : this.child.stdout;
    if (streamsToDrain.length > 0 && stream) {
       this.safelyPauseAndDrain(stream, streamsToDrain);
    }
  }

  private processEnd(isErr: boolean) {
    let decoded = isErr ? this.stderrDecoder.end() : this.stdoutDecoder.end();
    if (!isErr) {
      decoded = this.finalizeStdout(decoded);
      this._stdoutTail += decoded;
      if (this._stdoutTail.length > TAIL_MAX_LENGTH) this._stdoutTail = this._stdoutTail.slice(-TAIL_TRIM_LENGTH);
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
             this._stdoutTail += finalStr;
             if (this._stdoutTail.length > TAIL_MAX_LENGTH) this._stdoutTail = this._stdoutTail.slice(-TAIL_TRIM_LENGTH);
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
    const closePromises: Promise<void>[] = [];
    
    const outStream = this.outStream;
    if (outStream && !outStream.destroyed) {
      closePromises.push(new Promise(resolve => outStream.end(resolve)));
    } else if (outStream) {
      closePromises.push(Promise.resolve());
    }
    
    const errStream = this.errStream;
    if (errStream && !errStream.destroyed) {
      closePromises.push(new Promise(resolve => errStream.end(resolve)));
    } else if (errStream) {
      closePromises.push(Promise.resolve());
    }

    try {
      let timeoutId: NodeJS.Timeout;
      await Promise.race([
        Promise.all(closePromises),
        new Promise(resolve => { timeoutId = setTimeout(resolve, 2000); })
      ]);
      clearTimeout(timeoutId!);
    } catch { /* ignore */ }
  }

  public destroyStreams() {
    if (this.child.stdout) this.child.stdout.destroy();
    if (this.child.stderr) this.child.stderr.destroy();
    if (this.child.stdin) this.child.stdin.destroy();
  }
}
