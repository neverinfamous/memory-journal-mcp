import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'

const HEX_CIPHER_KEY_RE = /^x'[0-9a-fA-F]+'$/

/**
 * [INTENT] Apply SQLCipher encryption key from environment variables to a native DB handle.
 * Must run before any other PRAGMA or query against an encrypted SQLite database.
 */
/** Resolve raw SQLCipher key from MJ_DB_ENCRYPTION_KEY or DB_ENCRYPTION_KEY. */
export function resolveRawSqlCipherKey(): string | undefined {
    const rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] || process.env['DB_ENCRYPTION_KEY']
    return rawKey !== undefined && rawKey !== '' ? rawKey : undefined
}

/** Return true when a non-empty SQLCipher key env var is configured. */
export function hasSqlCipherKey(): boolean {
    return resolveRawSqlCipherKey() !== undefined
}

export function applySqlCipherKey(db: Database, logSuccess = false): void {
    const rawKey = resolveRawSqlCipherKey()
    if (rawKey === undefined) return
    if (rawKey.includes('\0')) {
        throw new Error('Invalid encryption key: null bytes are not allowed')
    }
    if (rawKey.startsWith("x'") && rawKey.endsWith("'") && !HEX_CIPHER_KEY_RE.test(rawKey)) {
        throw new Error('Invalid hex encryption key format')
    }
    try {
        if (rawKey.startsWith("x'") && rawKey.endsWith("'")) {
            // Raw hex keys must not be wrapped in additional single quotes
            db.pragma(`key = "${rawKey}"`)
        } else {
            const escapedKey = rawKey.replace(/'/g, "''")
            db.pragma(`key = '${escapedKey}'`)
        }
    } catch {
        throw new Error('Failed to apply SQLCipher database encryption key')
    }
    if (logSuccess) {
        logger.info('Database encryption key applied', { module: 'NativeConnectionManager' })
    }
}
