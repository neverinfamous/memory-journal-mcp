// @ts-nocheck
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { entrySchema, commitSizeSchema, type CommitEntry } from './schema.js';

let db: Database | null = null;
let currentDbPath: string | null = null;
let cachedInsertTx: ((commits: CommitEntry[]) => void) | null = null;
let cachedInsertTxDb: Database | null = null;
let cachedInsertStmt: ReturnType<Database['prepare']> | null = null;

// Cached prepared statements keyed by query string to avoid re-preparing on every call (bounded)
const MAX_STMT_CACHE_SIZE = 32;
const stmtCache = new Map<string, ReturnType<Database['prepare']>>();

function finalizeStatement(stmt: ReturnType<Database['prepare']>): void {
  try { stmt.finalize(); } catch { /* ignore already finalized */ }
}

function getOrPrepare(database: Database, query: string): ReturnType<Database['prepare']> {
  let stmt = stmtCache.get(query);
  if (stmt) {
    stmtCache.delete(query);
    stmtCache.set(query, stmt);
    return stmt;
  }
  if (stmtCache.size >= MAX_STMT_CACHE_SIZE) {
    const oldest = stmtCache.entries().next().value;
    if (oldest !== undefined) {
      stmtCache.delete(oldest[0]);
      finalizeStatement(oldest[1]);
    }
  }
  stmt = database.prepare(query);
  stmtCache.set(query, stmt);
  return stmt;
}

const INSERT_COMMIT_SQL = `
  INSERT OR REPLACE INTO commits (
    commit_hash, parents, refs, tags, author, email, committer, committerEmail, committerDate,
    date, type, scope, isBreaking, breakingChangeDescription, isRevert, revertedCommit,
    isRebased, subject, cleanSubject, body, isBodyTruncated, size, files, fileCount, isFilesTruncated,
    totalInsertions, totalDeletions, metadata, trailersObj, patch, isPatchTruncated, "references",
    coAuthors, reviewers, associatedIssues, slackId, validationErrors, isCorrupted
  ) VALUES (
    $commit_hash, $parents, $refs, $tags, $author, $email, $committer, $committerEmail, $committerDate,
    $date, $type, $scope, $isBreaking, $breakingChangeDescription, $isRevert, $revertedCommit,
    $isRebased, $subject, $cleanSubject, $body, $isBodyTruncated, $size, $files, $fileCount, $isFilesTruncated,
    $totalInsertions, $totalDeletions, $metadata, $trailersObj, $patch, $isPatchTruncated, $references,
    $coAuthors, $reviewers, $associatedIssues, $slackId, $validationErrors, $isCorrupted
  )
`;

const safeParseJSON = (str: string | null | undefined, columnName: string, commitHash: string): unknown => {
  if (!str) return undefined;
  try {
    return JSON.parse(str);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lib-git-history] Warning: Failed to parse cached JSON column '${columnName}' for commit ${commitHash}: ${msg}`);
    return undefined;
  }
};

export const dbCommitRowSchema = z.object({
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
  isBodyTruncated: z.number().nullable().optional(),
  size: commitSizeSchema.nullable(),
  files: z.string().nullable(),
  fileCount: z.number().nullable(),
  isFilesTruncated: z.number(),
  totalInsertions: z.number().nullable(),
  totalDeletions: z.number().nullable(),
  metadata: z.string().nullable(),
  trailersObj: z.string().nullable().optional(),
  patch: z.string().nullable(),
  isPatchTruncated: z.number(),
  references: z.string().nullable(),
  coAuthors: z.string().nullable(),
  reviewers: z.string().nullable(),
  associatedIssues: z.string().nullable(),
  slackId: z.string().nullable().optional(),
  validationErrors: z.string().nullable(),
  isCorrupted: z.number()
});

const MIGRATION_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['isBodyTruncated', 'INTEGER'],
  ['trailersObj', 'TEXT'],
  ['slackId', 'TEXT'],
];

function ensureCacheSchemaColumns(database: Database): void {
  const infoStmt = database.prepare('PRAGMA table_info(commits);');
  let existingRows: Array<{ name?: unknown }>;
  try {
    existingRows = infoStmt.all() as Array<{ name?: unknown }>;
  } finally {
    finalizeStatement(infoStmt);
  }
  const existingCols = new Set(existingRows.map((r) => (typeof r.name === 'string' ? r.name : '')));
  for (const [colName, colType] of MIGRATION_COLUMNS) {
    if (!existingCols.has(colName)) {
      database.exec(`ALTER TABLE commits ADD COLUMN ${colName} ${colType};`);
    }
  }
}

function hydrateCachedRow(rawRow: unknown): CommitEntry | null {
  const rowParsed = dbCommitRowSchema.safeParse(rawRow);
  if (!rowParsed.success) {
    console.warn('[lib-git-history] Warning: Failed to validate cached SQLite row shape');
    return null;
  }
  const row = rowParsed.data;
  const hash = row.commit_hash;
  const rawObj = {
    commit: hash,
    parents: safeParseJSON(row.parents, 'parents', hash),
    refs: safeParseJSON(row.refs, 'refs', hash),
    tags: safeParseJSON(row.tags, 'tags', hash),
    author: row.author,
    email: row.email ?? undefined,
    committer: row.committer ?? undefined,
    committerEmail: row.committerEmail ?? undefined,
    committerDate: row.committerDate ?? undefined,
    date: row.date,
    type: row.type ?? undefined,
    scope: row.scope ?? undefined,
    isBreaking: row.isBreaking === 1 ? true : undefined,
    breakingChangeDescription: row.breakingChangeDescription ?? undefined,
    isRevert: row.isRevert === 1 ? true : undefined,
    revertedCommit: row.revertedCommit ?? undefined,
    isRebased: row.isRebased === 1 ? true : undefined,
    subject: row.subject,
    cleanSubject: row.cleanSubject ?? undefined,
    body: row.body ?? undefined,
    isBodyTruncated: row.isBodyTruncated === 1 ? true : undefined,
    size: row.size ?? undefined,
    files: safeParseJSON(row.files, 'files', hash),
    fileCount: row.fileCount !== null ? row.fileCount : undefined,
    isFilesTruncated: row.isFilesTruncated === 1 ? true : undefined,
    totalInsertions: row.totalInsertions !== null ? row.totalInsertions : undefined,
    totalDeletions: row.totalDeletions !== null ? row.totalDeletions : undefined,
    metadata: safeParseJSON(row.metadata, 'metadata', hash),
    trailersObj: safeParseJSON(row.trailersObj, 'trailersObj', hash),
    patch: row.patch ?? undefined,
    isPatchTruncated: row.isPatchTruncated === 1 ? true : undefined,
    references: safeParseJSON(row.references, 'references', hash),
    coAuthors: safeParseJSON(row.coAuthors, 'coAuthors', hash),
    reviewers: safeParseJSON(row.reviewers, 'reviewers', hash),
    associatedIssues: safeParseJSON(row.associatedIssues, 'associatedIssues', hash),
    slackId: row.slackId ?? undefined,
    validationErrors: safeParseJSON(row.validationErrors, 'validationErrors', hash),
    isCorrupted: row.isCorrupted === 1 ? true : undefined
  };
  const parsed = entrySchema.safeParse(rawObj);
  if (!parsed.success) {
    console.warn(`[lib-git-history] Warning: Failed to parse cached commit ${hash}`);
    return null;
  }
  return parsed.data;
}

const CREATE_COMMITS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commits (
    commit_hash TEXT PRIMARY KEY,
    parents TEXT, refs TEXT, tags TEXT,
    author TEXT, email TEXT, committer TEXT, committerEmail TEXT, committerDate TEXT,
    date TEXT, type TEXT, scope TEXT, isBreaking INTEGER, breakingChangeDescription TEXT,
    isRevert INTEGER, revertedCommit TEXT, isRebased INTEGER,
    subject TEXT, cleanSubject TEXT, body TEXT, isBodyTruncated INTEGER,
    size TEXT, files TEXT, fileCount INTEGER, isFilesTruncated INTEGER,
    totalInsertions INTEGER, totalDeletions INTEGER,
    metadata TEXT, trailersObj TEXT, patch TEXT, isPatchTruncated INTEGER,
    "references" TEXT, coAuthors TEXT, reviewers TEXT, associatedIssues TEXT,
    slackId TEXT, validationErrors TEXT, isCorrupted INTEGER
  ) STRICT
`;

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}

function initializeSchema(nextDb: Database): void {
  nextDb.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  nextDb.exec('BEGIN IMMEDIATE;');
  try {
    nextDb.exec(CREATE_COMMITS_TABLE_SQL);
    ensureCacheSchemaColumns(nextDb);
    nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author);');
    nextDb.exec('DROP INDEX IF EXISTS idx_commits_type;');
    nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_type_scope ON commits(type, scope);');
    nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_scope ON commits(scope);');
    nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_isBreaking ON commits(isBreaking);');
    nextDb.exec('COMMIT;');
  } catch (err: unknown) {
    try { nextDb.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw err;
  }
}

export function initCache(dbPath?: string): Database {
  const rawPath = dbPath || join(process.cwd(), '.agents', 'cache', 'git-history.db');
  const isMemory = rawPath === ':memory:';
  const targetPath = isMemory ? ':memory:' : resolve(rawPath);

  if (db) {
    if (targetPath === currentDbPath) {
      return db;
    }
    closeCache();
  }

  if (!isMemory) {
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
    } catch (err: unknown) {
      if (!isErrnoException(err) || err.code !== 'EEXIST') throw err;
    }
  }

  const nextDb = new Database(targetPath);
  try {
    initializeSchema(nextDb);
  } catch (err: unknown) {
    try { nextDb.close(); } catch { /* ignore */ }
    throw err;
  }

  db = nextDb;
  currentDbPath = targetPath;
  return nextDb;
}

export function closeCache(): void {
  if (!db) return;
  const activeDb = db;
  try {
    if (cachedInsertStmt) {
      finalizeStatement(cachedInsertStmt);
      cachedInsertStmt = null;
    }
    for (const stmt of stmtCache.values()) {
      finalizeStatement(stmt);
    }
    stmtCache.clear();
    try { activeDb.exec('PRAGMA optimize;'); } catch { /* ignore */ }
    activeDb.close();
  } finally {
    db = null;
    currentDbPath = null;
    cachedInsertTx = null;
    cachedInsertTxDb = null;
    cachedInsertStmt = null;
    stmtCache.clear();
  }
}

export function insertCommits(batch: CommitEntry[]): void {
  if (batch.length === 0) return;
  const currentDb = db || initCache();
  if (!cachedInsertTx || cachedInsertTxDb !== currentDb) {
    if (cachedInsertStmt) finalizeStatement(cachedInsertStmt);
    const insert = currentDb.prepare(INSERT_COMMIT_SQL);
    cachedInsertStmt = insert;
    cachedInsertTx = currentDb.transaction((commits: CommitEntry[]) => {
      for (const c of commits) {
        insert.run({
          $commit_hash: c.commit,
          $parents: c.parents ? JSON.stringify(c.parents) : null,
          $refs: c.refs ? JSON.stringify(c.refs) : null,
          $tags: c.tags ? JSON.stringify(c.tags) : null,
          $author: c.author,
          $email: c.email ?? null,
          $committer: c.committer ?? null,
          $committerEmail: c.committerEmail ?? null,
          $committerDate: c.committerDate ?? null,
          $date: c.date,
          $type: c.type ?? null,
          $scope: c.scope ?? null,
          $isBreaking: c.isBreaking ? 1 : 0,
          $breakingChangeDescription: c.breakingChangeDescription ?? null,
          $isRevert: c.isRevert ? 1 : 0,
          $revertedCommit: c.revertedCommit ?? null,
          $isRebased: c.isRebased ? 1 : 0,
          $subject: c.subject,
          $cleanSubject: c.cleanSubject ?? null,
          $body: c.body ?? null,
          $isBodyTruncated: c.isBodyTruncated ? 1 : 0,
          $size: c.size ?? null,
          $files: c.files ? JSON.stringify(c.files) : null,
          $fileCount: c.fileCount ?? null,
          $isFilesTruncated: c.isFilesTruncated ? 1 : 0,
          $totalInsertions: c.totalInsertions ?? null,
          $totalDeletions: c.totalDeletions ?? null,
          $metadata: c.metadata ? JSON.stringify(c.metadata) : null,
          $trailersObj: c.trailersObj ? JSON.stringify(c.trailersObj) : null,
          $patch: c.patch ?? null,
          $isPatchTruncated: c.isPatchTruncated ? 1 : 0,
          $references: c.references ? JSON.stringify(c.references) : null,
          $coAuthors: c.coAuthors ? JSON.stringify(c.coAuthors) : null,
          $reviewers: c.reviewers ? JSON.stringify(c.reviewers) : null,
          $associatedIssues: c.associatedIssues ? JSON.stringify(c.associatedIssues) : null,
          $slackId: c.slackId ?? null,
          $validationErrors: c.validationErrors ? JSON.stringify(c.validationErrors) : null,
          $isCorrupted: c.isCorrupted ? 1 : 0
        });
      }
    }).immediate;
    cachedInsertTxDb = currentDb;
  }
  cachedInsertTx(batch);
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
  
  const stmt = getOrPrepare(currentDb, query);
  const rows = stmt.all(params) as unknown[];
  const results: CommitEntry[] = [];
  for (const row of rows) {
    const hydrated = hydrateCachedRow(row);
    if (hydrated !== null) results.push(hydrated);
  }
  return results;
}

/**
 * Batch-query commits by SHA list, replacing the N+1 per-commit lookup pattern.
 * Returns a Map keyed by commit SHA for O(1) caller lookup.
 */
export function batchQueryCommits(shas: string[]): Map<string, CommitEntry> {
  if (shas.length === 0) return new Map();
  const currentDb = db || initCache();

  // Keep IN-clause binds <= 500 and use positional `?` placeholders so prepared statements
  // are reused across chunks regardless of outer offset `i`.
  const CHUNK = 500;
  const result = new Map<string, CommitEntry>();

  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const placeholders = '?,'.repeat(chunk.length - 1) + '?';
    const query = `SELECT * FROM commits WHERE commit_hash IN (${placeholders})`;

    const stmt = getOrPrepare(currentDb, query);
    const rows = stmt.all(...chunk) as unknown[];
    for (const row of rows) {
      const hydrated = hydrateCachedRow(row);
      if (hydrated !== null) result.set(hydrated.commit, hydrated);
    }
  }

  return result;
}
