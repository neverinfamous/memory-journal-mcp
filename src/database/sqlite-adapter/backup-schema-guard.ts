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

const FTS_CONTENT_VTAB_RE =
    /^\s*CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`[]?main["`\]]?\.)?["`[]?fts_content["`\]]?\s+USING\s+fts5\s*\(/i
const VEC_EMBEDDINGS_VTAB_RE =
    /^\s*CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`[]?main["`\]]?\.)?["`[]?vec_embeddings["`\]]?\s+USING\s+vec0\s*\(/i

function scanSqlQuotedSpan(sql: string, start: number, open: string): number {
    const close = open === '[' ? ']' : open
    let i = start + 1
    while (i < sql.length) {
        const c = sql[i] ?? ''
        if (c === close) {
            if (close !== ']' && sql[i + 1] === close) {
                i += 2
                continue
            }
            return i + 1
        }
        i++
    }
    return i
}

function stripSqlComments(sql: string): string {
    let out = ''
    let i = 0
    while (i < sql.length) {
        const ch = sql[i] ?? ''
        const next = sql[i + 1] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            const end = scanSqlQuotedSpan(sql, i, ch)
            out += sql.slice(i, end)
            i = end
            continue
        }
        if (ch === '-' && next === '-') {
            const nl = sql.indexOf('\n', i + 2)
            i = nl === -1 ? sql.length : nl + 1
            out += ' '
            continue
        }
        if (ch === '/' && next === '*') {
            const end = sql.indexOf('*/', i + 2)
            i = end === -1 ? sql.length : end + 2
            out += ' '
            continue
        }
        out += ch
        i++
    }
    return out
}

function isAllowedTrigger(name: string, tblName: string, sql: string): boolean {
    return (
        tblName === 'memory_journal' &&
        ALLOWED_FTS_TRIGGERS.has(name) &&
        CANONICAL_FTS_TRIGGER_RE.test(stripSqlComments(sql))
    )
}

function isAllowedVirtualTable(name: string, sql: string): boolean {
    const cleanSql = stripSqlComments(sql)
    if (name === 'fts_content') return FTS_CONTENT_VTAB_RE.test(cleanSql)
    if (name === 'vec_embeddings') return VEC_EMBEDDINGS_VTAB_RE.test(cleanSql)
    return false
}

/**
 * Disables `trusted_schema` on the inspection handle and rejects any SQLite views,
 * non-allowlisted triggers, or non-allowlisted virtual tables before `integrity_check`.
 */
export function assertSafeBackupSchemaPreIntegrity(tempDb: Database): { hasVecTable: boolean } {
    tempDb.pragma('trusted_schema = OFF')
    const tableListRows = tempDb.pragma('table_list') as { schema?: unknown; name?: unknown; type?: unknown }[]
    const virtualTableNames = new Set<string>()
    for (const entry of tableListRows) {
        if (entry.type === 'virtual' && typeof entry.name === 'string') {
            virtualTableNames.add(entry.name)
        }
    }

    const rows = tempDb
        .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master')
        .all() as SqliteMasterRow[]

    let hasVecTable = false
    const checkedVirtual = new Set<string>()
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
        if (type === 'table' && (virtualTableNames.has(name) || CREATE_VIRTUAL_TABLE_RE.test(stripSqlComments(sql)))) {
            checkedVirtual.add(name)
            if (!isAllowedVirtualTable(name, sql)) {
                throw new Error(`Disallowed SQLite virtual table in backup: ${name}`)
            }
            if (name === 'vec_embeddings') {
                hasVecTable = true
            }
        }
    }
    for (const vname of virtualTableNames) {
        if (!checkedVirtual.has(vname)) {
            throw new Error(`Disallowed SQLite virtual table in backup: ${vname}`)
        }
    }
    return { hasVecTable }
}

/** Ensures the restored database contains the canonical regular `memory_journal` table. */
export function assertHasMemoryJournalTable(tempDb: Database): void {
    const tableInfo = (tempDb.pragma("table_list('memory_journal')") as { name?: unknown; type?: unknown }[])
        .find((row) => row.name === 'memory_journal')
    const rows = tempDb
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'"
        )
        .all() as { sql?: unknown }[]
    const row = rows[0]
    const sql = typeof row?.sql === 'string' ? row.sql : ''
    if (
        row === undefined ||
        tableInfo?.type !== 'table' ||
        CREATE_VIRTUAL_TABLE_RE.test(stripSqlComments(sql))
    ) {
        throw new Error('Missing canonical memory_journal table in backup file')
    }
}

/** Copies a regular non-symlink file to a new `0o600` destination using `O_NOFOLLOW`. */
export async function copyRegularFileNoFollow(sourcePath: string, destPath: string): Promise<void> {
    const lstatInfo = await fs.promises.lstat(sourcePath)
    if (lstatInfo.isSymbolicLink() || !lstatInfo.isFile()) {
        throw new Error('Backup restore target must be a regular non-symlink file.')
    }
    const srcFh = await fs.promises.open(
        sourcePath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    )
    let destFh: fs.promises.FileHandle | undefined
    try {
        const srcStat = await srcFh.stat()
        if (!srcStat.isFile()) {
            throw new Error('Backup restore target is not a regular file.')
        }
        destFh = await fs.promises.open(
            destPath,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
            0o600
        )
        const buf = Buffer.allocUnsafe(65_536)
        let offset = 0
        for (;;) {
            const { bytesRead } = await srcFh.read(buf, 0, buf.length, offset)
            if (bytesRead === 0) break
            let written = 0
            while (written < bytesRead) {
                const res = await destFh.write(buf, written, bytesRead - written, offset + written)
                written += res.bytesWritten
            }
            offset += bytesRead
        }
    } catch (err) {
        if (destFh !== undefined) {
            await destFh.close().catch(() => undefined)
            destFh = undefined
            await fs.promises.unlink(destPath).catch(() => undefined)
        }
        throw err
    } finally {
        if (destFh !== undefined) await destFh.close().catch(() => undefined)
        await srcFh.close().catch(() => undefined)
    }
}
