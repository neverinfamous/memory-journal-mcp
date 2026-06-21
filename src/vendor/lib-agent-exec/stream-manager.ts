// @ts-nocheck
import fs from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

const ESC = String.fromCharCode(27);
const ANSI_REGEX_K0 = new RegExp(`${ESC}\\[[0]?K`, 'g');
const ANSI_REGEX_K2 = new RegExp(`${ESC}\\[2K`, 'g');
const ANSI_REGEX_J2 = new RegExp(`${ESC}\\[2J`, 'g');
const ANSI_REGEX_H = new RegExp(`${ESC}\\[H`, 'g');

export class StreamManager {
  private stdoutAnsiBuffer = '';
  private stderrAnsiBuffer = '';
  private stdoutLineBuffer = '';
  private stderrLineBuffer = '';
  private stdoutLength = 0;
  private stderrLength = 0;
  private stdoutTruncated = false;
  private stderrTruncated = false;

  constructor(
    private truncateOutputLength?: number,
    private outStream?: fs.WriteStream,
    private errStream?: fs.WriteStream
  ) {}

  private stripAnsi(str: string): string {
    // Preserve Erase in Line/Whole Line semantics by translating them to \u001A (Substitute)
    // before stripping ANSI codes, so they can be processed dynamically in resolveCarriageReturns
    let preProcessed = str.replace(ANSI_REGEX_K0, '\u001A');
    preProcessed = preProcessed.replace(ANSI_REGEX_K2, '\r\u001A');
    preProcessed = preProcessed.replace(ANSI_REGEX_J2, '\n--- [Screen Cleared] ---\n');
    preProcessed = preProcessed.replace(ANSI_REGEX_H, '\n--- [Cursor Home] ---\n');
    
    // Node's stripVTControlCharacters restricts number length to 4 chars. Add a broad pass to catch overlong edge-cases.
    const e=String.fromCharCode(27), c=String.fromCharCode(155); const longCsi = new RegExp(`[${e}${c}]\\[[()#;?]*[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]`, 'g');
    const osc = new RegExp(`[${e}${c}]][^\\x07${e}]*(?:\\x07|${e}\\\\)`, 'g');
    preProcessed = preProcessed.replace(longCsi, '');
    preProcessed = preProcessed.replace(osc, '');
    
    return stripVTControlCharacters(preProcessed);
  }

  private resolveCarriageReturns(str: string): string {
    let hasTrailingCr = false;
    if (str.endsWith('\r')) {
      hasTrailingCr = true;
      str = str.slice(0, -1);
    }
    
    const chars: string[] = [];
    let cursor = 0;
    
    for (const char of str) {
      if (char === '\r') {
        cursor = 0;
      } else if (char === '\b') {
        if (cursor > 0) cursor--;
      } else if (char === '\u001A') {
        // Truncate the array to erase the rest of the line
        chars.length = cursor;
      } else {
        chars[cursor] = char;
        cursor++;
      }
    }
    
    return chars.join('') + (hasTrailingCr ? '\r' : '');
  }

  public processChunk(isErr: boolean, data: string): string {
    let buffer = isErr ? this.stderrAnsiBuffer : this.stdoutAnsiBuffer;
    buffer += data;
    
    let safeStr = buffer;
    const lastEscapeIdx = Math.max(buffer.lastIndexOf('\u001b'), buffer.lastIndexOf('\u009b'));
    
    if (lastEscapeIdx !== -1) {
      const potentialSeq = buffer.substring(lastEscapeIdx);
      
      if (potentialSeq.startsWith('\u001b]') || potentialSeq.startsWith('\u009b]')) {
        // eslint-disable-next-line no-control-regex
        const isComplete = /^[\u001b\u009b]][^\x07\x1b]*(?:\x07|\x1b\\)/.test(potentialSeq);
        if (!isComplete && potentialSeq.length < 2048) {
          safeStr = buffer.substring(0, lastEscapeIdx);
          if (isErr) this.stderrAnsiBuffer = potentialSeq; else this.stdoutAnsiBuffer = potentialSeq;
        } else {
          if (isErr) this.stderrAnsiBuffer = ''; else this.stdoutAnsiBuffer = '';
        }
      } else if (potentialSeq.startsWith('\u001b[') || potentialSeq.startsWith('\u009b[')) {
        // eslint-disable-next-line no-control-regex
        const isComplete = /^(?:[\u001b\u009b]\[|\u009b)[()#;?]*[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/.test(potentialSeq);
        if (!isComplete && potentialSeq.length < 50) {
          safeStr = buffer.substring(0, lastEscapeIdx);
          if (isErr) this.stderrAnsiBuffer = potentialSeq; else this.stdoutAnsiBuffer = potentialSeq;
        } else {
          if (isErr) this.stderrAnsiBuffer = ''; else this.stdoutAnsiBuffer = '';
        }
      } else if (potentialSeq.length < 3) {
          safeStr = buffer.substring(0, lastEscapeIdx);
          if (isErr) this.stderrAnsiBuffer = potentialSeq; else this.stdoutAnsiBuffer = potentialSeq;
      } else {
          if (isErr) this.stderrAnsiBuffer = ''; else this.stdoutAnsiBuffer = '';
      }
    } else {
      if (isErr) this.stderrAnsiBuffer = ''; else this.stdoutAnsiBuffer = '';
    }

    const stripped = this.stripAnsi(safeStr);
    
    let lineBuffer = isErr ? this.stderrLineBuffer : this.stdoutLineBuffer;
    lineBuffer += stripped;
    
    // Defensive memory limit: force a newline if the line exceeds 2MB
    if (lineBuffer.length > 2 * 1024 * 1024) {
      lineBuffer += '\n';
    }
    
    const lines = lineBuffer.split('\n');
    const newLineBuffer = lines.pop() || '';
    if (isErr) this.stderrLineBuffer = newLineBuffer; else this.stdoutLineBuffer = newLineBuffer;
    
    if (lines.length === 0) return '';
    
    const resolvedLines = lines.map(line => this.resolveCarriageReturns(line));
    return resolvedLines.join('\n') + '\n';
  }

  public flushPendingLine(isErr: boolean): string {
    const lineBuffer = isErr ? this.stderrLineBuffer : this.stdoutLineBuffer;
    if (!lineBuffer) return '';
    
    if (isErr) this.stderrLineBuffer = ''; else this.stdoutLineBuffer = '';
    
    return this.resolveCarriageReturns(lineBuffer);
  }

  public flushChunk(isErr: boolean): string {
    const buffer = isErr ? this.stderrAnsiBuffer : this.stdoutAnsiBuffer;
    if (isErr) this.stderrAnsiBuffer = ''; else this.stdoutAnsiBuffer = '';
    
    const stripped = buffer ? this.stripAnsi(buffer) : '';
    
    let lineBuffer = isErr ? this.stderrLineBuffer : this.stdoutLineBuffer;
    lineBuffer += stripped;
    if (isErr) this.stderrLineBuffer = ''; else this.stdoutLineBuffer = '';
    
    if (!lineBuffer) return '';
    return this.resolveCarriageReturns(lineBuffer);
  }

  public writeData(isErr: boolean, str: string, outFileName?: string, errFileName?: string): NodeJS.WritableStream[] {
    const streamsToDrain: NodeJS.WritableStream[] = [];
    if (!str) return streamsToDrain;

    const targetStream = isErr ? this.errStream : this.outStream;
    const stdStream = isErr ? process.stderr : process.stdout;

    if (targetStream && !targetStream.destroyed) {
       const canWrite = targetStream.write(str);
       if (!canWrite) streamsToDrain.push(targetStream);
    }

    if (!this.truncateOutputLength) {
       if (!targetStream && !stdStream.destroyed) {
         const canWriteStd = stdStream.write(str);
         if (!canWriteStd) streamsToDrain.push(stdStream);
       }
       return streamsToDrain;
    }
    
    const currentLen = isErr ? this.stderrLength : this.stdoutLength;
    const isTruncated = isErr ? this.stderrTruncated : this.stdoutTruncated;

    if (isTruncated) return streamsToDrain;

    if (currentLen > this.truncateOutputLength) {
       const overage = currentLen - this.truncateOutputLength;
       const allowedLength = str.length - overage;
       
       const toWrite = allowedLength > 0 ? str.substring(0, allowedLength) : "";
       const fileName = isErr ? errFileName : outFileName;
       const fileHint = fileName ? ` Use ${fileName} to capture full output.` : ` Specify 'stdoutFile' or 'stderrFile' in the payload to capture full output.`;
       const truncMsg = `\n... [${isErr ? 'STDERR' : 'STDOUT'} truncated to ${this.truncateOutputLength} chars.${fileHint}]\n`;
       
       if (!targetStream && !stdStream.destroyed) {
         const canWriteStd = stdStream.write(toWrite + truncMsg);
         if (!canWriteStd) streamsToDrain.push(stdStream);
       }

       if (isErr) this.stderrTruncated = true; else this.stdoutTruncated = true;
    } else {
       if (!targetStream && !stdStream.destroyed) {
         const canWriteStd = stdStream.write(str);
         if (!canWriteStd) streamsToDrain.push(stdStream);
       }
    }

    return streamsToDrain;
  }

  public addLength(isErr: boolean, length: number) {
    if (isErr) this.stderrLength += length;
    else this.stdoutLength += length;
  }

  public getLength(isErr: boolean): number {
    return isErr ? this.stderrLength : this.stdoutLength;
  }
}
