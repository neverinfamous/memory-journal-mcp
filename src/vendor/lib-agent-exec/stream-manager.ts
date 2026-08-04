import { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

const ESC = String.fromCharCode(27);
const ANSI_REGEX_K0 = new RegExp(`${ESC}\\[[0]?K`, 'g');
const ANSI_REGEX_K2 = new RegExp(`${ESC}\\[2K`, 'g');
const ANSI_REGEX_J2 = new RegExp(`${ESC}\\[2J`, 'g');
const ANSI_REGEX_H = new RegExp(`${ESC}\\[H`, 'g');

const DEFENSIVE_LINE_LIMIT = 2 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_LENGTH = 1024 * 1024 * 1024;
const MAX_SAFE_LINE_LENGTH = 50000;
const MAX_ANSI_SEQ_LENGTH_OSC = 2048;
const MAX_ANSI_SEQ_LENGTH_CSI = 50;

interface StreamState {
  ansiBuffer: string;
  lineBuffer: string;
  flushedResolved: string;
  length: number;
  truncated: boolean;
}

export class StreamManager {
  private state = {
    out: { ansiBuffer: '', lineBuffer: '', flushedResolved: '', length: 0, truncated: false } as StreamState,
    err: { ansiBuffer: '', lineBuffer: '', flushedResolved: '', length: 0, truncated: false } as StreamState
  };

  constructor(
    private truncateOutputLength?: number,
    private outStream?: Writable,
    private errStream?: Writable,
    private isJson: boolean = false
  ) {
    if (outStream || errStream) {
      this.truncateOutputLength = truncateOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;
    }
  }

  private getState(isErr: boolean): StreamState {
    return isErr ? this.state.err : this.state.out;
  }

  private stripAnsi(str: string): string {
    // Preserve Erase in Line/Whole Line semantics by translating them to \u001A (Substitute)
    // before stripping ANSI codes, so they can be processed dynamically in resolveCarriageReturns
    let preProcessed = str.replace(ANSI_REGEX_K0, '\u001A');
    preProcessed = preProcessed.replace(ANSI_REGEX_K2, '\r\u001A');
    preProcessed = preProcessed.replace(ANSI_REGEX_J2, '\n--- [Screen Cleared] ---\n');
    preProcessed = preProcessed.replace(ANSI_REGEX_H, '\n--- [Cursor Home] ---\n');
    
    // Node's stripVTControlCharacters restricts number length to 4 chars. Add a broad pass to catch overlong edge-cases.
    const e=String.fromCharCode(27), c=String.fromCharCode(155); const longCsi = new RegExp(`[${e}${c}]\\[[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]`, 'g');
    const osc = new RegExp(`[${e}${c}]][^\\x07${e}]*(?:\\x07|${e}\\\\)`, 'g');
    preProcessed = preProcessed.replace(longCsi, '');
    preProcessed = preProcessed.replace(osc, '');
    
    return stripVTControlCharacters(preProcessed);
  }

  private resolveCarriageReturns(str: string): string {
    if (!str.includes('\r') && !str.includes('\b') && !str.includes('\u001A')) {
      return str;
    }

    // Defensive boundary validation: prevent event loop blocking on massive lines
    if (str.length > MAX_SAFE_LINE_LENGTH) {
      const eofIdx = str.indexOf('\u001A');
      const fastStr = eofIdx !== -1 ? str.substring(0, eofIdx) : str;
      return fastStr.replace(/[\r\b]/g, '');
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
    
    return chars.join('');
  }

  public processChunk(isErr: boolean, data: string): string {
    const s = this.getState(isErr);
    s.ansiBuffer += data;
    
    let safeStr = s.ansiBuffer;
    const lastEscapeIdx = Math.max(s.ansiBuffer.lastIndexOf('\u001b'), s.ansiBuffer.lastIndexOf('\u009b'));
    
    if (lastEscapeIdx !== -1) {
      const potentialSeq = s.ansiBuffer.substring(lastEscapeIdx);
      
      if (potentialSeq.startsWith('\u001b]') || potentialSeq.startsWith('\u009b]')) {
        // eslint-disable-next-line no-control-regex
        const isComplete = /^[\u001b\u009b]][^\x07\x1b]*(?:\x07|\x1b\\)/.test(potentialSeq);
        if (!isComplete && potentialSeq.length < MAX_ANSI_SEQ_LENGTH_OSC) {
          safeStr = s.ansiBuffer.substring(0, lastEscapeIdx);
          s.ansiBuffer = potentialSeq;
        } else {
          s.ansiBuffer = '';
        }
      } else if (potentialSeq.startsWith('\u001b[') || potentialSeq.startsWith('\u009b[')) {
        // eslint-disable-next-line no-control-regex
        const isComplete = /^(?:[\u001b\u009b]\[|\u009b)[()#;?]*[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/.test(potentialSeq);
        if (!isComplete && potentialSeq.length < MAX_ANSI_SEQ_LENGTH_CSI) {
          safeStr = s.ansiBuffer.substring(0, lastEscapeIdx);
          s.ansiBuffer = potentialSeq;
        } else {
          s.ansiBuffer = '';
        }
      } else if (new RegExp('^[' + String.fromCharCode(0x1b) + String.fromCharCode(0x9b) + '][PX^_]').test(potentialSeq)) {
        const isComplete = new RegExp('^[' + String.fromCharCode(0x1b) + String.fromCharCode(0x9b) + '][PX^_].*?(?:' + String.fromCharCode(0x1b) + '\\\\|' + String.fromCharCode(0x07) + ')', 's').test(potentialSeq);
        if (!isComplete && potentialSeq.length < MAX_ANSI_SEQ_LENGTH_OSC) {
          safeStr = s.ansiBuffer.substring(0, lastEscapeIdx);
          s.ansiBuffer = potentialSeq;
        } else {
          s.ansiBuffer = '';
        }
      } else if (potentialSeq.length < 3) {
          safeStr = s.ansiBuffer.substring(0, lastEscapeIdx);
          s.ansiBuffer = potentialSeq;
      } else {
          s.ansiBuffer = '';
      }
    } else {
      s.ansiBuffer = '';
    }

    const stripped = this.stripAnsi(safeStr);
    
    s.lineBuffer += stripped;
    
    // Defensive memory limit: force a newline if the line exceeds 2MB
    if (s.lineBuffer.length > DEFENSIVE_LINE_LIMIT) {
      s.lineBuffer += '\n';
    }
    
    const lines = s.lineBuffer.split('\n');
    s.lineBuffer = lines.pop() || '';
    
    if (lines.length === 0) return '';
    
    let result = '';
    for (let i = 0; i < lines.length; i++) {
      const resolved = this.resolveCarriageReturns(lines[i]);
      if (i === 0 && s.flushedResolved) {
        if (resolved.startsWith(s.flushedResolved)) {
          result += resolved.substring(s.flushedResolved.length) + '\n';
        } else {
          const padding = ' '.repeat(Math.max(0, s.flushedResolved.length - resolved.length));
          result += '\r' + resolved + padding;
          if (padding.length > 0) {
             result += '\r' + resolved;
          }
          result += '\n';
        }
        s.flushedResolved = '';
      } else {
        result += resolved + '\n';
      }
    }
    return result;
  }

  public flushPendingLine(isErr: boolean): string {
    const s = this.getState(isErr);
    if (!s.lineBuffer) return '';
    
    const res = this.resolveCarriageReturns(s.lineBuffer);
    let toReturn: string;
    if (s.flushedResolved) {
      if (res.startsWith(s.flushedResolved)) {
        toReturn = res.substring(s.flushedResolved.length);
      } else {
        const padding = ' '.repeat(Math.max(0, s.flushedResolved.length - res.length));
        toReturn = '\r' + res + padding;
        if (padding.length > 0) {
           toReturn += '\r' + res;
        }
      }
    } else {
      toReturn = res;
    }
    
    if (toReturn) {
      s.flushedResolved = res;
    }
    return toReturn;
  }

  public flushChunk(isErr: boolean): string {
    const s = this.getState(isErr);
    const buffer = s.ansiBuffer;
    s.ansiBuffer = '';
    
    const stripped = buffer ? this.stripAnsi(buffer) : '';
    
    s.lineBuffer += stripped;
    const resLine = s.lineBuffer;
    s.lineBuffer = '';
    
    if (!resLine) return '';
    const res = this.resolveCarriageReturns(resLine);
    
    let toReturn: string;
    if (s.flushedResolved) {
      if (res.startsWith(s.flushedResolved)) {
        toReturn = res.substring(s.flushedResolved.length);
      } else {
        const padding = ' '.repeat(Math.max(0, s.flushedResolved.length - res.length));
        toReturn = '\r' + res + padding;
        if (padding.length > 0) {
           toReturn += '\r' + res;
        }
      }
      s.flushedResolved = '';
    } else {
      toReturn = res;
    }
    return toReturn;
  }

  public writeData(isErr: boolean, str: string, outFileName?: string, errFileName?: string): Writable[] {
    const streamsToDrain: Writable[] = [];
    if (!str) return streamsToDrain;

    const targetStream = isErr ? this.errStream : this.outStream;
    const stdStream = isErr ? process.stderr : process.stdout;

    if (targetStream && !targetStream.destroyed) {
      const canWrite = targetStream.write(str);
      if (!canWrite) streamsToDrain.push(targetStream);
    }

    if (!this.truncateOutputLength) {
       if (!targetStream && !this.isJson && stdStream instanceof Writable && !stdStream.destroyed) {
         const canWriteStd = stdStream.write(str);
         if (!canWriteStd) streamsToDrain.push(stdStream);
       }
       return streamsToDrain;
    }
    
    const s = this.getState(isErr);

    if (s.truncated) return streamsToDrain;

    if (s.length > this.truncateOutputLength) {
       const overage = s.length - this.truncateOutputLength;
       const allowedLength = str.length - overage;
       
       const toWrite = allowedLength > 0 ? str.substring(0, allowedLength) : "";
       const fileName = isErr ? errFileName : outFileName;
       const fileHint = fileName ? `` : ` Specify 'stdoutFile' or 'stderrFile' in the payload to capture full output.`;
       const truncMsg = `\n... [${isErr ? 'STDERR' : 'STDOUT'} truncated to ${this.truncateOutputLength} chars.${fileHint}]\n`;
       
       if (!targetStream && !this.isJson && stdStream instanceof Writable && !stdStream.destroyed) {
         const canWriteStd = stdStream.write(toWrite + truncMsg);
         if (!canWriteStd) streamsToDrain.push(stdStream);
       }
       s.truncated = true;
    } else {
       if (!targetStream && !this.isJson && stdStream instanceof Writable && !stdStream.destroyed) {
         const canWriteStd = stdStream.write(str);
         if (!canWriteStd) streamsToDrain.push(stdStream);
       }
    }

    return streamsToDrain;
  }

  public addLength(isErr: boolean, length: number) {
    this.getState(isErr).length += length;
  }

  public getLength(isErr: boolean): number {
    return this.getState(isErr).length;
  }

  public getBufferedLength(isErr: boolean): number {
    const s = this.getState(isErr);
    const rawLen = s.length + s.lineBuffer.length;
    if (this.truncateOutputLength) {
      return Math.min(rawLen, this.truncateOutputLength);
    }
    return rawLen;
  }
}
