// @ts-nocheck
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { StreamManager } from './stream-manager.js';
import { checkPrompt } from './prompt-detector.js';
import { ExecPayload } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';

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
  
  private parseEnvelopeFromTail(tailStr: string): Record<string, unknown> | null {
    if (!tailStr) return null;
    const tail = tailStr.trim();
    if (tail.length === 0) return null;
    
    let lastBrace = tail.lastIndexOf('}');
    let attempts = 0;
    while (lastBrace !== -1 && attempts < 10) {
      let firstBrace = tail.lastIndexOf('{', lastBrace);
      while (firstBrace !== -1 && attempts < 10) {
        attempts++;
        try {
          const candidate = tail.slice(firstBrace, lastBrace + 1);
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && 'status' in parsed) {
            return parsed;
          }
        } catch {
          // ignore parsing failures and keep searching backward
        }
        firstBrace = tail.lastIndexOf('{', firstBrace - 1);
      }
      lastBrace = tail.lastIndexOf('}', lastBrace - 1);
    }
    return null;
  }
  
  private finalizeStdout(decoded: string): string {
    if (!this.payload.expectJsonEnvelope) return decoded;
    this.pendingStdout += decoded;
    const tail = this.pendingStdout.trim();
    if (!tail) {
       const res = this.pendingStdout;
       this.pendingStdout = '';
       return res;
    }
    
    let lastBrace = tail.lastIndexOf('}');
    let found = false;
    let envelopeStart = -1;
    let envelopeEnd = -1;
    let attempts = 0;
    while (lastBrace !== -1 && attempts < 10) {
       let firstBrace = tail.lastIndexOf('{', lastBrace);
       while (firstBrace !== -1 && attempts < 10) {
          attempts++;
          try {
             const candidate = tail.slice(firstBrace, lastBrace + 1);
             const parsedObj = JSON.parse(candidate);
             if (parsedObj && typeof parsedObj === 'object' && 'status' in parsedObj) {
                found = true;
                envelopeStart = firstBrace;
                envelopeEnd = lastBrace + 1;
                this._lastParsedEnvelope = parsedObj;
                break;
             }
          } catch { /* ignore */ }
          firstBrace = tail.lastIndexOf('{', firstBrace - 1);
       }
       if (found) break;
       lastBrace = tail.lastIndexOf('}', lastBrace - 1);
    }
    
    if (found) {
       const envString = tail.slice(envelopeStart, envelopeEnd);
       const idx = this.pendingStdout.lastIndexOf(envString);
       if (idx !== -1) {
          this.pendingStdout = this.pendingStdout.slice(0, idx) + this.pendingStdout.slice(idx + envString.length);
          this.pendingStdout = this.pendingStdout.replace(/\s+$/, '');
          if (this.pendingStdout.length > 0) this.pendingStdout += '\n';
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
    private onMaxBuffer: (reason: string) => void
  ) {
    this.streamManager = new StreamManager(payload.truncateOutputLength, undefined, undefined);
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

        const sendChunk = (data: Buffer): Promise<void> => {
          const method = this.payload.webhookMethod || 'POST';
          const headers: Record<string, string> = { ...this.payload.webhookHeaders };
          let bodyPayload: BodyInit = data as unknown as BodyInit;

          if ('webhookPayloadTemplate' in this.payload && this.payload.webhookPayloadTemplate) {
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
          return fetch(filePath, { method, headers, body: bodyPayload }).then(() => {}).catch(() => {});
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
              }, 100);
            }
            callback();
          },
          final(callback) {
            if (buffer.length > 0) {
              const data = Buffer.concat(buffer);
              buffer = [];
              if (timer) clearTimeout(timer);
              sendChunk(data).finally(() => callback());
            } else {
              callback();
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
          console.error(`❌ STDOUT File Stream Error: ${err.message}. Agent execution will continue, but output capturing to file may be incomplete.`);
          this.outStream?.destroy();
        });
        console.error(`\n✅ STDOUT successfully streaming to ${this.payload.stdoutFile}`);
      } catch (err) {
        console.error(`❌ STDOUT File Setup Error: ${(err as Error).message}. Output will not be captured to file.`);
      }
    }
    if (this.payload.stderrFile) {
      try {
        this.errStream = getStream(this.payload.stderrFile);
        this.errStream.on('error', (err) => {
          console.error(`❌ STDERR File Stream Error: ${err.message}. Agent execution will continue, but output capturing to file may be incomplete.`);
          this.errStream?.destroy();
        });
        console.error(`\n✅ STDERR successfully streaming to ${this.payload.stderrFile}`);
      } catch (err) {
        console.error(`❌ STDERR File Setup Error: ${(err as Error).message}. Output will not be captured to file.`);
      }
    }

    // Re-initialize stream manager with the correct streams
    this.streamManager = new StreamManager(this.payload.truncateOutputLength, this.outStream, this.errStream);
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
      const chunkSize = 64 * 1024;
      let offset = 0;
      
      const writeNextChunk = () => {
        if (this.isStdinBroken) return;
        let canWrite = true;
        try {
          while (offset < inputBuffer.length && canWrite && !this.isStdinBroken) {
            const chunk = inputBuffer.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            canWrite = this.child.stdin!.write(chunk);
          }
          if (offset >= inputBuffer.length && !this.isStdinBroken) {
            this.child.stdin!.end();
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
        }, 2000);
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
    }, 200);

    if (isErr) this.stderrFlushTimer = newTimer;
    else this.stdoutFlushTimer = newTimer;
  }

  private processData(isErr: boolean, data: Buffer) {
    let decoded = isErr ? this.stderrDecoder.write(data) : this.stdoutDecoder.write(data);
    
    if (!isErr && this.payload.expectJsonEnvelope) {
       this.pendingStdout += decoded;
       const lines = this.pendingStdout.split('\n');
       let toEmit = '';
       for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          let isEnvelope = false;
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
             try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object' && 'status' in parsed) {
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

    // Robust sliding window for ANSI checking
    if (isErr) {
      this._stderrTail += decoded;
      if (this._stderrTail.length > 2048) this._stderrTail = this._stderrTail.slice(-1024);
    } else {
      this._stdoutTail += decoded;
      if (this.payload.expectJsonEnvelope) {
         const parsed = this.parseEnvelopeFromTail(this.pendingStdout || this._stdoutTail);
         if (parsed) {
            this._lastParsedEnvelope = parsed;
         }
      }
      if (this._stdoutTail.length > 2048) this._stdoutTail = this._stdoutTail.slice(-1024);
    }

    this.evaluatePromptStall();
    this.resetStallTimer();
    this.scheduleStreamFlush(isErr);

    const str = this.streamManager.processChunk(isErr, decoded);
    this.streamManager.addLength(isErr, str.length);
    
    const fileForStream = isErr ? this.payload.stderrFile : this.payload.stdoutFile;
    const defaultMaxBuffer = fileForStream ? 1024 * 1024 * 1024 : (this.payload.truncateOutputLength ? Infinity : 10 * 1024 * 1024);
    const maxBuffer = this.payload.maxBuffer ?? defaultMaxBuffer;
    
    if ((this.streamManager.getBufferedLength(false) + this.streamManager.getBufferedLength(true)) > maxBuffer) {
       this.onMaxBuffer(`Output exceeded maxBuffer of ${maxBuffer} bytes.`);
       return;
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
      if (this._stdoutTail.length > 2048) this._stdoutTail = this._stdoutTail.slice(-1024);
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
             if (this._stdoutTail.length > 2048) this._stdoutTail = this._stdoutTail.slice(-1024);
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
    if (this.outStream && !this.outStream.destroyed) {
      closePromises.push(new Promise(resolve => this.outStream!.end(resolve)));
    } else if (this.outStream) {
      closePromises.push(Promise.resolve());
    }
    
    if (this.errStream && !this.errStream.destroyed) {
      closePromises.push(new Promise(resolve => this.errStream!.end(resolve)));
    } else if (this.errStream) {
      closePromises.push(Promise.resolve());
    }

    try {
      await Promise.race([
        Promise.all(closePromises),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
    } catch { /* ignore */ }
  }

  public destroyStreams() {
    if (this.child.stdout) this.child.stdout.destroy();
    if (this.child.stderr) this.child.stderr.destroy();
    if (this.child.stdin) this.child.stdin.destroy();
  }
}
