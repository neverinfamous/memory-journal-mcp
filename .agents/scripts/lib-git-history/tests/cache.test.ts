import { expect, test, describe, beforeAll, beforeEach, afterAll } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { initCache, insertCommits, queryCommits, closeCache } from '../cache.js';
import type { CommitEntry } from '../schema.js';

import * as os from 'node:os';

const testDbPath = join(os.tmpdir(), `test-git-history-${Date.now()}.db`);

describe('Git History Cache Layer', () => {
  beforeAll(() => {
    // Ensure clean state
    try { rmSync(testDbPath); } catch { /* ignore */ }
    try { rmSync(`${testDbPath}-shm`); } catch { /* ignore */ }
    try { rmSync(`${testDbPath}-wal`); } catch { /* ignore */ }
    
    initCache(testDbPath);
  });

  beforeEach(() => {
    const db = initCache(testDbPath);
    db.exec('DELETE FROM commits');
  });

  afterAll(() => {
    closeCache();
    try { rmSync(testDbPath); } catch { /* ignore */ }
    try { rmSync(`${testDbPath}-shm`); } catch { /* ignore */ }
    try { rmSync(`${testDbPath}-wal`); } catch { /* ignore */ }
  });

  test('should insert and query commits correctly', () => {
    const mockCommit: CommitEntry = {
      commit: 'a1b2c3d4e5f6g7h8i9j0',
      author: 'Test Author',
      date: '2026-06-21T00:00:00Z',
      subject: 'feat(cache): implement sqlite cache',
      type: 'feat',
      scope: 'cache',
      isBreaking: true,
      files: [{ status: 'A', file: 'cache.ts' }],
      metadata: { validation: 'passed' }
    };

    insertCommits([mockCommit]);

    // Query by commit hash
    const results = queryCommits({ commit: mockCommit.commit });
    expect(results).toHaveLength(1);
    
    const retrieved = results[0];
    expect(retrieved.commit).toBe(mockCommit.commit);
    expect(retrieved.author).toBe(mockCommit.author);
    expect(retrieved.type).toBe(mockCommit.type);
    expect(retrieved.scope).toBe(mockCommit.scope);
    expect(retrieved.files).toEqual(mockCommit.files);
    expect(retrieved.metadata).toEqual(mockCommit.metadata);
    expect(retrieved.isBreaking).toBe(true);
  });
  
  test('should handle filtering by type and scope', () => {
    const commits: CommitEntry[] = [
      {
        commit: 'hash1',
        author: 'Author A',
        date: 'date1',
        subject: 'fix(core): bug',
        type: 'fix',
        scope: 'core'
      },
      {
        commit: 'hash2',
        author: 'Author A',
        date: 'date2',
        subject: 'feat(core): feature',
        type: 'feat',
        scope: 'core'
      },
      {
        commit: 'hash3',
        author: 'Author B',
        date: 'date3',
        subject: 'fix(cache): bug',
        type: 'fix',
        scope: 'cache'
      }
    ];
    
    insertCommits(commits);
    
    const typeFixResults = queryCommits({ type: 'fix' });
    expect(typeFixResults.length).toBe(2);
    
    const typeFeatResults = queryCommits({ type: 'feat' });
    expect(typeFeatResults.length).toBe(1);
    expect(typeFeatResults[0].commit).toBe('hash2');
    
    const scopeCacheResults = queryCommits({ scope: 'cache' });
    expect(scopeCacheResults.length).toBe(1);
    expect(scopeCacheResults[0].commit).toBe('hash3');
    
    const typeAndScopeResults = queryCommits({ type: 'fix', scope: 'core' });
    expect(typeAndScopeResults.length).toBe(1);
    expect(typeAndScopeResults[0].commit).toBe('hash1');
  });
});


