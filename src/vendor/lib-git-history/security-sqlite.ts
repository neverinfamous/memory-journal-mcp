// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { hasUnsafeWin32PathSyntax, isPathContained } from './security-utils.js';

export const EXPECTED_COMMITS_COL_TYPES: ReadonlyMap<string, 'TEXT' | 'INTEGER'> = new Map([
  ['commit_hash', 'TEXT'], ['type', 'TEXT'], ['scope', 'TEXT'], ['isBreaking', 'INTEGER'], ['tags', 'TEXT'], ['metadata', 'TEXT'],
  ['parents', 'TEXT'], ['refs', 'TEXT'], ['author', 'TEXT'], ['email', 'TEXT'], ['committer', 'TEXT'], ['committerEmail', 'TEXT'],
  ['committerDate', 'TEXT'], ['date', 'TEXT'], ['breakingChangeDescription', 'TEXT'], ['isRevert', 'INTEGER'],
  ['revertedCommit', 'TEXT'], ['isRebased', 'INTEGER'], ['subject', 'TEXT'], ['cleanSubject', 'TEXT'],
  ['isBodyTruncated', 'INTEGER'], ['size', 'TEXT'], ['fileCount', 'INTEGER'], ['isFilesTruncated', 'INTEGER'],
  ['totalInsertions', 'INTEGER'], ['totalDeletions', 'INTEGER'], ['trailersObj', 'TEXT'], ['isPatchTruncated', 'INTEGER'],
  ['references', 'TEXT'], ['coAuthors', 'TEXT'], ['reviewers', 'TEXT'], ['associatedIssues', 'TEXT'], ['slackId', 'TEXT'],
  ['validationErrors', 'TEXT'], ['isCorrupted', 'INTEGER'], ['files', 'TEXT'], ['body', 'TEXT'], ['patch', 'TEXT'],
]);

const EXPECTED_COMMITS_INDEXES: ReadonlyMap<string, string> = new Map([
  ['idx_commits_author', 'CREATE INDEX idx_commits_author ON commits(author)'],
  ['idx_commits_type_scope', 'CREATE INDEX idx_commits_type_scope ON commits(type, scope)'],
  ['idx_commits_scope', 'CREATE INDEX idx_commits_scope ON commits(scope)'],
  ['idx_commits_isBreaking_true', 'CREATE INDEX idx_commits_isBreaking_true ON commits(isBreaking) WHERE isBreaking = 1'],
]);

export const CREATE_COMMITS_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS commits (commit_hash TEXT PRIMARY KEY, type TEXT, scope TEXT, isBreaking INTEGER, tags TEXT, metadata TEXT, ' +
  'parents TEXT, refs TEXT, author TEXT, email TEXT, committer TEXT, committerEmail TEXT, committerDate TEXT, date TEXT, ' +
  'breakingChangeDescription TEXT, isRevert INTEGER, revertedCommit TEXT, isRebased INTEGER, subject TEXT, cleanSubject TEXT, ' +
  'isBodyTruncated INTEGER, size TEXT, fileCount INTEGER, isFilesTruncated INTEGER, totalInsertions INTEGER, totalDeletions INTEGER, ' +
  'trailersObj TEXT, isPatchTruncated INTEGER, "references" TEXT, coAuthors TEXT, reviewers TEXT, associatedIssues TEXT, ' +
  'slackId TEXT, validationErrors TEXT, isCorrupted INTEGER, files TEXT, body TEXT, patch TEXT) STRICT';

const WHITESPACE_RUN_RE = /\s+/g;
const CANONICAL_COMMITS_TABLE_DDL = CREATE_COMMITS_TABLE_SQL
  .trim()
  .replace(WHITESPACE_RUN_RE, ' ')
  .replace(/^CREATE TABLE IF NOT EXISTS /i, 'CREATE TABLE ');

export function assertSafeSqlitePath(targetPath: string, expectedRootDir?: string): void {
  if (expectedRootDir !== undefined && expectedRootDir.trim() === '') {
    throw new Error('Expected SQLite repository root directory must not be blank.');
  }
  const resolvedTarget = path.resolve(targetPath);
  if (hasUnsafeWin32PathSyntax(targetPath) || hasUnsafeWin32PathSyntax(resolvedTarget)) {
    throw new Error(`Unsafe SQLite cache path syntax: ${targetPath}`);
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const st = fs.lstatSync(`${resolvedTarget}${suffix}`, { throwIfNoEntry: false });
    if (st && (st.isSymbolicLink() || !st.isFile())) {
      throw new Error(`Unsafe SQLite cache artifact (symlink or non-file): ${resolvedTarget}${suffix}`);
    }
  }
  const resolvedRoot = expectedRootDir !== undefined ? path.resolve(expectedRootDir) : undefined;
  if (resolvedRoot && (!isPathContained(resolvedRoot, resolvedTarget) || path.relative(resolvedRoot, resolvedTarget) === '')) {
    throw new Error(`SQLite cache path escapes repository root: ${targetPath}`);
  }
  const realRoot = resolvedRoot ? fs.realpathSync(resolvedRoot) : undefined;
  let probe = path.dirname(resolvedTarget);
  let steps = 0;
  let checkedContained = false;
  while (probe !== path.dirname(probe)) {
    if (!resolvedRoot && steps >= 4) break;
    const st = fs.lstatSync(probe, { throwIfNoEntry: false });
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`SQLite cache ancestor is unsafe: ${probe}`);
      if (realRoot && !checkedContained) {
        if (!isPathContained(realRoot, fs.realpathSync(probe))) throw new Error(`SQLite cache path escapes repository root: ${targetPath}`);
        checkedContained = true;
      }
      steps++;
    }
    if (resolvedRoot && path.relative(resolvedRoot, probe) === '') return;
    probe = path.dirname(probe);
  }
  if (resolvedRoot) throw new Error(`SQLite cache path escapes repository root: ${targetPath}`);
}

export function safeChmodSqliteFiles(targetPath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.chmodSync(`${targetPath}${suffix}`, 0o600); } catch { /* ignore */ }
  }
}

function validateCommitsTableRow(name: string, sql: unknown): boolean {
  if (name !== 'commits' || typeof sql !== 'string') return false;
  return sql.trim().replace(WHITESPACE_RUN_RE, ' ') === CANONICAL_COMMITS_TABLE_DDL;
}

function validateCommitsIndexRow(name: string, tblName: unknown, sql: unknown): boolean {
  const expectedSql = EXPECTED_COMMITS_INDEXES.get(name);
  if (!expectedSql || tblName !== 'commits' || typeof sql !== 'string') return false;
  const norm = sql.trim().replace(WHITESPACE_RUN_RE, ' ');
  return norm === expectedSql;
}

export function isValidSqliteCommitsSchema(schemaRows: unknown[], colRows: unknown[]): boolean {
  let seenCommitsTable = false;
  for (const row of schemaRows) {
    if (row === null || typeof row !== 'object' || !('type' in row) || !('name' in row)) return false;
    const type = row.type;
    const name = row.name;
    const tblName = 'tbl_name' in row ? row.tbl_name : undefined;
    const sql = 'sql' in row ? row.sql : undefined;
    if (typeof type !== 'string' || typeof name !== 'string') return false;
    if (type === 'table' && (name === 'sqlite_stat1' || name === 'sqlite_stat4')) continue;
    if (type === 'index' && name === 'sqlite_autoindex_commits_1' && tblName === 'commits' && sql === null) continue;
    if (type === 'table') {
      if (!validateCommitsTableRow(name, sql)) return false;
      seenCommitsTable = true;
    } else if (type === 'index') {
      if (!validateCommitsIndexRow(name, tblName, sql)) return false;
    } else {
      return false;
    }
  }
  if (!seenCommitsTable || colRows.length !== EXPECTED_COMMITS_COL_TYPES.size) return false;
  const seenCols = new Set<string>();
  for (const col of colRows) {
    if (
      col === null || typeof col !== 'object' ||
      !('name' in col) || !('type' in col) || !('pk' in col) || !('notnull' in col) || !('hidden' in col)
    ) {
      return false;
    }
    const { name, type, pk, notnull, hidden } = col;
    if (
      typeof name !== 'string' || typeof type !== 'string' ||
      typeof pk !== 'number' || typeof notnull !== 'number' || typeof hidden !== 'number'
    ) {
      return false;
    }
    if (hidden !== 0) return false;
    const expectedType = EXPECTED_COMMITS_COL_TYPES.get(name);
    if (!expectedType || type.toUpperCase() !== expectedType || seenCols.has(name)) return false;
    if (name === 'commit_hash' ? pk !== 1 : (pk !== 0 || notnull !== 0)) return false;
    seenCols.add(name);
  }
  return seenCols.size === EXPECTED_COMMITS_COL_TYPES.size;
}

const DROP_TYPE_SQL: ReadonlyMap<string, string> = new Map([
  ['view', 'VIEW'],
  ['trigger', 'TRIGGER'],
  ['index', 'INDEX'],
  ['table', 'TABLE'],
]);

export function dropPoisonedSchemaObjects(nextDb: {
  query: (sql: string) => { all: () => unknown[] };
  exec: (sql: string) => void;
}): void {
  const rows = nextDb.query(
    "SELECT type, name FROM sqlite_schema WHERE type IN ('view','trigger','index','table') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'trigger' THEN 1 WHEN 'index' THEN 2 ELSE 3 END",
  ).all();
  for (const r of rows) {
    if (r === null || typeof r !== 'object' || !('type' in r) || !('name' in r)) continue;
    if (typeof r.type !== 'string' || typeof r.name !== 'string') continue;
    const kw = DROP_TYPE_SQL.get(r.type);
    if (kw) nextDb.exec(`DROP ${kw} IF EXISTS "${r.name.replace(/"/g, '""')}"`);
  }
}
