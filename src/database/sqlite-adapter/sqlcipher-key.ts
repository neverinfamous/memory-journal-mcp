import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'

const HEX_CIPHER_KEY_RE = /^x'[0-9a-fA-F]+'$/

/**
 * [INTENT] Apply SQLCipher encryption key from environment variables to a native DB handle.
 * Must run before any other PRAGMA or query against an encrypted SQLite database.
 */
export function applySqlCipherKey(db: Database, logSuccess = false): void {
    const rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] || process.env['DB_ENCRYPTION_KEY']
    if (rawKey === undefined || rawKey === '') return
    if (rawKey.startsWith("x'") && rawKey.endsWith("'")) {
        if (!HEX_CIPHER_KEY_RE.test(rawKey)) {
            throw new Error('Invalid hex encryption key format')
        }
        // Raw hex keys must not be wrapped in additional single quotes
        db.pragma(`key = "${rawKey}"`)
    } else {
        const escapedKey = rawKey.replace(/'/g, "''")
        db.pragma(`key = '${escapedKey}'`)
    }
    if (logSuccess) {
        logger.info('Database encryption key applied', { module: 'NativeConnectionManager' })
    }
}
