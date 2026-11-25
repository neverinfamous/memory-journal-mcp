// @ts-nocheck
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MAX_ARRAY_LENGTH, MAX_PARSED_FILES, type CacheProjection } from './constants.js';
import type { CommitEntry, FileStatus } from './schema.js';
import {
  assertSafeSqlitePath, CREATE_COMMITS_TABLE_SQL, dropPoisonedSchemaObjects,
  isValidSqliteCommitsSchema, safeChmodSqliteFiles,
} from './security-sqlite.js';
import {
  copySafePlainValue, copySafeStringArrayRecord, copySafeStringRecord, sanitizeLogText,
} from './security-utils.js';

export type { CacheProjection };

type SqlStatement = ReturnType<Database['prepare']>;
type PatchUpdateRow = { commit: string; patch: string; isPatchTruncated?: boolean };
interface DbRuntimeState {
  readonly: boolean; stmtCache: Map<string, SqlStatement>;
  insertTx: ((commits: CommitEntry[]) => void) | null; insertStmt: SqlStatement | null;
  patchUpdateTx: ((rows: PatchUpdateRow[]) => void) | null; patchUpdateStmt: SqlStatement | null;
}

let db: Database | null = null;
let currentDbPath: string | null = null;
let isReadOnly = false;
const dbStates = new WeakMap<Database, DbRuntimeState>();
const MAX_STMT_CACHE_SIZE = 32;

const finalizeStatement = (stmt: SqlStatement): void => { try { stmt.finalize(); } catch { /* ignore */ } };

function getOrCreateDbState(database: Database, readonly = false): DbRuntimeState {
  let state = dbStates.get(database);
  if (!state) {
    state = { readonly, stmtCache: new Map(), insertTx: null, insertStmt: null, patchUpdateTx: null, patchUpdateStmt: null };
    dbStates.set(database, state);
  }
  return state;
}

function getOrPrepare(database: Database, query: string): SqlStatement {
  const cache = getOrCreateDbState(database).stmtCache;
  let stmt = cache.get(query);
  if (stmt) { cache.delete(query); cache.set(query, stmt); return stmt; }
  if (cache.size >= MAX_STMT_CACHE_SIZE) {
    const oldest = cache.entries().next().value;
    if (oldest !== undefined) { cache.delete(oldest[0]); finalizeStatement(oldest[1]); }
  }
  stmt = database.prepare(query);
  cache.set(query, stmt);
  return stmt;
}

const INSERT_COMMIT_SQL =
  'INSERT OR REPLACE INTO commits (commit_hash, type, scope, isBreaking, tags, metadata, ' +
  'parents, refs, author, email, committer, committerEmail, committerDate, date, breakingChangeDescription, isRevert, ' +
  'revertedCommit, isRebased, subject, cleanSubject, isBodyTruncated, size, fileCount, isFilesTruncated, totalInsertions, ' +
  'totalDeletions, trailersObj, isPatchTruncated, "references", coAuthors, reviewers, associatedIssues, slackId, ' +
  'validationErrors, isCorrupted, files, body, patch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

const CACHE_SCHEMA_VERSION = 4;
const PARSE_FAIL = Symbol('parse_fail');

function parseJsonCol(raw: unknown, columnName: string, commitHash: string): unknown {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return PARSE_FAIL;
  try { return JSON.parse(raw) as unknown; }
  catch (err: unknown) {
    console.warn(`[lib-git-history] Warning: Failed to parse cached JSON column '${columnName}' for commit ${sanitizeLogText(commitHash)}: ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`);
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

const CACHE_PROJECTION_COLUMNS: ReadonlyMap<CacheProjection, string> = new Map([
  ['full', 'c.*'],
  ['no-patch', `${BASE_NO_BODY_COLS}, c.body, c.isBodyTruncated, c.files, ${SUMMARY_EXTRA_COLS}`],
  ['stats', `${BASE_NO_BODY_COLS}, c.files, ${SUMMARY_EXTRA_COLS}`],
  ['summary', `${BASE_NO_BODY_COLS}, ${SUMMARY_EXTRA_COLS}`],
  ['no-body', BASE_NO_BODY_COLS],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isRecord(v)) return false;
  for (const k in v) { if (Object.hasOwn(v, k) && typeof v[k] !== 'string') return false; }
  return true;
}
const isAnyValue = (_v: unknown): _v is unknown => true;
const isFiniteNumOrStr = (v: unknown): v is number | string => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string');

const checkNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function isFileStatus(v: unknown): v is FileStatus {
  if (!isRecord(v) || !isNonEmptyString(v['status']) || !isNonEmptyString(v['file'])) return false;
  if (v['oldFile'] !== undefined && typeof v['oldFile'] !== 'string') return false;
  if (v['similarityScore'] !== undefined && (!checkNonNegInt(v['similarityScore']) || v['similarityScore'] > 100)) return false;
  if (v['insertions'] !== undefined && !checkNonNegInt(v['insertions'])) return false;
  if (v['deletions'] !== undefined && !checkNonNegInt(v['deletions'])) return false;
  if (v['isBinary'] !== undefined && typeof v['isBinary'] !== 'boolean') return false;
  return v['language'] === undefined || typeof v['language'] === 'string';
}

const isAssociatedIssue = (v: unknown): v is { issue: string; action: string | null } =>
  isRecord(v) && typeof v['issue'] === 'string' && (v['action'] === null || typeof v['action'] === 'string');

const sanitizeFileStatus = (f: FileStatus): FileStatus => ({
  status: f.status, file: f.file,
  ...(f.oldFile !== undefined ? { oldFile: f.oldFile } : {}),
  ...(f.similarityScore !== undefined ? { similarityScore: f.similarityScore } : {}),
  ...(f.insertions !== undefined ? { insertions: f.insertions } : {}),
  ...(f.deletions !== undefined ? { deletions: f.deletions } : {}),
  ...(f.isBinary !== undefined ? { isBinary: f.isBinary } : {}),
  ...(f.language !== undefined ? { language: f.language } : {}),
});

function parseCommitSize(raw: unknown): CommitEntry['size'] | undefined | null {
  if (raw === null || raw === undefined) return undefined;
  return raw === 'XS' || raw === 'S' || raw === 'M' || raw === 'L' || raw === 'XL' ? raw : null;
}

function parseJsonArray<T>(raw: unknown, col: string, hash: string, guard: (v: unknown) => v is T): T[] | undefined | null {
  const parsed = parseJsonCol(raw, col, hash);
  if (parsed === undefined) return undefined;
  const maxItems = col === 'files' ? MAX_PARSED_FILES : MAX_ARRAY_LENGTH;
  if (parsed === PARSE_FAIL || !Array.isArray(parsed) || parsed.length > maxItems || !parsed.every(guard)) return null;
  return parsed;
}

function parseValidatedMetadata(rawMeta: unknown, hash: string): CommitEntry['metadata'] | undefined | null {
  const parsed = parseJsonCol(rawMeta, 'metadata', hash);
  if (parsed === undefined) return undefined;
  if (parsed === PARSE_FAIL || !isRecord(parsed)) return null;
  const meta: NonNullable<CommitEntry['metadata']> = {};
  if (parsed['category'] !== undefined) { if (!isStringArray(parsed['category']) || parsed['category'].length > MAX_ARRAY_LENGTH) return null; meta.category = parsed['category']; }
  if (parsed['entry'] !== undefined) { if (!isStringArray(parsed['entry']) || parsed['entry'].length > MAX_ARRAY_LENGTH) return null; meta.entry = parsed['entry']; }
  if (parsed['significance'] !== undefined) { if (typeof parsed['significance'] !== 'string') return null; meta.significance = parsed['significance']; }
  if (parsed['impact'] !== undefined) { if (!isFiniteNumOrStr(parsed['impact'])) return null; meta.impact = parsed['impact']; }
  if (parsed['trust'] !== undefined) { if (!isFiniteNumOrStr(parsed['trust'])) return null; meta.trust = parsed['trust']; }
  if (parsed['confidence'] !== undefined) { if (!isFiniteNumOrStr(parsed['confidence'])) return null; meta.confidence = parsed['confidence']; }
  if (parsed['validation'] !== undefined) { if (typeof parsed['validation'] !== 'string') return null; meta.validation = parsed['validation']; }
  if (parsed['customTrailers'] !== undefined) {
    if (!isRecord(parsed['customTrailers'])) return null;
    const trailers = copySafeStringArrayRecord(parsed['customTrailers']);
    if (!trailers) return null;
    meta.customTrailers = trailers;
  }
  return meta;
}

const checkInt = checkNonNegInt;

const SCALAR_STR_FIELDS = [
  'email', 'committer', 'committerEmail', 'committerDate', 'type', 'scope',
  'breakingChangeDescription', 'revertedCommit', 'cleanSubject', 'body', 'patch', 'slackId',
] as const;
const SCALAR_INT_FIELDS = ['fileCount', 'totalInsertions', 'totalDeletions'] as const;

function hydrateScalarFields(row: Record<string, unknown>, entry: CommitEntry): boolean {
  for (const k of SCALAR_STR_FIELDS) { const v = row[k]; if (typeof v === 'string') entry[k] = v; }
  const sz = parseCommitSize(row['size']);
  if (sz === null) return false;
  if (sz !== undefined) entry.size = sz;
  for (const k of SCALAR_INT_FIELDS) { const v = row[k]; if (v !== null && v !== undefined) { if (!checkInt(v)) return false; entry[k] = v; } }
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
    entry.trailersObj = copySafeStringRecord(rawTrailers);
  }
  if (parents !== undefined) entry.parents = parents; if (refs !== undefined) entry.refs = refs;
  if (tags !== undefined) entry.tags = tags; if (files !== undefined) entry.files = files.map(sanitizeFileStatus);
  if (metadata !== undefined) entry.metadata = metadata; if (references !== undefined) entry.references = references;
  if (coAuthors !== undefined) entry.coAuthors = coAuthors; if (reviewers !== undefined) entry.reviewers = reviewers;
  if (associatedIssues !== undefined) entry.associatedIssues = associatedIssues.map((a) => ({ issue: a.issue, action: a.action }));
  if (validationErrors !== undefined) entry.validationErrors = validationErrors.map((e) => copySafePlainValue(e));
  return true;
}

function hydrateCachedRow(rawRow: unknown): CommitEntry | null {
  if (!isRecord(rawRow) || !isNonEmptyString(rawRow['commit_hash']) || !isNonEmptyString(rawRow['author']) || !isNonEmptyString(rawRow['date']) || typeof rawRow['subject'] !== 'string') {
    console.warn('[lib-git-history] Warning: Failed to validate cached SQLite row shape');
    return null;
  }
  const hash = rawRow['commit_hash'];
  const entry: CommitEntry = { commit: hash, author: rawRow['author'], date: rawRow['date'], subject: rawRow['subject'] };
  if (!hydrateScalarFields(rawRow, entry) || !hydrateJsonFields(rawRow, entry, hash)) {
    console.warn(`[lib-git-history] Warning: Failed to parse cached commit ${sanitizeLogText(hash)}`);
    return null;
  }
  return entry;
}

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException => e instanceof Error && 'code' in e;

function readUserVersion(database: Database): number {
  const row = database.query('PRAGMA user_version;').get();
  return isRecord(row) && typeof row['user_version'] === 'number' ? row['user_version'] : 0;
}

const hasValidCommitsSchema = (nextDb: Database): boolean => isValidSqliteCommitsSchema(
  nextDb.query('SELECT type, name, tbl_name, sql FROM sqlite_schema').all(),
  nextDb.query("PRAGMA table_xinfo('commits')").all(),
);

function initializeSchema(nextDb: Database): void {
  nextDb.exec('PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16384; PRAGMA foreign_keys = OFF;');
  if (readUserVersion(nextDb) === CACHE_SCHEMA_VERSION && hasValidCommitsSchema(nextDb)) return;
  nextDb.exec('BEGIN IMMEDIATE;');
  try {
    if (readUserVersion(nextDb) !== CACHE_SCHEMA_VERSION || !hasValidCommitsSchema(nextDb)) {
      dropPoisonedSchemaObjects(nextDb);
      nextDb.exec(
        `${CREATE_COMMITS_TABLE_SQL};` +
        'CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author);' +
        'CREATE INDEX IF NOT EXISTS idx_commits_type_scope ON commits(type, scope);' +
        'CREATE INDEX IF NOT EXISTS idx_commits_scope ON commits(scope);' +
        'CREATE INDEX IF NOT EXISTS idx_commits_isBreaking_true ON commits(isBreaking) WHERE isBreaking = 1;' +
        `PRAGMA user_version = ${CACHE_SCHEMA_VERSION};`,
      );
    }
    nextDb.exec('COMMIT;');
  } catch (err: unknown) { try { nextDb.exec('ROLLBACK;'); } catch { /* ignore */ } throw err; }
}

/** [INTENT]: Open an isolated cache Database handle without mutating the module singleton. */
export function openScopedCache(dbPath: string, readonly = false, expectedRootDir?: string): Database {
  const isMemory = dbPath === ':memory:';
  const targetPath = isMemory ? ':memory:' : resolve(dbPath);
  if (!isMemory) assertSafeSqlitePath(targetPath, expectedRootDir);
  if (!isMemory && !readonly) {
    try { mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 }); }
    catch (err: unknown) { if (!isErrnoException(err) || err.code !== 'EEXIST') throw err; }
  }
  const nextDb = readonly && !isMemory ? new Database(targetPath, { readonly: true }) : new Database(targetPath);
  try {
    if (readonly && !isMemory) {
      nextDb.exec('PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16384;');
      if (readUserVersion(nextDb) !== CACHE_SCHEMA_VERSION || !hasValidCommitsSchema(nextDb)) throw new Error('CacheSchemaVersionMismatch');
    } else {
      initializeSchema(nextDb);
      if (!isMemory) safeChmodSqliteFiles(targetPath);
    }
  } catch (err: unknown) { try { nextDb.close(); } catch { /* ignore */ } throw err; }
  getOrCreateDbState(nextDb, readonly && !isMemory);
  return nextDb;
}

export function initCache(dbPath?: string, readonly = false, expectedRootDir?: string): Database {
  const rawPath = dbPath || join(process.cwd(), '.agents', 'cache', 'git-history.db');
  const isMemory = rawPath === ':memory:';
  const targetPath = isMemory ? ':memory:' : resolve(rawPath);
  if (!isMemory) assertSafeSqlitePath(targetPath, expectedRootDir);
  if (db) {
    if (targetPath === currentDbPath && isReadOnly === (readonly && !isMemory)) return db;
    closeCache();
  }
  const nextDb = openScopedCache(targetPath, readonly, expectedRootDir);
  db = nextDb; currentDbPath = targetPath; isReadOnly = readonly && !isMemory;
  return nextDb;
}

export function closeCache(targetDb?: Database): void {
  const activeDb = targetDb ?? db;
  if (!activeDb) return;
  const state = dbStates.get(activeDb);
  const optimize = state ? !state.readonly : (activeDb === db && !isReadOnly);
  try {
    if (state) {
      if (state.insertStmt) { finalizeStatement(state.insertStmt); state.insertStmt = null; }
      if (state.patchUpdateStmt) { finalizeStatement(state.patchUpdateStmt); state.patchUpdateStmt = null; }
      for (const stmt of state.stmtCache.values()) finalizeStatement(stmt);
      state.stmtCache.clear(); state.insertTx = null; state.patchUpdateTx = null;
    }
    if (optimize) { try { activeDb.exec('PRAGMA optimize;'); } catch { /* ignore */ } }
    activeDb.close();
  } finally {
    dbStates.delete(activeDb);
    if (activeDb === db) { db = null; currentDbPath = null; isReadOnly = false; }
  }
}

export function hasCachedCommits(targetDb?: Database): boolean {
  const activeDb = targetDb ?? db;
  if (!activeDb) return false;
  return getOrPrepare(activeDb, 'SELECT 1 FROM commits LIMIT 1').get() !== null;
}

export interface CachedFilterProbe {
  type?: string;
  isBreaking?: boolean;
  tags?: string[];
  metadata?: CommitEntry['metadata'];
}

/** [INTENT]: Lightweight 3-5 column probe for warm-cache TS post-filters; avoids full hydration on non-matching rows. */
export function batchProbeCommitFilters(shas: string[], includeMetadata: boolean, includeTags = false, targetDb?: Database): Map<string, CachedFilterProbe> {
  if (shas.length === 0) return new Map();
  const currentDb = targetDb ?? db ?? initCache();
  const cols = `c.commit_hash, c.type, c.isBreaking${includeMetadata ? ', c.metadata' : ''}${includeTags ? ', c.tags' : ''}`;
  const CHUNK = 500;
  const result = new Map<string, CachedFilterProbe>();

  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const rows = getOrPrepare(currentDb, `SELECT ${cols} FROM commits c JOIN json_each(?) j ON c.commit_hash = j.value`).all(JSON.stringify(chunk));
    for (const row of rows) {
      if (!isRecord(row) || !isNonEmptyString(row['commit_hash'])) continue;
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

export function updateCommitPatches(updates: PatchUpdateRow[], targetDb?: Database): void {
  if (updates.length === 0) return;
  const currentDb = targetDb ?? db ?? initCache();
  const state = getOrCreateDbState(currentDb);
  if (state.readonly) return;
  if (!state.patchUpdateTx) {
    const stmt = currentDb.prepare('UPDATE commits SET patch = ?, isPatchTruncated = ? WHERE commit_hash = ?');
    state.patchUpdateStmt = stmt;
    state.patchUpdateTx = currentDb.transaction((rows: PatchUpdateRow[]) => {
      for (const r of rows) stmt.run(r.patch, r.isPatchTruncated ? 1 : 0, r.commit);
    }).immediate;
  }
  state.patchUpdateTx(updates);
}

export function insertCommits(batch: CommitEntry[], targetDb?: Database): void {
  if (batch.length === 0) return;
  const currentDb = targetDb ?? db ?? initCache();
  const state = getOrCreateDbState(currentDb);
  if (state.readonly) return;
  if (!state.insertTx) {
    const insert = currentDb.prepare(INSERT_COMMIT_SQL);
    state.insertStmt = insert;
    state.insertTx = currentDb.transaction((commits: CommitEntry[]) => {
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
  }
  state.insertTx(batch);
}

export type QueryCommitsFilter = Pick<Partial<CommitEntry>, 'commit' | 'author' | 'type' | 'scope' | 'isBreaking'>;

export function queryCommits(filters: QueryCommitsFilter = {}, targetDb?: Database): CommitEntry[] {
  const currentDb = targetDb ?? db ?? initCache();
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};
  if (filters.commit) { conditions.push('commit_hash = $commit'); params['$commit'] = filters.commit; }
  if (filters.author) { conditions.push('author = $author'); params['$author'] = filters.author; }
  if (filters.type) { conditions.push('type = $type'); params['$type'] = filters.type; }
  if (filters.scope) { conditions.push('scope = $scope'); params['$scope'] = filters.scope; }
  // [INTENT]: Literal `= 1` enables SQLite to match the partial index `idx_commits_isBreaking_true`.
  if (typeof filters.isBreaking === 'boolean') conditions.push(filters.isBreaking ? 'isBreaking = 1' : 'isBreaking = 0');
  const query = conditions.length > 0 ? `SELECT * FROM commits WHERE ${conditions.join(' AND ')}` : 'SELECT * FROM commits';
  const results: CommitEntry[] = [];
  for (const row of getOrPrepare(currentDb, query).all(params)) {
    const hydrated = hydrateCachedRow(row);
    if (hydrated !== null) results.push(hydrated);
  }
  return results;
}

/** Batch-query commits by SHA list via `JOIN json_each(?)`, reusing 1 prepared statement per projection. */
export function batchQueryCommits(shas: string[], projection: CacheProjection = 'full', targetDb?: Database): Map<string, CommitEntry> {
  if (shas.length === 0) return new Map();
  const currentDb = targetDb ?? db ?? initCache();
  const CHUNK = 500;
  const cols = CACHE_PROJECTION_COLUMNS.get(projection) ?? 'c.*';
  const result = new Map<string, CommitEntry>();
  for (let i = 0; i < shas.length; i += CHUNK) {
    const chunk = shas.slice(i, i + CHUNK);
    const rows = getOrPrepare(currentDb, `SELECT ${cols} FROM commits c JOIN json_each(?) j ON c.commit_hash = j.value`).all(JSON.stringify(chunk));
    for (const row of rows) {
      if (isRecord(row) && typeof row['commit_hash'] === 'string' && result.has(row['commit_hash'])) continue;
      const hydrated = hydrateCachedRow(row);
      if (hydrated !== null) result.set(hydrated.commit, hydrated);
    }
  }
  return result;
}
