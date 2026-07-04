import { test, expect, mock } from 'bun:test';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { CliArgs } from '../cli.js';
import type { RawCommitBatchItem } from '../parser.js';

mock.module('node:child_process', () => {
  return {
    spawn: (cmd: string, args: string[], _options: unknown): ChildProcess => {
      const proc = new EventEmitter() as ChildProcess;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      Object.defineProperty(proc, 'stdout', { value: stdout });
      Object.defineProperty(proc, 'stderr', { value: stderr });
      Object.defineProperty(proc, 'kill', { value: () => { Object.defineProperty(proc, 'killed', { value: true }); return true; } });
      Object.defineProperty(proc, 'killed', { value: false, writable: true });
      
      setTimeout(() => {
        import('../git-runner.js').then(({ RECORD_SEPARATOR, FIELD_SEPARATOR }) => {
          if (args.includes('--mock-massive')) {
            const chunk = 'a'.repeat(101 * 1024 * 1024); // 101 MB
            stdout.write(chunk);
            stdout.write(RECORD_SEPARATOR);
            stdout.end();
          } else if (args.includes('--mock-chunking')) {
            const record = [
              'sha1', '', 'Author', 'email', 'date', 'Committer', 'cemail', 'cdate', 'Subject', 'Body', 'trailer', 'raw', 'parents\n'
            ].join(FIELD_SEPARATOR) + RECORD_SEPARATOR;
            
            let i = 0;
            const writeNext = () => {
              if (i < record.length) {
                const chunkSize = Math.floor(Math.random() * 5) + 1;
                stdout.write(record.slice(i, i + chunkSize));
                i += chunkSize;
                setTimeout(writeNext, 1);
              } else {
                stdout.end();
              }
            };
            writeNext();
          } else {
            stdout.end();
          }
        }).catch(() => {});
        
        setTimeout(() => proc.emit('close', 0, null), 100);
      }, 10);
      
      return proc;
    },
    execFileSync: () => {
      return 'mocked';
    }
  };
});

import { parseGitRecord, processBatch } from '../parser.js';
import { streamGitRecords, FIELD_SEPARATOR } from '../git-runner.js';

test('parseGitRecord handles massive body without OOM', () => {
  const massiveBody = 'a'.repeat(150000);
  const commitBlock = [
    'sha1', '', 'Author', 'email', 'date', 'Committer', 'cemail', 'cdate', 'Subject', massiveBody, 'trailer', 'rawTrailers', 'parents\nM\0file.txt\0'
  ].join(FIELD_SEPARATOR);
  
  const parsed = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
  expect(parsed).not.toBeNull();
  expect(parsed!.body.length).toBeLessThan(110000);
});

test('parseGitRecord handles massive files flood without OOM', () => {
  const massiveFiles = Array.from({ length: 600 }, (_, i) => `M\0file${i}.txt\0`).join('');
  const commitBlock = [
    'sha1', '', 'Author', 'email', 'date', 'Committer', 'cemail', 'cdate', 'Subject', 'Body', 'trailer', 'rawTrailers', `parents\n${massiveFiles}`
  ].join(FIELD_SEPARATOR);
  
  const parsed = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
  expect(parsed).not.toBeNull();
  expect(parsed!.rawFiles.length).toBe(500);
});

test('parseGitRecord handles massive status string in files', () => {
  const massiveStatus = 'M'.repeat(100);
  const commitBlock = [
    'sha1', '', 'Author', 'email', 'date', 'Committer', 'cemail', 'cdate', 'Subject', 'Body', 'trailer', 'rawTrailers', `parents\n${massiveStatus}\0file.txt\0`
  ].join(FIELD_SEPARATOR);
  
  const parsed = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
  expect(parsed).not.toBeNull();
  expect(parsed!.rawFiles.length).toBe(0);
});

test('parseGitRecord handles massive subject payload', () => {
  const massiveSubject = 's'.repeat(10000);
  const commitBlock = [
    'sha1', '', 'Author', 'email', 'date', 'Committer', 'cemail', 'cdate', massiveSubject, 'Body', 'trailer', 'rawTrailers', 'parents\nM\0file.txt\0'
  ].join(FIELD_SEPARATOR);
  
  const parsed = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
  expect(parsed).not.toBeNull();
  expect(parsed!.subject.length).toBeLessThan(6000);
});

test('processBatch handles race conditions with async fetchers', async () => {
  const batch = [{
    sha: 'sha1', parents: [], refs: [], tags: [], authorName: 'A', authorEmail: 'e', date: 'd',
    committerName: 'C', committerEmail: 'ce', committerDate: 'cd', subject: 'sub', body: 'body',
    cleanSubject: 'sub', type: undefined, scope: undefined, isBreaking: false, breakingChangeDescription: undefined,
    isRevert: false, revertedCommit: undefined, rawFiles: [], metadataObj: {}, references: [],
    coAuthors: [], reviewers: [], issuesMap: new Map()
  }];
  
  const results = await Promise.all([
    processBatch(batch as unknown as RawCommitBatchItem[], { target: "wsl2" } as CliArgs, []),
    processBatch(batch as unknown as RawCommitBatchItem[], { target: "wsl2" } as CliArgs, []),
    processBatch(batch as unknown as RawCommitBatchItem[], { target: "wsl2" } as CliArgs, [])
  ]);
  
  expect(results.length).toBe(3);
  expect(results[0][0].commit).toBe('sha1');
  expect(results[1][0].commit).toBe('sha1');
  expect(results[2][0].commit).toBe('sha1');
});

test('streamGitRecords chunking boundary test', async () => {
  const stream = streamGitRecords(['--mock-chunking']);
  const records = [];
  for await (const record of stream) {
    records.push(record);
  }
  expect(records.length).toBe(1);
  expect(records[0].startsWith('sha1')).toBe(true);
}, 15000);

test('streamGitRecords massive diff payload drops correctly', async () => {
  const stream = streamGitRecords(['--mock-massive']);
  const records = [];
  for await (const record of stream) {
    records.push(record);
  }
  console.log('RECORD IS:', JSON.stringify(records[0]?.slice(0, 50))); expect(records.length).toBe(0);
});


