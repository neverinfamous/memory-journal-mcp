import * as fs from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import type { Database } from 'better-sqlite3'

const SQLITE_HEADER_MAGIC = Buffer.from('SQLite format 3\0', 'ascii')
const MIN_VALID_BACKUP_BYTES = 512

const ALLOWED_FTS_TRIGGERS = new Set([
    'fts_content_ai',
    'fts_content_au',
    'fts_content_ad',
    'fts_content_soft_delete',
    'fts_content_restore',
])

const CREATE_VIRTUAL_TABLE_RE = /^\s*CREATE\s+VIRTUAL\s+TABLE\b/i

interface SqliteMasterRow {
    type?: unknown
    name?: unknown
    tbl_name?: unknown
    sql?: unknown
}

/**
 * Verifies the incoming backup path is a regular non-symlink file of at least 512 bytes
 * and rejects plaintext SQLite headers whenever an encryption key is configured.
 */
export function assertBackupHeaderAndCipherFormat(backupPath: string, cipherRequired: boolean): void {
    const fd = fs.openSync(backupPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    try {
        const stat = fs.fstatSync(fd)
        if (!stat.isFile()) {
            throw new Error('Incoming backup target is not a regular file')
        }
        if (stat.size < MIN_VALID_BACKUP_BYTES) {
            throw new Error(`Incoming backup file is truncated (${String(stat.size)} bytes)`)
        }
        const header = Buffer.alloc(16)
        const bytesRead = fs.readSync(fd, header, 0, 16, 0)
        if (bytesRead < 16) {
            throw new Error('Could not read SQLite file header')
        }
        if (cipherRequired && header.equals(SQLITE_HEADER_MAGIC)) {
            throw new Error(
                'Unencrypted SQLite backup header rejected while database encryption key is active'
            )
        }
    } finally {
        fs.closeSync(fd)
    }
}

const CANONICAL_FTS_TRIGGER_RE =
    /^\s*CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(?:fts_content_ai|fts_content_au|fts_content_ad|fts_content_soft_delete|fts_content_restore)["`\]]?\s+AFTER\s+(?:INSERT|DELETE|UPDATE\s+OF\s+(?:content|deleted_at))\s+ON\s+["`[]?memory_journal["`\]]?(?:\s+WHEN\s+(?:old\.deleted_at\s+IS\s+NULL(?:\s+AND\s+new\.deleted_at\s+IS\s+NULL)?|new\.deleted_at\s+IS\s+(?:NOT\s+)?NULL\s+AND\s+old\.deleted_at\s+IS\s+(?:NOT\s+)?NULL))?\s+BEGIN\s+(?:INSERT\s+INTO\s+["`[]?fts_content["`\]]?\s*\((?:fts_content,\s*)?rowid,\s*content\)\s*VALUES\s*\((?:'delete',\s*old\.id,\s*old\.content|new\.id,\s*new\.content)\)\s*;\s*){1,2}END\s*;?\s*$/i

function isAllowedTrigger(name: string, tblName: string, sql: string): boolean {
    return (
        tblName === 'memory_journal' &&
        ALLOWED_FTS_TRIGGERS.has(name) &&
        CANONICAL_FTS_TRIGGER_RE.test(sql)
    )
}

function isAllowedVirtualTable(name: string, sql: string): boolean {
    if (name === 'fts_content' && /\bUSING\s+fts5\b/i.test(sql)) return true
    if (name === 'vec_embeddings' && /\bUSING\s+vec0\b/i.test(sql)) return true
    return false
}

/**
 * Disables `trusted_schema` on the inspection handle and rejects any SQLite views,
 * non-allowlisted triggers, or non-allowlisted virtual tables before `integrity_check`.
 */
export function assertSafeBackupSchemaPreIntegrity(tempDb: Database): { hasVecTable: boolean } {
    tempDb.pragma('trusted_schema = OFF')
    const rows = tempDb
        .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master')
        .all() as SqliteMasterRow[]

    let hasVecTable = false
    for (const row of rows) {
        const type = typeof row.type === 'string' ? row.type : ''
        const name = typeof row.name === 'string' ? row.name : ''
        const tblName = typeof row.tbl_name === 'string' ? row.tbl_name : ''
        const sql = typeof row.sql === 'string' ? row.sql : ''

        if (type === 'view') {
            throw new Error(`Disallowed SQLite view in backup: ${name}`)
        }
        if (type === 'trigger' && !isAllowedTrigger(name, tblName, sql)) {
            throw new Error(`Disallowed SQLite trigger in backup: ${name}`)
        }
        if (type === 'table' && CREATE_VIRTUAL_TABLE_RE.test(sql)) {
            if (!isAllowedVirtualTable(name, sql)) {
                throw new Error(`Disallowed SQLite virtual table in backup: ${name}`)
            }
            if (name === 'vec_embeddings') {
                hasVecTable = true
            }
        }
    }
    return { hasVecTable }
}

/** Ensures the restored database contains the canonical regular `memory_journal` table. */
export function assertHasMemoryJournalTable(tempDb: Database): void {
    const rows = tempDb
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'"
        )
        .all() as { sql?: unknown }[]
    const row = rows[0]
    const sql = typeof row?.sql === 'string' ? row.sql : ''
    if (row === undefined || CREATE_VIRTUAL_TABLE_RE.test(sql)) {
        throw new Error('Missing canonical memory_journal table in backup file')
    }
}
