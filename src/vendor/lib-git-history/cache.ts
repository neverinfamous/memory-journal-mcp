// @ts-nocheck
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { entrySchema, type CommitEntry } from './schema.js';

let db: Database | null = null;
let currentDbPath: string | null = null;
let cachedInsertTx: ((commits: CommitEntry[]) => void) | null = null;
let cachedInsertTxDb: Database | null = null;
let cachedInsertStmt: ReturnType<Database['prepare']> | null = null;
type PatchUpdateRow = { commit: string; patch: string; isPatchTruncated?: boolean };
let cachedPatchUpdateTx: ((rows: PatchUpdateRow[]) => void) | null = null;
let cachedPatchUpdateTxDb: Database | null = null;
let cachedPatchUpdateStmt: ReturnType<Database['prepare']> | null = null;

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
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  )
`;

const CACHE_SCHEMA_VERSION = 3;

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

export type CacheProjection = 'full' | 'no-patch' | 'stats' | 'summary' | 'no-body';

const BASE_NO_BODY_COLS =
  'commit_hash, parents, refs, tags, author, email, committer, committerEmail, committerDate, ' +
  'date, type, scope, isBreaking, breakingChangeDescription, isRevert, revertedCommit, isRebased, ' +
  'subject, cleanSubject, associatedIssues, slackId, validationErrors, isCorrupted';

const SUMMARY_EXTRA_COLS =
  'size, fileCount, isFilesTruncated, totalInsertions, totalDeletions, ' +
  'metadata, trailersObj, "references", coAuthors, reviewers';

const CACHE_PROJECTION_COLUMNS: Record<CacheProjection, string> = {
  full: '*',
  'no-patch': `${BASE_NO_BODY_COLS}, body, isBodyTruncated, files, ${SUMMARY_EXTRA_COLS}`,
  stats: `${BASE_NO_BODY_COLS}, files, ${SUMMARY_EXTRA_COLS}`,
  summary: `${BASE_NO_BODY_COLS}, ${SUMMARY_EXTRA_COLS}`,
  'no-body': BASE_NO_BODY_COLS,
};

const MIGRATION_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['isBodyTruncated', 'INTEGER'],
  ['trailersObj', 'TEXT'],
  ['slackId', 'TEXT'],
];

function ensureCacheSchemaColumns(database: Database): void {
  const infoStmt = database.prepare('PRAGMA table_info(commits);');
  let existingRows: unknown[];
  try {
    existingRows = infoStmt.all() as unknown[];
  } finally {
    finalizeStatement(infoStmt);
  }
  const existingCols = new Set(existingRows.map((r) => (isRecord(r) && typeof r['name'] === 'string' ? r['name'] : '')));
  for (const [colName, colType] of MIGRATION_COLUMNS) {
    if (!existingCols.has(colName)) {
      database.exec(`ALTER TABLE commits ADD COLUMN ${colName} ${colType};`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyScalarColumns(row: Record<string, unknown>, out: Record<string, unknown>): void {
  if (typeof row['email'] === 'string') out['email'] = row['email'];
  if (typeof row['committer'] === 'string') out['committer'] = row['committer'];
  if (typeof row['committerEmail'] === 'string') out['committerEmail'] = row['committerEmail'];
  if (typeof row['committerDate'] === 'string') out['committerDate'] = row['committerDate'];
  if (typeof row['type'] === 'string') out['type'] = row['type'];
  if (typeof row['scope'] === 'string') out['scope'] = row['scope'];
  if (typeof row['breakingChangeDescription'] === 'string') out['breakingChangeDescription'] = row['breakingChangeDescription'];
  if (typeof row['revertedCommit'] === 'string') out['revertedCommit'] = row['revertedCommit'];
  if (typeof row['cleanSubject'] === 'string') out['cleanSubject'] = row['cleanSubject'];
  if (typeof row['body'] === 'string') out['body'] = row['body'];
  if (typeof row['size'] === 'string') out['size'] = row['size'];
  if (typeof row['patch'] === 'string') out['patch'] = row['patch'];
  if (typeof row['slackId'] === 'string') out['slackId'] = row['slackId'];
  if (typeof row['fileCount'] === 'number') out['fileCount'] = row['fileCount'];
  if (typeof row['totalInsertions'] === 'number') out['totalInsertions'] = row['totalInsertions'];
  if (typeof row['totalDeletions'] === 'number') out['totalDeletions'] = row['totalDeletions'];
  if (row['isBreaking'] === 1) out['isBreaking'] = true;
  if (row['isRevert'] === 1) out['isRevert'] = true;
  if (row['isRebased'] === 1) out['isRebased'] = true;
  if (row['isBodyTruncated'] === 1) out['isBodyTruncated'] = true;
  if (row['isFilesTruncated'] === 1) out['isFilesTruncated'] = true;
  if (row['isPatchTruncated'] === 1) out['isPatchTruncated'] = true;
  if (row['isCorrupted'] === 1) out['isCorrupted'] = true;
}

function setParsedJsonField(out: Record<string, unknown>, key: string, rawVal: unknown, hash: string): void {
  if (typeof rawVal === 'string' && rawVal.length > 0) {
    const parsedJson = safeParseJSON(rawVal, key, hash);
    if (parsedJson !== undefined) out[key] = parsedJson;
  }
}

function copyJsonColumns(row: Record<string, unknown>, out: Record<string, unknown>, hash: string): void {
  setParsedJsonField(out, 'parents', row['parents'], hash);
  setParsedJsonField(out, 'refs', row['refs'], hash);
  setParsedJsonField(out, 'tags', row['tags'], hash);
  setParsedJsonField(out, 'files', row['files'], hash);
  setParsedJsonField(out, 'metadata', row['metadata'], hash);
  setParsedJsonField(out, 'trailersObj', row['trailersObj'], hash);
  setParsedJsonField(out, 'references', row['references'], hash);
  setParsedJsonField(out, 'coAuthors', row['coAuthors'], hash);
  setParsedJsonField(out, 'reviewers', row['reviewers'], hash);
  setParsedJsonField(out, 'associatedIssues', row['associatedIssues'], hash);
  setParsedJsonField(out, 'validationErrors', row['validationErrors'], hash);
}

function hydrateCachedRow(rawRow: unknown): CommitEntry | null {
  if (!isRecord(rawRow) || typeof rawRow['commit_hash'] !== 'string' || typeof rawRow['author'] !== 'string' || typeof rawRow['date'] !== 'string' || typeof rawRow['subject'] !== 'string') {
    console.warn('[lib-git-history] Warning: Failed to validate cached SQLite row shape');
    return null;
  }
  const hash = rawRow['commit_hash'];
  const rawObj: Record<string, unknown> = { commit: hash, author: rawRow['author'], date: rawRow['date'], subject: rawRow['subject'] };
  copyScalarColumns(rawRow, rawObj);
  copyJsonColumns(rawRow, rawObj, hash);

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

function readUserVersion(database: Database): number {
  const row = database.query('PRAGMA user_version;').get();
  if (isRecord(row) && typeof row['user_version'] === 'number') return row['user_version'];
  return 0;
}

function initializeSchema(nextDb: Database): void {
  // [INTENT]: Configure busy_timeout first so WAL mode transition and migration locks wait cleanly under multi-process load.
  nextDb.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16384; PRAGMA foreign_keys = ON;');
  if (readUserVersion(nextDb) === CACHE_SCHEMA_VERSION) return;

  nextDb.exec('BEGIN IMMEDIATE;');
  try {
    if (readUserVersion(nextDb) !== CACHE_SCHEMA_VERSION) {
      nextDb.exec(CREATE_COMMITS_TABLE_SQL);
      ensureCacheSchemaColumns(nextDb);
      nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author);');
      nextDb.exec('DROP INDEX IF EXISTS idx_commits_type;');
      nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_type_scope ON commits(type, scope);');
      nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_scope ON commits(scope);');
      nextDb.exec('DROP INDEX IF EXISTS idx_commits_isBreaking;');
      nextDb.exec('CREATE INDEX IF NOT EXISTS idx_commits_isBreaking_true ON commits(isBreaking) WHERE isBreaking = 1;');
      nextDb.exec(`PRAGMA user_version = ${CACHE_SCHEMA_VERSION};`);
    }
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
    if (targetPath === currentDbPath) return db;
    closeCache();
  }
  if (!isMemory) {
    try { mkdirSync(dirname(targetPath), { recursive: true }); }
    catch (err: unknown) { if (!isErrnoException(err) || err.code !== 'EEXIST') throw err; }
  }
  const nextDb = new Database(targetPath);
  try { initializeSchema(nextDb); }
  catch (err: unknown) { try { nextDb.close(); } catch { /* ignore */ } throw err; }
  db = nextDb;
  currentDbPath = targetPath;
  return nextDb;
}

export function closeCache(): void {
  if (!db) return;
  const activeDb = db;
  try {
    if (cachedInsertStmt) { finalizeStatement(cachedInsertStmt); cachedInsertStmt = null; }
    if (cachedPatchUpdateStmt) { finalizeStatement(cachedPatchUpdateStmt); cachedPatchUpdateStmt = null; }
    for (const stmt of stmtCache.values()) finalizeStatement(stmt);
    stmtCache.clear();
    try { activeDb.exec('PRAGMA optimize;'); } catch { /* ignore */ }
    activeDb.close();
  } finally {
    db = null; currentDbPath = null;
    cachedInsertTx = null; cachedInsertTxDb = null; cachedInsertStmt = null;
    cachedPatchUpdateTx = null; cachedPatchUpdateTxDb = null; cachedPatchUpdateStmt = null;
    stmtCache.clear();
  }
}

export function hasCachedCommits(): boolean {
  if (!db) return false;
  return getOrPrepare(db, 'SELECT 1 FROM commits LIMIT 1').get() !== null;
}

export interface CachedFilterProbe {
  type?: string;
  isBreaking?: boolean;
  metadata?: {
    category?: string[];
    entry?: string[];
    impact?: number | string;
    confidence?: number | string;
  };
}

function parseFilterMetadata(rawMeta: unknown, hash: string): CachedFilterProbe['metadata'] | null {
  if (rawMeta === null || rawMeta === undefined || rawMeta === '') return undefined;
  if (typeof rawMeta !== 'string') return null;
  const parsed = safeParseJSON(rawMeta, 'metadata', hash);
  if (!isRecord(parsed)) return null;
  const meta: NonNullable<CachedFilterProbe['metadata']> = {};
  if (parsed['category'] !== undefined) {
    if (!Array.isArray(parsed['category']) || !parsed['category'].every((v): v is string => typeof v === 'string')) return null;
    meta.category = parsed['category'];
  }
  if (parsed['entry'] !== undefined) {
    if (!Array.isArray(parsed['entry']) || !parsed['entry'].every((v): v is string => typeof v === 'string')) return null;
    meta.entry = parsed['entry'];
  }
  if (parsed['impact'] !== undefined) {
    if (typeof parsed['impact'] !== 'number' && typeof parsed['impact'] !== 'string') return null;
    meta.impact = parsed['impact'];
  }
  if (parsed['confidence'] !== undefined) {
    if (typeof parsed['confidence'] !== 'number' && typeof parsed['confidence'] !== 'string') return null;
    meta.confidence = parsed['confidence'];
  }
  return meta;
}

/**
 * [INTENT]: Lightweight 3-4 column probe for warm-cache TS post-filters; avoids decoding
 * `body`, `files`, `patch`, and full 38-field Zod validation on non-matching rows.
 */
export function batchProbeCommitFilters(shas: string[], includeMetadata: boolean): Map<string, CachedFilterProbe> {
  if (shas.length === 0) return new Map();
  const currentDb = db || initCache();
  const cols = includeMetadata ? 'commit_hash, type, isBreaking, metadata' : 'commit_hash, type, isBreaking';
  const CHUNK = 500;
  const result = new Map<string, CachedFilterProbe>();

  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const placeholders = '?,'.repeat(chunk.length - 1) + '?';
    const rows = getOrPrepare(currentDb, `SELECT ${cols} FROM commits WHERE commit_hash IN (${placeholders})`).all(...chunk) as unknown[];
    for (const row of rows) {
      if (!isRecord(row) || typeof row['commit_hash'] !== 'string') continue;
      const hash = row['commit_hash'];
      if (result.has(hash)) continue;
      const probe: CachedFilterProbe = {};
      if (typeof row['type'] === 'string') probe.type = row['type'];
      if (row['isBreaking'] === 1) probe.isBreaking = true;
      if (includeMetadata) {
        const meta = parseFilterMetadata(row['metadata'], hash);
        if (meta === null) continue;
        if (meta !== undefined) probe.metadata = meta;
      }
      result.set(hash, probe);
    }
  }
  return result;
}

export function updateCommitPatches(updates: PatchUpdateRow[]): void {
  if (updates.length === 0) return;
  const currentDb = db || initCache();
  if (!cachedPatchUpdateTx || cachedPatchUpdateTxDb !== currentDb) {
    if (cachedPatchUpdateStmt) finalizeStatement(cachedPatchUpdateStmt);
    const stmt = currentDb.prepare('UPDATE commits SET patch = ?, isPatchTruncated = ? WHERE commit_hash = ?');
    cachedPatchUpdateStmt = stmt;
    cachedPatchUpdateTx = currentDb.transaction((rows: PatchUpdateRow[]) => {
      for (const r of rows) stmt.run(r.patch, r.isPatchTruncated ? 1 : 0, r.commit);
    }).immediate;
    cachedPatchUpdateTxDb = currentDb;
  }
  cachedPatchUpdateTx(updates);
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
        insert.run(
          c.commit, c.parents ? JSON.stringify(c.parents) : null, c.refs ? JSON.stringify(c.refs) : null,
          c.tags ? JSON.stringify(c.tags) : null, c.author, c.email ?? null,
          c.committer ?? null, c.committerEmail ?? null, c.committerDate ?? null, c.date,
          c.type ?? null, c.scope ?? null, c.isBreaking ? 1 : 0, c.breakingChangeDescription ?? null,
          c.isRevert ? 1 : 0, c.revertedCommit ?? null, c.isRebased ? 1 : 0,
          c.subject, c.cleanSubject ?? null, c.body ?? null, c.isBodyTruncated ? 1 : 0,
          c.size ?? null, c.files ? JSON.stringify(c.files) : null, c.fileCount ?? null,
          c.isFilesTruncated ? 1 : 0, c.totalInsertions ?? null, c.totalDeletions ?? null,
          c.metadata ? JSON.stringify(c.metadata) : null, c.trailersObj ? JSON.stringify(c.trailersObj) : null,
          c.patch ?? null, c.isPatchTruncated ? 1 : 0, c.references ? JSON.stringify(c.references) : null,
          c.coAuthors ? JSON.stringify(c.coAuthors) : null, c.reviewers ? JSON.stringify(c.reviewers) : null,
          c.associatedIssues ? JSON.stringify(c.associatedIssues) : null, c.slackId ?? null,
          c.validationErrors ? JSON.stringify(c.validationErrors) : null, c.isCorrupted ? 1 : 0,
        );
      }
    }).immediate;
    cachedInsertTxDb = currentDb;
  }
  cachedInsertTx(batch);
}

export type QueryCommitsFilter = Pick<Partial<CommitEntry>, 'commit' | 'author' | 'type' | 'scope' | 'isBreaking'>;

export function queryCommits(filters: QueryCommitsFilter = {}): CommitEntry[] {
  const currentDb = db || initCache();
  let query = 'SELECT * FROM commits';
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (filters.commit) { conditions.push('commit_hash = $commit'); params.$commit = filters.commit; }
  if (filters.author) { conditions.push('author = $author'); params.$author = filters.author; }
  if (filters.type) { conditions.push('type = $type'); params.$type = filters.type; }
  if (filters.scope) { conditions.push('scope = $scope'); params.$scope = filters.scope; }
  if (typeof filters.isBreaking === 'boolean') {
    // [INTENT]: Literal `= 1` enables SQLite to match the partial index `idx_commits_isBreaking_true`.
    conditions.push(filters.isBreaking ? 'isBreaking = 1' : 'isBreaking = 0');
  }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

  const rows = getOrPrepare(currentDb, query).all(params) as unknown[];
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
export function batchQueryCommits(shas: string[], projection: CacheProjection = 'full'): Map<string, CommitEntry> {
  if (shas.length === 0) return new Map();
  const currentDb = db || initCache();

  // Keep IN-clause binds <= 500 and use positional `?` placeholders so prepared statements
  // are reused across chunks regardless of outer offset `i`.
  const CHUNK = 500;
  const cols = CACHE_PROJECTION_COLUMNS[projection];
  const result = new Map<string, CommitEntry>();

  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const placeholders = '?,'.repeat(chunk.length - 1) + '?';
    const query = `SELECT ${cols} FROM commits WHERE commit_hash IN (${placeholders})`;

    const stmt = getOrPrepare(currentDb, query);
    const rows = stmt.all(...chunk) as unknown[];
    for (const row of rows) {
      if (isRecord(row) && typeof row['commit_hash'] === 'string' && result.has(row['commit_hash'])) continue;
      const hydrated = hydrateCachedRow(row);
      if (hydrated !== null) result.set(hydrated.commit, hydrated);
    }
  }

  return result;
}
