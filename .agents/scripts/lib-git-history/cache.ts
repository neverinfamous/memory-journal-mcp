import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { entrySchema, commitSizeSchema, type CommitEntry } from './schema.js';

let db: Database | null = null;

const dbCommitRowSchema = z.object({
  commit_hash: z.string(),
  parents: z.string().nullable(),
  refs: z.string().nullable(),
  tags: z.string().nullable(),
  author: z.string(),
  email: z.string().nullable(),
  committer: z.string().nullable(),
  committerEmail: z.string().nullable(),
  committerDate: z.string().nullable(),
  date: z.string(),
  type: z.string().nullable(),
  scope: z.string().nullable(),
  isBreaking: z.number(),
  breakingChangeDescription: z.string().nullable(),
  isRevert: z.number(),
  revertedCommit: z.string().nullable(),
  isRebased: z.number(),
  subject: z.string(),
  cleanSubject: z.string().nullable(),
  body: z.string().nullable(),
  size: commitSizeSchema.nullable(),
  files: z.string().nullable(),
  fileCount: z.number().nullable(),
  isFilesTruncated: z.number(),
  totalInsertions: z.number().nullable(),
  totalDeletions: z.number().nullable(),
  metadata: z.string().nullable(),
  patch: z.string().nullable(),
  isPatchTruncated: z.number(),
  references: z.string().nullable(),
  coAuthors: z.string().nullable(),
  reviewers: z.string().nullable(),
  associatedIssues: z.string().nullable(),
  validationErrors: z.string().nullable(),
  isCorrupted: z.number()
});

export function initCache(dbPath?: string): Database {
  if (db) return db;
  
  const targetPath = dbPath || join(process.cwd(), '.agents', 'cache', 'git-history.db');
  
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
  } catch (err: unknown) {
    const isErrnoException = (e: unknown): e is NodeJS.ErrnoException => e instanceof Error && 'code' in e;
    if (isErrnoException(err) && err.code !== 'EEXIST') throw err;
  }
  
  db = new Database(targetPath);
  
  // enable WAL mode for performance
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS commits (
      commit_hash TEXT PRIMARY KEY,
      parents TEXT,
      refs TEXT,
      tags TEXT,
      author TEXT,
      email TEXT,
      committer TEXT,
      committerEmail TEXT,
      committerDate TEXT,
      date TEXT,
      type TEXT,
      scope TEXT,
      isBreaking INTEGER,
      breakingChangeDescription TEXT,
      isRevert INTEGER,
      revertedCommit TEXT,
      isRebased INTEGER,
      subject TEXT,
      cleanSubject TEXT,
      body TEXT,
      size TEXT,
      files TEXT,
      fileCount INTEGER,
      isFilesTruncated INTEGER,
      totalInsertions INTEGER,
      totalDeletions INTEGER,
      metadata TEXT,
      patch TEXT,
      isPatchTruncated INTEGER,
      "references" TEXT,
      coAuthors TEXT,
      reviewers TEXT,
      associatedIssues TEXT,
      validationErrors TEXT,
      isCorrupted INTEGER
    ) STRICT
  `);
  
  db.exec('CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_commits_type ON commits(type);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_commits_scope ON commits(scope);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_commits_isBreaking ON commits(isBreaking);');
  
  return db;
}

export function closeCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function insertCommits(batch: CommitEntry[]): void {
  const currentDb = db || initCache();
  
  const insert = currentDb.prepare(`
    INSERT OR REPLACE INTO commits (
      commit_hash, parents, refs, tags, author, email, committer, committerEmail, committerDate,
      date, type, scope, isBreaking, breakingChangeDescription, isRevert, revertedCommit,
      isRebased, subject, cleanSubject, body, size, files, fileCount, isFilesTruncated,
      totalInsertions, totalDeletions, metadata, patch, isPatchTruncated, "references",
      coAuthors, reviewers, associatedIssues, validationErrors, isCorrupted
    ) VALUES (
      $commit_hash, $parents, $refs, $tags, $author, $email, $committer, $committerEmail, $committerDate,
      $date, $type, $scope, $isBreaking, $breakingChangeDescription, $isRevert, $revertedCommit,
      $isRebased, $subject, $cleanSubject, $body, $size, $files, $fileCount, $isFilesTruncated,
      $totalInsertions, $totalDeletions, $metadata, $patch, $isPatchTruncated, $references,
      $coAuthors, $reviewers, $associatedIssues, $validationErrors, $isCorrupted
    )
  `);
  
  const transaction = currentDb.transaction((commits: CommitEntry[]) => {
    for (const c of commits) {
      insert.run({
        $commit_hash: c.commit,
        $parents: c.parents ? JSON.stringify(c.parents) : null,
        $refs: c.refs ? JSON.stringify(c.refs) : null,
        $tags: c.tags ? JSON.stringify(c.tags) : null,
        $author: c.author,
        $email: c.email || null,
        $committer: c.committer || null,
        $committerEmail: c.committerEmail || null,
        $committerDate: c.committerDate || null,
        $date: c.date,
        $type: c.type || null,
        $scope: c.scope || null,
        $isBreaking: c.isBreaking ? 1 : 0,
        $breakingChangeDescription: c.breakingChangeDescription || null,
        $isRevert: c.isRevert ? 1 : 0,
        $revertedCommit: c.revertedCommit || null,
        $isRebased: c.isRebased ? 1 : 0,
        $subject: c.subject,
        $cleanSubject: c.cleanSubject || null,
        $body: c.body || null,
        $size: c.size || null,
        $files: c.files ? JSON.stringify(c.files) : null,
        $fileCount: c.fileCount || null,
        $isFilesTruncated: c.isFilesTruncated ? 1 : 0,
        $totalInsertions: c.totalInsertions ?? null,
        $totalDeletions: c.totalDeletions ?? null,
        $metadata: c.metadata ? JSON.stringify(c.metadata) : null,
        $patch: c.patch || null,
        $isPatchTruncated: c.isPatchTruncated ? 1 : 0,
        $references: c.references ? JSON.stringify(c.references) : null,
        $coAuthors: c.coAuthors ? JSON.stringify(c.coAuthors) : null,
        $reviewers: c.reviewers ? JSON.stringify(c.reviewers) : null,
        $associatedIssues: c.associatedIssues ? JSON.stringify(c.associatedIssues) : null,
        $validationErrors: c.validationErrors ? JSON.stringify(c.validationErrors) : null,
        $isCorrupted: c.isCorrupted ? 1 : 0
      });
    }
  });
  
  transaction(batch);
}

export function queryCommits(filters: Partial<CommitEntry> = {}): CommitEntry[] {
  const currentDb = db || initCache();
  
  let query = 'SELECT * FROM commits';
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};
  
  if (filters.commit) {
    conditions.push('commit_hash = $commit');
    params.$commit = filters.commit;
  }
  if (filters.author) {
    conditions.push('author = $author');
    params.$author = filters.author;
  }
  if (filters.type) {
    conditions.push('type = $type');
    params.$type = filters.type;
  }
  if (filters.scope) {
    conditions.push('scope = $scope');
    params.$scope = filters.scope;
  }
  if (typeof filters.isBreaking === 'boolean') {
    conditions.push('isBreaking = $isBreaking');
    params.$isBreaking = filters.isBreaking ? 1 : 0;
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  const stmt = currentDb.prepare(query);
  const rows = z.array(dbCommitRowSchema).parse(stmt.all(params));
  const safeParseJSON = (str: string | null | undefined): unknown => {
    if (!str) return undefined;
    try { return JSON.parse(str); } catch { return undefined; }
  };

  return rows.map(row => {
    const rawObj = {
      commit: row.commit_hash,
      parents: safeParseJSON(row.parents),
      refs: safeParseJSON(row.refs),
      tags: safeParseJSON(row.tags),
      author: row.author,
      email: row.email || undefined,
      committer: row.committer || undefined,
      committerEmail: row.committerEmail || undefined,
      committerDate: row.committerDate || undefined,
      date: row.date,
      type: row.type || undefined,
      scope: row.scope || undefined,
      isBreaking: row.isBreaking === 1 ? true : undefined,
      breakingChangeDescription: row.breakingChangeDescription || undefined,
      isRevert: row.isRevert === 1 ? true : undefined,
      revertedCommit: row.revertedCommit || undefined,
      isRebased: row.isRebased === 1 ? true : undefined,
      subject: row.subject,
      cleanSubject: row.cleanSubject || undefined,
      body: row.body || undefined,
      size: row.size || undefined,
      files: safeParseJSON(row.files),
      fileCount: row.fileCount || undefined,
      isFilesTruncated: row.isFilesTruncated === 1 ? true : undefined,
      totalInsertions: row.totalInsertions !== null ? row.totalInsertions : undefined,
      totalDeletions: row.totalDeletions !== null ? row.totalDeletions : undefined,
      metadata: safeParseJSON(row.metadata),
      patch: row.patch || undefined,
      isPatchTruncated: row.isPatchTruncated === 1 ? true : undefined,
      references: safeParseJSON(row.references),
      coAuthors: safeParseJSON(row.coAuthors),
      reviewers: safeParseJSON(row.reviewers),
      associatedIssues: safeParseJSON(row.associatedIssues),
      validationErrors: safeParseJSON(row.validationErrors),
      isCorrupted: row.isCorrupted === 1 ? true : undefined
    };
    return entrySchema.parse(rawObj);
  });
}
