import { test, expect, mock, describe } from 'bun:test';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

let mockStdout: PassThrough;
let mockStderr: PassThrough;
let mockProc: EventEmitter;

mock.module('node:child_process', () => {
  return {
    spawn: (..._args: unknown[]) => {
      mockProc = new EventEmitter();
      mockStdout = new PassThrough();
      mockStderr = new PassThrough();
      const mp = mockProc as unknown as { stdout: unknown; stderr: unknown; killed: boolean; kill: () => void };
      mp.stdout = mockStdout;
      mp.stderr = mockStderr;
      mp.killed = false;
      mp.kill = () => { mp.killed = true; };
      return mockProc;
    },
    execFileSync: () => 'HEAD',
  };
});

import { streamGitRecords, RECORD_SEPARATOR, FIELD_SEPARATOR } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-runner.ts';
import { parseGitRecord } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/parser.ts';

describe('lib-git-history stream and parse scaling tests', () => {
  test('massive diff payloads - stream buffering drops >100MB records', async () => {
    const generator = streamGitRecords([]);
    const firstPromise = generator.next(); // Trigger spawn
    await new Promise(r => setTimeout(r, 0));
    
    // Write 110MB in chunks to simulate massive diff
    const chunk1 = 'A'.repeat(60 * 1024 * 1024);
    const chunk2 = 'B'.repeat(50 * 1024 * 1024);
    
    mockStdout.write(chunk1);
    mockStdout.write(chunk2);
    mockStdout.write(RECORD_SEPARATOR);
    mockStdout.write('VALID_RECORD' + RECORD_SEPARATOR);
    mockStdout.end();
    mockProc.emit('close', 0, null);

    const first = await firstPromise;
    const records = [];
    if (!first.done) records.push(first.value);
    
    for await (const r of generator) {
      records.push(r);
    }
    
    expect(records.length).toBe(1);
    expect(records[0]).toBe('VALID_RECORD');
  });

  test('stream chunking boundaries - separator split across chunks', async () => {
    const generator = streamGitRecords([]);
    const firstPromise = generator.next(); // Trigger spawn
    await new Promise(r => setTimeout(r, 0));
    
    const part1 = RECORD_SEPARATOR.slice(0, 10);
    const part2 = RECORD_SEPARATOR.slice(10);

    mockStdout.write('REC1' + part1);
    
    setTimeout(() => {
      mockStdout.write(part2);
      mockStdout.write('REC2' + RECORD_SEPARATOR);
      mockStdout.end();
      mockProc.emit('close', 0, null);
    }, 50);

    const first = await firstPromise;
    const records = [];
    if (!first.done) records.push(first.value);
    
    for await (const r of generator) {
      records.push(r);
    }
    
    expect(records).toEqual(['REC1', 'REC2']);
  });

  test('async race conditions - concurrent streaming', async () => {
    const generator = streamGitRecords([]);
    const firstPromise = generator.next(); // Trigger spawn
    await new Promise(r => setTimeout(r, 0));
    
    for (let i = 0; i < 5000; i++) {
       mockStdout.write(`R${i}${RECORD_SEPARATOR}`);
    }
    mockStdout.end();
    mockProc.emit('close', 0, null);

    const first = await firstPromise;
    const records = [];
    if (!first.done) records.push(first.value);
    
    for await (const r of generator) {
      records.push(r);
    }
    expect(records.length).toBe(5000);
    expect(records[0]).toBe('R0');
    expect(records[4999]).toBe('R4999');
  });

  test('parser handles missing files/malformed NULs in massive diffs', () => {
    // Generate a payload with 10,000 files to test maxFilesPerCommit cap and parsing stability
    let filesBlock = '';
    for (let i = 0; i < 10000; i++) {
      filesBlock += `M\x00src/file_${i}.ts\x00`;
    }

    const commitBlock = [
      'sha123', 'HEAD -> main', 'Author Name', 'author@example.com', '2026-01-01',
      'Committer Name', 'committer@example.com', '2026-01-01', 'feat: huge commit',
      'body goes here', '', '', `parents123\n${filesBlock}`
    ].join(FIELD_SEPARATOR);

    const args = {} as unknown as Record<string, unknown>;
    const result = parseGitRecord(commitBlock, args);
    
    expect(result).not.toBeNull();
    // In parseGitRecord, it breaks parsing after 500 files.
    expect(result!.rawFiles.length).toBe(500);
  });
});



