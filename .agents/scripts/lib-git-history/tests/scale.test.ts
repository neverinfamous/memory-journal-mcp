import { describe, it, expect, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

interface MockProc extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  kill: () => void;
}

mock.module('node:child_process', () => {
  return {
    spawn: () => {
      const proc = new EventEmitter() as unknown as MockProc;
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() { this.push(null); } });
      proc.killed = false;
      proc.kill = () => { proc.killed = true; };
      (globalThis as unknown as { __mockProc: MockProc }).__mockProc = proc;
      return proc;
    },
    execFileSync: () => 'HEAD'
  };
});

import { streamGitRecords, RECORD_SEPARATOR, FIELD_SEPARATOR } from '../git-runner.js';
import { parseGitRecord } from '../parser.js';
import type { CliArgs } from '../cli.js';

describe('Scale and Concurrency', () => {
  it('should handle massive stream chunking and memory exhaustion limit', async () => {
    const stream = streamGitRecords([]);
    const iterator = stream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    
    await Promise.resolve(); // allow generator to execute up to yield/await
    const proc = (globalThis as unknown as { __mockProc: MockProc }).__mockProc;
    
    // push chunks to hit 100MB limit with await to allow the loop to process
    for (let i = 0; i < 11; i++) {
      proc.stdout.push('A'.repeat(10 * 1024 * 1024));
      await new Promise(r => setImmediate(r));
    }
    
    // push the separator
    proc.stdout.push(RECORD_SEPARATOR);
    proc.stdout.push('RECORD_2');
    proc.stdout.push(RECORD_SEPARATOR);
    proc.stdout.push(null);
    proc.emit('close', 0, null);
    
    const first = await nextPromise;
    expect(first.value).toBe('RECORD_2');
  });

  it('should handle utf-8 character splits across chunks', async () => {
    const stream = streamGitRecords([]);
    const iterator = stream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    
    await Promise.resolve();
    const proc = (globalThis as unknown as { __mockProc: MockProc }).__mockProc;
    
    const starBuf = Buffer.from('🌟');
    const part1 = starBuf.subarray(0, 2);
    const part2 = starBuf.subarray(2);
    
    proc.stdout.push(part1);
    proc.stdout.push(part2);
    proc.stdout.push(Buffer.from(RECORD_SEPARATOR));
    proc.stdout.push(null);
    proc.emit('close', 0, null);
    
    const first = await nextPromise;
    expect(first.value).toBe('🌟');
  });

  it('should handle split RECORD_SEPARATOR', async () => {
    const stream = streamGitRecords([]);
    const iterator = stream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    
    await Promise.resolve();
    const proc = (globalThis as unknown as { __mockProc: MockProc }).__mockProc;
    
    const sepBuf = Buffer.from(RECORD_SEPARATOR);
    proc.stdout.push('REC1');
    proc.stdout.push(sepBuf.subarray(0, 5));
    proc.stdout.push(sepBuf.subarray(5));
    proc.stdout.push('REC2');
    proc.stdout.push(RECORD_SEPARATOR);
    proc.stdout.push(null);
    proc.emit('close', 0, null);
    
    const first = await nextPromise;
    expect(first.value).toBe('REC1');
    const second = await iterator.next();
    expect(second.value).toBe('REC2');
  });

  it('parseGitRecord with malformed NUL floods', () => {
    let record = '';
    for (let i=0; i<9; i++) record += 'field' + i + FIELD_SEPARATOR;
    record += 'body' + FIELD_SEPARATOR; 
    record += 'exactTrailer' + FIELD_SEPARATOR; 
    record += 'rawTrailers' + FIELD_SEPARATOR; 
    record += 'parents\n';
    
    record += 'A\x00file1\x00';
    record += '\x00'.repeat(50); // NUL flood
    record += 'M\x00file2\x00';
    
    const parsed = parseGitRecord(record, { target: "wsl2" } as CliArgs);
    expect(parsed).not.toBeNull();
    expect(parsed!.rawFiles.length).toBe(1);
    expect(parsed!.rawFiles[0].file).toBe('file1');
  });

  it('parseGitRecord should not hang on massive subject/body', () => {
    let record = '';
    for (let i=0; i<8; i++) record += 'field' + i + FIELD_SEPARATOR;
    record += 'A'.repeat(6000) + FIELD_SEPARATOR; 
    record += 'B'.repeat(150000) + FIELD_SEPARATOR; 
    record += 'exactTrailer' + FIELD_SEPARATOR;
    record += 'rawTrailers' + FIELD_SEPARATOR;
    record += 'parents\n';
    
    const parsed = parseGitRecord(record, { target: "wsl2" } as CliArgs);
    expect(parsed).not.toBeNull();
    expect(parsed!.subject.length).toBeLessThan(6000);
    expect(parsed!.body.length).toBeLessThan(150000);
  });

  it('should throw stream error if process fails midway', async () => {
    const stream = streamGitRecords([]);
    const iterator = stream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    
    await Promise.resolve();
    const proc = (globalThis as unknown as { __mockProc: MockProc }).__mockProc;
    
    proc.stdout.push('REC1');
    proc.stdout.push(RECORD_SEPARATOR);
    
    const first = await nextPromise;
    expect(first.value).toBe('REC1');
    
    proc.emit('error', new Error('Simulated failure'));
    proc.stdout.push(null); // simulate stream closing on error
    
    await expect(iterator.next()).rejects.toThrow('Simulated failure');
  });
});


