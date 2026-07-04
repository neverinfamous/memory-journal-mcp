import { test, expect, describe } from 'bun:test';
import { parseGitRecord, processBatch } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/parser.ts';
import { FIELD_SEPARATOR } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-runner.ts';
import { extractIssues } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/parser-utils.ts';
import { initCache, closeCache } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/cache.ts';

function createMockCommit(sha: string, type: string, scope: string, subject: string, body: string, files: string[], trailers: string[]) {
  const authorName = 'Test Author';
  const authorEmail = 'test@test.com';
  const date = new Date().toISOString();
  
  const rawTrailers = trailers.join('\x1C');
  const exactTrailerBlock = trailers.join('\n');
  
  const filesBlock = files.join('\x00') + '\x00';
  const parentsAndFiles = 'parent1 parent2\n' + filesBlock;
  
  const parts = [
    sha,
    'HEAD -> main',
    authorName,
    authorEmail,
    date,
    authorName,
    authorEmail,
    date,
    `${type}${scope ? '(' + scope + ')' : ''}: ${subject}`,
    body,
    exactTrailerBlock,
    rawTrailers,
    parentsAndFiles
  ];
  return parts.join(FIELD_SEPARATOR);
}

describe('lib-git-history Robustness and State Bleeding Tests', () => {

  test('parseGitRecord: statelessness across iterations', () => {
    const recordStr1 = createMockCommit('sha1', 'feat', 'core', 'add thing', 'body 1', ['M\x00file1.ts'], []);
    const recordStr2 = createMockCommit('sha2', 'fix', 'ui', 'fix thing', 'body 2', ['A\x00file2.ts'], ['History-Category: UI']);
    
    const args = {};
    const result1 = parseGitRecord(recordStr1, args);
    const result2 = parseGitRecord(recordStr2, args);
    
    expect(result1?.sha).toBe('sha1');
    expect(result1?.type).toBe('feat');
    expect(result1?.scope).toBe('core');
    expect(result1?.metadataObj.category).toBeUndefined();
    
    expect(result2?.sha).toBe('sha2');
    expect(result2?.type).toBe('fix');
    expect(result2?.scope).toBe('ui');
    expect(result2?.metadataObj.category).toEqual(['UI']);
    
    const result1_repeat = parseGitRecord(recordStr1, args);
    expect(result1_repeat).toEqual(result1);
  });

  test('parseGitRecord: massive iterations do not leak memory', () => {
    const records = [];
    for (let i = 0; i < 500; i++) {
      records.push(createMockCommit(`sha${i}`, 'perf', `scope${i}`, `subject ${i}`, `body ${i}`, [`M\x00file${i}.ts`], []));
    }
    
    for (const r of records) parseGitRecord(r, {});
    
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    
    for (let iter = 0; iter < 50; iter++) {
      for (const r of records) {
        parseGitRecord(r, {});
      }
    }
    
    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;
    
    const leakMB = (memAfter - memBefore) / 1024 / 1024;
    expect(leakMB).toBeLessThan(10); 
  });

  test('processBatch: no mutation of passed raw items', async () => {
    const rawRecordStr = createMockCommit('sha-mut', 'feat', '', 'no mutation', 'body text\n\n\nmore text', ['M\x00index.ts'], []);
    const rawObj = parseGitRecord(rawRecordStr, {});
    expect(rawObj).not.toBeNull();
    
    const cloneObj = JSON.parse(JSON.stringify(rawObj));
    
    const entries = await processBatch([rawObj!], {}, []);
    expect(entries.length).toBe(1);
    
    expect(JSON.parse(JSON.stringify(rawObj))).toEqual(cloneObj);
  });

  test('extractIssues: regex state bleed check', () => {
    const issuesMap1 = new Map<string, string | null>();
    extractIssues('fixes #123', issuesMap1);
    expect(issuesMap1.get('#123')).toBe('fixes');
    
    const issuesMap2 = new Map<string, string | null>();
    extractIssues('closes #456', issuesMap2);
    expect(issuesMap2.get('#456')).toBe('closes');
    expect(issuesMap2.has('#123')).toBe(false);
  });

  test('Cache: singleton db persistence and cleanup', () => {
    const db1 = initCache(':memory:');
    const db2 = initCache(':memory:');
    expect(db1).toBe(db2);
    closeCache();
  });
});


