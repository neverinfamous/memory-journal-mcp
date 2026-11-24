import * as fs from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import type { Database } from 'better-sqlite3'
import { isRecord } from '../../utils/type-guards.js'
import {
    assertSafeTableAndIndexDdl,
    isAllowedBackupVirtualTable,
    stripSqlComments,
} from './backup-ddl-validators.js'

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
        CANONICAL_FTS_TRIGGER_RE.test(stripSqlComments(sql))
    )
}

/**
 * Disables `trusted_schema` on the inspection handle and rejects any SQLite views,
 * non-allowlisted triggers, non-allowlisted virtual tables, or unsafe table/index DDLs before `integrity_check`.
 */
export function assertSafeBackupSchemaPreIntegrity(tempDb: Database): { hasVecTable: boolean } {
    tempDb.pragma('trusted_schema = OFF')
    const rawTableList: unknown = tempDb.pragma('table_list')
    const virtualTableNames = new Set<string>()
    if (Array.isArray(rawTableList)) {
        for (const entry of rawTableList) {
            if (isRecord(entry) && entry['type'] === 'virtual' && typeof entry['name'] === 'string') {
                virtualTableNames.add(entry['name'])
            }
        }
    }

    const rows = tempDb
        .prepare<unknown[], SqliteMasterRow>('SELECT type, name, tbl_name, sql FROM sqlite_master')
        .all()

    let hasVecTable = false
    const checkedVirtual = new Set<string>()
    for (const row of rows) {
        const type = typeof row.type === 'string' ? row.type : ''
        const name = typeof row.name === 'string' ? row.name : ''
        const tblName = typeof row.tbl_name === 'string' ? row.tbl_name : ''
        const sql = typeof row.sql === 'string' ? row.sql : ''
        const cleanSql = stripSqlComments(sql)

        if (type === 'view') {
            throw new Error(`Disallowed SQLite view in backup: ${name}`)
        }
        if (type === 'trigger' && !isAllowedTrigger(name, tblName, sql)) {
            throw new Error(`Disallowed SQLite trigger in backup: ${name}`)
        }
        if (type === 'table' && (virtualTableNames.has(name) || CREATE_VIRTUAL_TABLE_RE.test(cleanSql))) {
            checkedVirtual.add(name)
            if (!isAllowedBackupVirtualTable(name, cleanSql)) {
                throw new Error(`Disallowed SQLite virtual table in backup: ${name}`)
            }
            if (name === 'vec_embeddings') {
                hasVecTable = true
            }
        } else if ((type === 'table' || type === 'index') && cleanSql.trim() !== '') {
            assertSafeTableAndIndexDdl(type, name, cleanSql)
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
    const rawTableInfo: unknown = tempDb.pragma("table_list('memory_journal')")
    const tableInfo = Array.isArray(rawTableInfo)
        ? rawTableInfo.find(
              (row): row is Record<string, unknown> =>
                  isRecord(row) && row['name'] === 'memory_journal'
          )
        : undefined
    const rows = tempDb
        .prepare<unknown[], { sql?: unknown }>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'"
        )
        .all()
    const row = rows[0]
    const sql = typeof row?.sql === 'string' ? row.sql : ''
    if (
        row === undefined ||
        tableInfo?.['type'] !== 'table' ||
        CREATE_VIRTUAL_TABLE_RE.test(stripSqlComments(sql))
    ) {
        throw new Error('Missing canonical memory_journal table in backup file')
    }
}

function writeAllBytes(
    destFh: fs.promises.FileHandle,
    buf: Buffer,
    bytesRead: number,
    offset: number
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const writeNext = (written: number): void => {
            if (written >= bytesRead) {
                resolve()
                return
            }
            destFh
                .write(buf, written, bytesRead - written, offset + written)
                .then((res) => {
                    writeNext(written + res.bytesWritten)
                })
                .catch((err: unknown) => {
                    reject(err instanceof Error ? err : new Error(String(err)))
                })
        }
        writeNext(0)
    })
}

function copyHandleChunks(
    srcFh: fs.promises.FileHandle,
    destFh: fs.promises.FileHandle,
    buf: Buffer
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const readNext = (offset: number): void => {
            srcFh
                .read(buf, 0, buf.length, offset)
                .then(({ bytesRead }) => {
                    if (bytesRead === 0) {
                        resolve()
                        return
                    }
                    return writeAllBytes(destFh, buf, bytesRead, offset).then(() => {
                        readNext(offset + bytesRead)
                    })
                })
                .catch((err: unknown) => {
                    reject(err instanceof Error ? err : new Error(String(err)))
                })
        }
        readNext(0)
    })
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
        await copyHandleChunks(srcFh, destFh, buf)
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
