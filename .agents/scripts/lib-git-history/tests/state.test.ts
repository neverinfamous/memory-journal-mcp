import { test, expect } from 'bun:test';
import { parseGitRecord, processBatch } from '../parser.js';
import { FIELD_SEPARATOR } from '../git-runner.js';
import type { CliArgs } from '../cli.js';

test('stale state persistence across consecutive parses in parseGitRecord', () => {
  // Record 1: Has breaking change, custom trailers, files, and issues
  const commit1 = [
    'sha1', // sha
    '', // refs
    'Author 1', // author name
    'author1@example.com', // author email
    '2023-01-01T00:00:00Z', // date
    'Committer 1', // committer name
    'committer1@example.com', // committer email
    '2023-01-01T00:00:00Z', // committer date
    'feat: adding something', // subject
    'This is the body.\n\nBREAKING CHANGE: It breaks everything.', // body
    '', // exact trailer block
    'History-Category: feature\x1CCustom-Trailer: value1\x1CFixes: #123', // trailers
    'parent1\n' + 'M\x00file1.txt\x00R100\x00old.txt\x00new.txt\x00' // files block
  ].join(FIELD_SEPARATOR);

  // Record 2: Empty/basic, no breaking changes, no trailers, no files
  const commit2 = [
    'sha2',
    '',
    'Author 2',
    'author2@example.com',
    '2023-01-02T00:00:00Z',
    'Committer 2',
    'committer2@example.com',
    '2023-01-02T00:00:00Z',
    'docs: basic update',
    'Just some docs.',
    '',
    '',
    ''
  ].join(FIELD_SEPARATOR);

  const parsed1 = parseGitRecord(commit1, { target: "wsl2" } as CliArgs);
  expect(parsed1).not.toBeNull();
  expect(parsed1!.isBreaking).toBe(true);
  expect(parsed1!.breakingChangeDescription).toBe('It breaks everything.');
  expect(parsed1!.metadataObj.customTrailers).toBeDefined();
  expect(parsed1!.metadataObj.category).toEqual(['Feature']);
  expect(parsed1!.rawFiles.length).toBeGreaterThan(0);
  expect(parsed1!.references.length).toBe(1);

  const parsed2 = parseGitRecord(commit2, { target: "wsl2" } as CliArgs);
  expect(parsed2).not.toBeNull();
  expect(parsed2!.isBreaking).toBe(false);
  expect(parsed2!.breakingChangeDescription).toBeUndefined();
  expect(parsed2!.metadataObj.customTrailers).toBeUndefined();
  expect(parsed2!.metadataObj.category).toBeUndefined();
  expect(parsed2!.rawFiles.length).toBe(0);
  expect(parsed2!.references.length).toBe(0);
});

test('processBatch state leakage between chunks', async () => {
  const batch = [
    {
      sha: 'sha1', parents: [], refs: [], tags: [], authorName: 'A1', authorEmail: 'a1@x.com', date: '2023-01-01T00:00:00Z',
      committerName: 'C1', committerEmail: 'c1@x.com', committerDate: '2023-01-01T00:00:00Z',
      subject: 'feat: break', body: 'body', cleanSubject: 'break', type: 'feat', scope: undefined,
      isBreaking: true, breakingChangeDescription: 'break!', isRevert: false, revertedCommit: undefined,
      rawFiles: [{status: 'M', file: 'f1.ts'}], trailersObj: Object.create(null), metadataObj: { impact: 0.8 }, references: [], coAuthors: [], reviewers: [],
      issuesMap: new Map([['#1', 'fixes']]), trueFileCount: 1
    },
    {
      sha: 'sha2', parents: [], refs: [], tags: [], authorName: 'A2', authorEmail: 'a2@x.com', date: '2023-01-02T00:00:00Z',
      committerName: 'C2', committerEmail: 'c2@x.com', committerDate: '2023-01-02T00:00:00Z',
      subject: 'docs: basic', body: 'body2', cleanSubject: 'basic', type: 'docs', scope: undefined,
      isBreaking: false, breakingChangeDescription: undefined, isRevert: false, revertedCommit: undefined,
      rawFiles: [], trailersObj: Object.create(null), metadataObj: {}, references: [], coAuthors: [], reviewers: [],
      issuesMap: new Map(), trueFileCount: 0
    }
  ];

  const processed = await processBatch(batch, { target: "wsl2" } as CliArgs, []);
  expect(processed.length).toBe(2);
  expect(processed[0].isBreaking).toBe(true);
  expect(processed[0].totalInsertions).toBe(0);
  
  expect(processed[1].isBreaking).toBeUndefined();
  expect(processed[1].breakingChangeDescription).toBeUndefined();
  expect(processed[1].files).toBeUndefined();
});


