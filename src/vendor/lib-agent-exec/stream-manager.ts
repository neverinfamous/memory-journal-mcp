// @ts-nocheck
import { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const BEL = String.fromCharCode(7);
const ANSI_REGEX_K0 = new RegExp(`${ESC}\\[[0]?K`, 'g');
const ANSI_REGEX_K2 = new RegExp(`${ESC}\\[2K`, 'g');
const ANSI_REGEX_J2 = new RegExp(`${ESC}\\[2J`, 'g');
const ANSI_REGEX_H = new RegExp(`${ESC}\\[H`, 'g');
const LONG_CSI_REGEX = new RegExp(`[${ESC}${CSI}]\\[[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]`, 'g');
const OSC_REGEX = new RegExp(`[${ESC}${CSI}]][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, 'g');
const COMPLETE_OSC_REGEX = new RegExp(`^[${ESC}${CSI}]][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`);
const COMPLETE_CSI_REGEX = new RegExp(`^(?:[${ESC}${CSI}]\\[|${CSI})[()#]*[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]`);
const DCS_START_REGEX = new RegExp(`^[${ESC}${CSI}][PX^_]`);
const DCS_COMPLETE_REGEX = new RegExp(`^[${ESC}${CSI}][PX^_].*?(?:${ESC}\\\\|\\x07)`, 's');

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
    if (!str.includes(ESC) && !str.includes(CSI)) {
      return str;
    }

    // Preserve Erase in Line/Whole Line semantics by translating them to \u001A (Substitute)
    // before stripping ANSI codes, so they can be processed dynamically in resolveCarriageReturns
    let preProcessed = str.replace(ANSI_REGEX_K0, '\u001A');
    preProcessed = preProcessed.replace(ANSI_REGEX_K2, '\r\u001A');
    preProcessed = preProcessed.replace(ANSI_REGEX_J2, '\n--- [Screen Cleared] ---\n');
    preProcessed = preProcessed.replace(ANSI_REGEX_H, '\n--- [Cursor Home] ---\n');
    
    // Node's stripVTControlCharacters restricts number length to 4 chars. Add a broad pass to catch overlong edge-cases.
    preProcessed = preProcessed.replace(LONG_CSI_REGEX, '');
    preProcessed = preProcessed.replace(OSC_REGEX, '');
    
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

  private splitIncompleteAnsiSuffix(ansiBuffer: string): { safeStr: string; remainder: string } {
    const lastEscapeIdx = Math.max(ansiBuffer.lastIndexOf('\u001b'), ansiBuffer.lastIndexOf('\u009b'));
    if (lastEscapeIdx === -1) return { safeStr: ansiBuffer, remainder: '' };

    const potentialSeq = ansiBuffer.substring(lastEscapeIdx);
    const isOsc = potentialSeq.startsWith('\u001b]') || potentialSeq.startsWith('\u009b]');
    const isCsi = potentialSeq.startsWith('\u001b[') || potentialSeq.startsWith('\u009b[');
    const incomplete =
      (isOsc && potentialSeq.length < MAX_ANSI_SEQ_LENGTH_OSC && !COMPLETE_OSC_REGEX.test(potentialSeq)) ||
      (isCsi && potentialSeq.length < MAX_ANSI_SEQ_LENGTH_CSI && !COMPLETE_CSI_REGEX.test(potentialSeq)) ||
      (potentialSeq.length < MAX_ANSI_SEQ_LENGTH_OSC && DCS_START_REGEX.test(potentialSeq) && !DCS_COMPLETE_REGEX.test(potentialSeq)) ||
      (!isOsc && !isCsi && !DCS_START_REGEX.test(potentialSeq) && !potentialSeq.startsWith('\u001b\\') && potentialSeq.length < 3);

    if (incomplete) {
      return { safeStr: ansiBuffer.substring(0, lastEscapeIdx), remainder: potentialSeq };
    }
    return { safeStr: ansiBuffer, remainder: '' };
  }

  private diffAgainstFlushed(resolved: string, flushed: string): string {
    if (resolved.startsWith(flushed)) {
      return resolved.substring(flushed.length);
    }
    const padding = ' '.repeat(Math.max(0, flushed.length - resolved.length));
    let diff = `\r${resolved}${padding}`;
    if (padding.length > 0) diff += `\r${resolved}`;
    return diff;
  }

  private resolveMergedLines(lines: readonly string[], s: StreamState): string {
    let result = '';
    for (let i = 0; i < lines.length; i++) {
      const resolved = this.resolveCarriageReturns(lines[i] ?? '');
      if (i === 0 && s.flushedResolved) {
        result += `${this.diffAgainstFlushed(resolved, s.flushedResolved)}\n`;
        s.flushedResolved = '';
      } else {
        result += `${resolved}\n`;
      }
    }
    return result;
  }

  public processChunk(isErr: boolean, data: string): string {
    const s = this.getState(isErr);
    const targetStream = isErr ? this.errStream : this.outStream;
    if (this.truncateOutputLength !== undefined && s.truncated && !targetStream) {
      return '';
    }
    s.ansiBuffer += data;
    const { safeStr, remainder } = this.splitIncompleteAnsiSuffix(s.ansiBuffer);
    s.ansiBuffer = remainder;

    const stripped = this.stripAnsi(safeStr);
    s.lineBuffer += stripped;
    if (!stripped.includes('\n') && s.lineBuffer.length <= DEFENSIVE_LINE_LIMIT) {
      return '';
    }
    if (s.lineBuffer.length > DEFENSIVE_LINE_LIMIT) {
      s.lineBuffer += '\n';
    }
    const lines = s.lineBuffer.split('\n');
    s.lineBuffer = lines.pop() ?? '';
    return lines.length === 0 ? '' : this.resolveMergedLines(lines, s);
  }

  public flushPendingLine(isErr: boolean): string {
    const s = this.getState(isErr);
    if (!s.lineBuffer) return '';
    
    const res = this.resolveCarriageReturns(s.lineBuffer);
    const toReturn = s.flushedResolved ? this.diffAgainstFlushed(res, s.flushedResolved) : res;
    
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
      toReturn = this.diffAgainstFlushed(res, s.flushedResolved);
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

    if (targetStream && !targetStream.destroyed && !targetStream.writableEnded) {
      const canWrite = targetStream.write(str);
      if (!canWrite) streamsToDrain.push(targetStream);
    }

    if (this.truncateOutputLength === undefined || this.truncateOutputLength <= 0) {
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

  public addLength(isErr: boolean, length: number): void {
    this.getState(isErr).length += length;
  }

  public getLength(isErr: boolean): number {
    return this.getState(isErr).length;
  }

  public getRawBufferedLength(isErr: boolean): number {
    const s = this.getState(isErr);
    return s.length + Math.max(0, s.lineBuffer.length - s.flushedResolved.length);
  }

  public getBufferedLength(isErr: boolean): number {
    const rawLen = this.getRawBufferedLength(isErr);
    const targetStream = isErr ? this.errStream : this.outStream;
    if (this.truncateOutputLength !== undefined && this.truncateOutputLength > 0 && !targetStream) {
      return Math.min(rawLen, this.truncateOutputLength);
    }
    return rawLen;
  }
}
