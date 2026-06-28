// @ts-nocheck
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommitEntry } from './schema.js';

let db: Database | null = null;

export function initCache(dbPath?: string): Database {
  if (db) return db;
  
  const targetPath = dbPath || join(process.cwd(), '.agents', 'cache', 'git-history.db');
  
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
  } catch {
    // Ignore if exists
  }
  
  db = new Database(targetPath);
  
  // enable WAL mode for performance
  db.exec('PRAGMA journal_mode = WAL;');
  
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
    )
  `);
  
  return db;
}

export function closeCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function insertCommits(batch: CommitEntry[]): void {
  if (!db) initCache();
  
  const insert = db!.prepare(`
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
  
  const transaction = db!.transaction((commits: CommitEntry[]) => {
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
  if (!db) initCache();
  
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
  
  const stmt = db!.prepare(query);
  const rows = stmt.all(params as Record<string, string | number>) as Record<string, string | number | null>[];
  
  return rows.map(row => ({
    commit: row.commit_hash as string,
    parents: row.parents ? JSON.parse(row.parents as string) : undefined,
    refs: row.refs ? JSON.parse(row.refs as string) : undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    author: row.author as string,
    email: (row.email as string) || undefined,
    committer: (row.committer as string) || undefined,
    committerEmail: (row.committerEmail as string) || undefined,
    committerDate: (row.committerDate as string) || undefined,
    date: row.date as string,
    type: (row.type as string) || undefined,
    scope: (row.scope as string) || undefined,
    isBreaking: row.isBreaking === 1 ? true : undefined,
    breakingChangeDescription: (row.breakingChangeDescription as string) || undefined,
    isRevert: row.isRevert === 1 ? true : undefined,
    revertedCommit: (row.revertedCommit as string) || undefined,
    isRebased: row.isRebased === 1 ? true : undefined,
    subject: row.subject as string,
    cleanSubject: (row.cleanSubject as string) || undefined,
    body: (row.body as string) || undefined,
    size: (row.size as "XS" | "S" | "M" | "L" | "XL") || undefined,
    files: row.files ? JSON.parse(row.files as string) : undefined,
    fileCount: (row.fileCount as number) || undefined,
    isFilesTruncated: row.isFilesTruncated === 1 ? true : undefined,
    totalInsertions: row.totalInsertions !== null ? (row.totalInsertions as number) : undefined,
    totalDeletions: row.totalDeletions !== null ? (row.totalDeletions as number) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    patch: (row.patch as string) || undefined,
    isPatchTruncated: row.isPatchTruncated === 1 ? true : undefined,
    references: row.references ? JSON.parse(row.references as string) : undefined,
    coAuthors: row.coAuthors ? JSON.parse(row.coAuthors as string) : undefined,
    reviewers: row.reviewers ? JSON.parse(row.reviewers as string) : undefined,
    associatedIssues: row.associatedIssues ? JSON.parse(row.associatedIssues as string) : undefined,
    validationErrors: row.validationErrors ? JSON.parse(row.validationErrors as string) : undefined,
    isCorrupted: row.isCorrupted === 1 ? true : undefined
  }));
}
