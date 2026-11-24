// @ts-nocheck
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CacheProjection } from './constants.js';
import type { CommitEntry, FileStatus } from './schema.js';

export type { CacheProjection };

let db: Database | null = null;
let currentDbPath: string | null = null;
let isReadOnly = false;
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
    commit_hash, type, scope, isBreaking, tags, metadata,
    parents, refs, author, email, committer, committerEmail, committerDate, date,
    breakingChangeDescription, isRevert, revertedCommit, isRebased, subject, cleanSubject, isBodyTruncated,
    size, fileCount, isFilesTruncated, totalInsertions, totalDeletions, trailersObj, isPatchTruncated,
    "references", coAuthors, reviewers, associatedIssues, slackId, validationErrors, isCorrupted,
    files, body, patch
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`;

const CACHE_SCHEMA_VERSION = 4;
const PARSE_FAIL = Symbol('parse_fail');

function parseJsonCol(raw: unknown, columnName: string, commitHash: string): unknown {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return PARSE_FAIL;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lib-git-history] Warning: Failed to parse cached JSON column '${columnName}' for commit ${commitHash}: ${msg}`);
    return PARSE_FAIL;
  }
}

const BASE_NO_BODY_COLS =
  'c.commit_hash, c.parents, c.refs, c.tags, c.author, c.email, c.committer, c.committerEmail, c.committerDate, ' +
  'c.date, c.type, c.scope, c.isBreaking, c.breakingChangeDescription, c.isRevert, c.revertedCommit, c.isRebased, ' +
  'c.subject, c.cleanSubject, c.associatedIssues, c.slackId, c.validationErrors, c.isCorrupted';

const SUMMARY_EXTRA_COLS =
  'c.size, c.fileCount, c.isFilesTruncated, c.totalInsertions, c.totalDeletions, ' +
  'c.metadata, c.trailersObj, c."references", c.coAuthors, c.reviewers';

const CACHE_PROJECTION_COLUMNS: Record<CacheProjection, string> = {
  full: 'c.*',
  'no-patch': `${BASE_NO_BODY_COLS}, c.body, c.isBodyTruncated, c.files, ${SUMMARY_EXTRA_COLS}`,
  stats: `${BASE_NO_BODY_COLS}, c.files, ${SUMMARY_EXTRA_COLS}`,
  summary: `${BASE_NO_BODY_COLS}, ${SUMMARY_EXTRA_COLS}`,
  'no-body': BASE_NO_BODY_COLS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isRecord(v)) return false;
  for (const k in v) { if (Object.hasOwn(v, k) && typeof v[k] !== 'string') return false; }
  return true;
}
const isAnyValue = (_v: unknown): _v is unknown => true;
const isFiniteNumOrStr = (v: unknown): v is number | string => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string');

function isFileStatus(v: unknown): v is FileStatus {
  if (!isRecord(v) || typeof v['status'] !== 'string' || typeof v['file'] !== 'string') return false;
  if (v['oldFile'] !== undefined && typeof v['oldFile'] !== 'string') return false;
  if (v['similarityScore'] !== undefined && (typeof v['similarityScore'] !== 'number' || !Number.isInteger(v['similarityScore']))) return false;
  if (v['insertions'] !== undefined && (typeof v['insertions'] !== 'number' || !Number.isInteger(v['insertions']))) return false;
  if (v['deletions'] !== undefined && (typeof v['deletions'] !== 'number' || !Number.isInteger(v['deletions']))) return false;
  if (v['isBinary'] !== undefined && typeof v['isBinary'] !== 'boolean') return false;
  return v['language'] === undefined || typeof v['language'] === 'string';
}

const isAssociatedIssue = (v: unknown): v is { issue: string; action: string | null } =>
  isRecord(v) && typeof v['issue'] === 'string' && (v['action'] === null || typeof v['action'] === 'string');

function parseCommitSize(raw: unknown): CommitEntry['size'] | undefined | null {
  if (raw === null || raw === undefined) return undefined;
  return raw === 'XS' || raw === 'S' || raw === 'M' || raw === 'L' || raw === 'XL' ? raw : null;
}

function parseJsonArray<T>(raw: unknown, col: string, hash: string, guard: (v: unknown) => v is T): T[] | undefined | null {
  const parsed = parseJsonCol(raw, col, hash);
  if (parsed === undefined) return undefined;
  if (parsed === PARSE_FAIL || !Array.isArray(parsed) || !parsed.every(guard)) return null;
  return parsed;
}

function parseValidatedMetadata(rawMeta: unknown, hash: string): CommitEntry['metadata'] | undefined | null {
  const parsed = parseJsonCol(rawMeta, 'metadata', hash);
  if (parsed === undefined) return undefined;
  if (parsed === PARSE_FAIL || !isRecord(parsed)) return null;
  const meta: NonNullable<CommitEntry['metadata']> = {};
  if (parsed['category'] !== undefined) { if (!isStringArray(parsed['category'])) return null; meta.category = parsed['category']; }
  if (parsed['entry'] !== undefined) { if (!isStringArray(parsed['entry'])) return null; meta.entry = parsed['entry']; }
  if (parsed['significance'] !== undefined) { if (typeof parsed['significance'] !== 'string') return null; meta.significance = parsed['significance']; }
  if (parsed['impact'] !== undefined) { if (!isFiniteNumOrStr(parsed['impact'])) return null; meta.impact = parsed['impact']; }
  if (parsed['trust'] !== undefined) { if (!isFiniteNumOrStr(parsed['trust'])) return null; meta.trust = parsed['trust']; }
  if (parsed['confidence'] !== undefined) { if (!isFiniteNumOrStr(parsed['confidence'])) return null; meta.confidence = parsed['confidence']; }
  if (parsed['validation'] !== undefined) { if (typeof parsed['validation'] !== 'string') return null; meta.validation = parsed['validation']; }
  if (parsed['customTrailers'] !== undefined) {
    if (!isRecord(parsed['customTrailers'])) return null;
    const trailers: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed['customTrailers'])) {
      if (!isStringArray(v)) return null;
      trailers[k] = v;
    }
    meta.customTrailers = trailers;
  }
  return meta;
}

const checkInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function hydrateScalarFields(row: Record<string, unknown>, entry: CommitEntry): boolean {
  if (typeof row['email'] === 'string') entry.email = row['email'];
  if (typeof row['committer'] === 'string') entry.committer = row['committer'];
  if (typeof row['committerEmail'] === 'string') entry.committerEmail = row['committerEmail'];
  if (typeof row['committerDate'] === 'string') entry.committerDate = row['committerDate'];
  if (typeof row['type'] === 'string') entry.type = row['type'];
  if (typeof row['scope'] === 'string') entry.scope = row['scope'];
  if (typeof row['breakingChangeDescription'] === 'string') entry.breakingChangeDescription = row['breakingChangeDescription'];
  if (typeof row['revertedCommit'] === 'string') entry.revertedCommit = row['revertedCommit'];
  if (typeof row['cleanSubject'] === 'string') entry.cleanSubject = row['cleanSubject'];
  if (typeof row['body'] === 'string') entry.body = row['body'];
  if (typeof row['patch'] === 'string') entry.patch = row['patch'];
  if (typeof row['slackId'] === 'string') entry.slackId = row['slackId'];
  const sz = parseCommitSize(row['size']);
  if (sz === null) return false;
  if (sz !== undefined) entry.size = sz;
  if (row['fileCount'] !== null && row['fileCount'] !== undefined) { if (!checkInt(row['fileCount'])) return false; entry.fileCount = row['fileCount']; }
  if (row['totalInsertions'] !== null && row['totalInsertions'] !== undefined) { if (!checkInt(row['totalInsertions'])) return false; entry.totalInsertions = row['totalInsertions']; }
  if (row['totalDeletions'] !== null && row['totalDeletions'] !== undefined) { if (!checkInt(row['totalDeletions'])) return false; entry.totalDeletions = row['totalDeletions']; }
  if (row['isBreaking'] === 1) entry.isBreaking = true; if (row['isRevert'] === 1) entry.isRevert = true; if (row['isRebased'] === 1) entry.isRebased = true;
  if (row['isBodyTruncated'] === 1) entry.isBodyTruncated = true; if (row['isFilesTruncated'] === 1) entry.isFilesTruncated = true; if (row['isPatchTruncated'] === 1) entry.isPatchTruncated = true; if (row['isCorrupted'] === 1) entry.isCorrupted = true;
  return true;
}

function hydrateJsonFields(row: Record<string, unknown>, entry: CommitEntry, hash: string): boolean {
  const parents = parseJsonArray(row['parents'], 'parents', hash, isString);
  const refs = parseJsonArray(row['refs'], 'refs', hash, isString);
  const tags = parseJsonArray(row['tags'], 'tags', hash, isString);
  const files = parseJsonArray(row['files'], 'files', hash, isFileStatus);
  const metadata = parseValidatedMetadata(row['metadata'], hash);
  const references = parseJsonArray(row['references'], 'references', hash, isString);
  const coAuthors = parseJsonArray(row['coAuthors'], 'coAuthors', hash, isString);
  const reviewers = parseJsonArray(row['reviewers'], 'reviewers', hash, isString);
  const associatedIssues = parseJsonArray(row['associatedIssues'], 'associatedIssues', hash, isAssociatedIssue);
  const validationErrors = parseJsonArray(row['validationErrors'], 'validationErrors', hash, isAnyValue);
  if (parents === null || refs === null || tags === null || files === null || metadata === null ||
      references === null || coAuthors === null || reviewers === null || associatedIssues === null || validationErrors === null) return false;
  const rawTrailers = parseJsonCol(row['trailersObj'], 'trailersObj', hash);
  if (rawTrailers !== undefined) {
    if (rawTrailers === PARSE_FAIL || !isStringRecord(rawTrailers)) return false;
    entry.trailersObj = rawTrailers;
  }
  if (parents !== undefined) entry.parents = parents; if (refs !== undefined) entry.refs = refs;
  if (tags !== undefined) entry.tags = tags; if (files !== undefined) entry.files = files;
  if (metadata !== undefined) entry.metadata = metadata; if (references !== undefined) entry.references = references;
  if (coAuthors !== undefined) entry.coAuthors = coAuthors; if (reviewers !== undefined) entry.reviewers = reviewers;
  if (associatedIssues !== undefined) entry.associatedIssues = associatedIssues; if (validationErrors !== undefined) entry.validationErrors = validationErrors;
  return true;
}

function hydrateCachedRow(rawRow: unknown): CommitEntry | null {
  if (!isRecord(rawRow) || typeof rawRow['commit_hash'] !== 'string' || typeof rawRow['author'] !== 'string' || typeof rawRow['date'] !== 'string' || typeof rawRow['subject'] !== 'string') {
    console.warn('[lib-git-history] Warning: Failed to validate cached SQLite row shape');
    return null;
  }
  const hash = rawRow['commit_hash'];
  const entry: CommitEntry = { commit: hash, author: rawRow['author'], date: rawRow['date'], subject: rawRow['subject'] };
  if (!hydrateScalarFields(rawRow, entry) || !hydrateJsonFields(rawRow, entry, hash)) {
    console.warn(`[lib-git-history] Warning: Failed to parse cached commit ${hash}`);
    return null;
  }
  return entry;
}

const CREATE_COMMITS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commits (
    commit_hash TEXT PRIMARY KEY, type TEXT, scope TEXT, isBreaking INTEGER, tags TEXT, metadata TEXT,
    parents TEXT, refs TEXT, author TEXT, email TEXT, committer TEXT, committerEmail TEXT, committerDate TEXT,
    date TEXT, breakingChangeDescription TEXT, isRevert INTEGER, revertedCommit TEXT, isRebased INTEGER,
    subject TEXT, cleanSubject TEXT, isBodyTruncated INTEGER, size TEXT, fileCount INTEGER, isFilesTruncated INTEGER,
    totalInsertions INTEGER, totalDeletions INTEGER, trailersObj TEXT, isPatchTruncated INTEGER,
    "references" TEXT, coAuthors TEXT, reviewers TEXT, associatedIssues TEXT, slackId TEXT, validationErrors TEXT,
    isCorrupted INTEGER, files TEXT, body TEXT, patch TEXT
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
      nextDb.exec(`DROP TABLE IF EXISTS commits; ${CREATE_COMMITS_TABLE_SQL};`);
      nextDb.exec(
        'CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author);' +
        'CREATE INDEX IF NOT EXISTS idx_commits_type_scope ON commits(type, scope);' +
        'CREATE INDEX IF NOT EXISTS idx_commits_scope ON commits(scope);' +
        'CREATE INDEX IF NOT EXISTS idx_commits_isBreaking_true ON commits(isBreaking) WHERE isBreaking = 1;' +
        `PRAGMA user_version = ${CACHE_SCHEMA_VERSION};`,
      );
    }
    nextDb.exec('COMMIT;');
  } catch (err: unknown) {
    try { nextDb.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw err;
  }
}

export function initCache(dbPath?: string, readonly = false): Database {
  const rawPath = dbPath || join(process.cwd(), '.agents', 'cache', 'git-history.db');
  const isMemory = rawPath === ':memory:';
  const targetPath = isMemory ? ':memory:' : resolve(rawPath);

  if (db) {
    if (targetPath === currentDbPath && (!isReadOnly || readonly)) return db;
    closeCache();
  }
  if (!isMemory && !readonly) {
    try { mkdirSync(dirname(targetPath), { recursive: true }); }
    catch (err: unknown) { if (!isErrnoException(err) || err.code !== 'EEXIST') throw err; }
  }
  const nextDb = readonly && !isMemory ? new Database(targetPath, { readonly: true }) : new Database(targetPath);
  try {
    if (readonly && !isMemory) {
      nextDb.exec('PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16384;');
      if (readUserVersion(nextDb) !== CACHE_SCHEMA_VERSION) throw new Error('CacheSchemaVersionMismatch');
    } else {
      initializeSchema(nextDb);
    }
  } catch (err: unknown) {
    try { nextDb.close(); } catch { /* ignore */ }
    throw err;
  }
  db = nextDb;
  currentDbPath = targetPath;
  isReadOnly = readonly && !isMemory;
  return nextDb;
}

export function closeCache(): void {
  if (!db) return;
  const activeDb = db;
  const optimize = !isReadOnly;
  try {
    if (cachedInsertStmt) { finalizeStatement(cachedInsertStmt); cachedInsertStmt = null; }
    if (cachedPatchUpdateStmt) { finalizeStatement(cachedPatchUpdateStmt); cachedPatchUpdateStmt = null; }
    for (const stmt of stmtCache.values()) finalizeStatement(stmt);
    stmtCache.clear();
    if (optimize) { try { activeDb.exec('PRAGMA optimize;'); } catch { /* ignore */ } }
    activeDb.close();
  } finally {
    db = null; currentDbPath = null; isReadOnly = false;
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
  tags?: string[];
  metadata?: CommitEntry['metadata'];
}

/**
 * [INTENT]: Lightweight 3-5 column probe for warm-cache TS post-filters; avoids decoding
 * `body`, `files`, `patch`, and full hydration on non-matching rows.
 */
export function batchProbeCommitFilters(shas: string[], includeMetadata: boolean, includeTags = false): Map<string, CachedFilterProbe> {
  if (shas.length === 0) return new Map();
  const currentDb = db || initCache();
  const cols = `c.commit_hash, c.type, c.isBreaking${includeMetadata ? ', c.metadata' : ''}${includeTags ? ', c.tags' : ''}`;
  const CHUNK = 500;
  const result = new Map<string, CachedFilterProbe>();

  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const rows = getOrPrepare(currentDb, `SELECT ${cols} FROM commits c JOIN json_each(?) j ON c.commit_hash = j.value`).all(JSON.stringify(chunk)) as unknown[];
    for (const row of rows) {
      if (!isRecord(row) || typeof row['commit_hash'] !== 'string') continue;
      const hash = row['commit_hash'];
      if (result.has(hash)) continue;
      const probe: CachedFilterProbe = {};
      if (typeof row['type'] === 'string') probe.type = row['type'];
      if (row['isBreaking'] === 1) probe.isBreaking = true;
      if (includeTags) {
        const tags = parseJsonArray(row['tags'], 'tags', hash, isString);
        if (tags === null) continue;
        if (tags !== undefined) probe.tags = tags;
      }
      if (includeMetadata) {
        const meta = parseValidatedMetadata(row['metadata'], hash);
        if (meta === null) continue;
        if (meta !== undefined) probe.metadata = meta;
      }
      result.set(hash, probe);
    }
  }
  return result;
}

export function updateCommitPatches(updates: PatchUpdateRow[]): void {
  if (updates.length === 0 || isReadOnly) return;
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
  if (batch.length === 0 || isReadOnly) return;
  const currentDb = db || initCache();
  if (!cachedInsertTx || cachedInsertTxDb !== currentDb) {
    if (cachedInsertStmt) finalizeStatement(cachedInsertStmt);
    const insert = currentDb.prepare(INSERT_COMMIT_SQL);
    cachedInsertStmt = insert;
    cachedInsertTx = currentDb.transaction((commits: CommitEntry[]) => {
      for (const c of commits) {
        insert.run(
          c.commit, c.type ?? null, c.scope ?? null, c.isBreaking ? 1 : 0,
          c.tags ? JSON.stringify(c.tags) : null, c.metadata ? JSON.stringify(c.metadata) : null,
          c.parents ? JSON.stringify(c.parents) : null, c.refs ? JSON.stringify(c.refs) : null,
          c.author, c.email ?? null, c.committer ?? null, c.committerEmail ?? null, c.committerDate ?? null, c.date,
          c.breakingChangeDescription ?? null, c.isRevert ? 1 : 0, c.revertedCommit ?? null, c.isRebased ? 1 : 0,
          c.subject, c.cleanSubject ?? null, c.isBodyTruncated ? 1 : 0,
          c.size ?? null, c.fileCount ?? null, c.isFilesTruncated ? 1 : 0,
          c.totalInsertions ?? null, c.totalDeletions ?? null,
          c.trailersObj ? JSON.stringify(c.trailersObj) : null, c.isPatchTruncated ? 1 : 0,
          c.references ? JSON.stringify(c.references) : null, c.coAuthors ? JSON.stringify(c.coAuthors) : null,
          c.reviewers ? JSON.stringify(c.reviewers) : null, c.associatedIssues ? JSON.stringify(c.associatedIssues) : null,
          c.slackId ?? null, c.validationErrors ? JSON.stringify(c.validationErrors) : null, c.isCorrupted ? 1 : 0,
          c.files ? JSON.stringify(c.files) : null, c.body ?? null, c.patch ?? null,
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
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};
  if (filters.commit) { conditions.push('commit_hash = $commit'); params.$commit = filters.commit; }
  if (filters.author) { conditions.push('author = $author'); params.$author = filters.author; }
  if (filters.type) { conditions.push('type = $type'); params.$type = filters.type; }
  if (filters.scope) { conditions.push('scope = $scope'); params.$scope = filters.scope; }
  // [INTENT]: Literal `= 1` enables SQLite to match the partial index `idx_commits_isBreaking_true`.
  if (typeof filters.isBreaking === 'boolean') conditions.push(filters.isBreaking ? 'isBreaking = 1' : 'isBreaking = 0');
  const query = conditions.length > 0 ? `SELECT * FROM commits WHERE ${conditions.join(' AND ')}` : 'SELECT * FROM commits';
  const results: CommitEntry[] = [];
  for (const row of getOrPrepare(currentDb, query).all(params) as unknown[]) {
    const hydrated = hydrateCachedRow(row);
    if (hydrated !== null) results.push(hydrated);
  }
  return results;
}

/** Batch-query commits by SHA list via `JOIN json_each(?)`, reusing 1 prepared statement per projection. */
export function batchQueryCommits(shas: string[], projection: CacheProjection = 'full'): Map<string, CommitEntry> {
  if (shas.length === 0) return new Map();
  const currentDb = db || initCache();
  const CHUNK = 500;
  const cols = CACHE_PROJECTION_COLUMNS[projection];
  const result = new Map<string, CommitEntry>();
  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const rows = getOrPrepare(currentDb, `SELECT ${cols} FROM commits c JOIN json_each(?) j ON c.commit_hash = j.value`).all(JSON.stringify(chunk)) as unknown[];
    for (const row of rows) {
      if (isRecord(row) && typeof row['commit_hash'] === 'string' && result.has(row['commit_hash'])) continue;
      const hydrated = hydrateCachedRow(row);
      if (hydrated !== null) result.set(hydrated.commit, hydrated);
    }
  }
  return result;
}
