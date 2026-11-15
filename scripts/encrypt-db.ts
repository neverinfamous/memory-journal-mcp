import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
    options: {
        in: { type: 'string' },
        out: { type: 'string' },
        key: { type: 'string' },
    },
})

const inPath = values.in
const outPath = values.out
const key = values.key || process.env['DB_ENCRYPTION_KEY']

if (!inPath || !outPath || !key) {
    console.error('Usage: npm run encrypt-db -- --in <plaintext.db> --out <encrypted.db> [--key <secret>]')
    console.error('If --key is omitted, DB_ENCRYPTION_KEY environment variable will be used.')
    process.exit(1)
}

if (!fs.existsSync(inPath)) {
    console.error(`Input database not found: ${inPath}`)
    process.exit(1)
}

if (fs.existsSync(outPath)) {
    console.error(`Output database already exists: ${outPath}`)
    process.exit(1)
}

console.log(`Encrypting ${inPath} -> ${outPath}...`)

const SQLITE_PLAIN_HEADER = 'SQLite format 3\u0000'

function applyKey(db: Database.Database, pragma: 'key' | 'rekey', secret: string): void {
    if (secret.startsWith("x'") && secret.endsWith("'")) {
        db.pragma(`${pragma} = "${secret.replace(/"/g, '""')}"`)
    } else {
        db.pragma(`${pragma} = '${secret.replace(/'/g, "''")}'`)
    }
}

try {
    // [INVARIANT] Fold pending WAL frames into the main file first; copying only the .db would silently drop them.
    const source = new Database(inPath, { fileMustExist: true })
    try {
        source.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
        source.close()
    }

    // SQLite3 Multiple Ciphers uses PRAGMA rekey for in-place encryption
    // So we copy the database, open the copy, and apply the rekey PRAGMA.
    fs.copyFileSync(inPath, outPath)

    const db = new Database(outPath)
    try {
        // [INVARIANT] rekey is unsupported in WAL mode; switch the copy to rollback journaling.
        db.pragma('journal_mode = DELETE')
        applyKey(db, 'rekey', key)
    } finally {
        db.close()
    }

    // Verify: the header must no longer be plaintext, and the key must open the database.
    const header = Buffer.alloc(16)
    const fd = fs.openSync(outPath, 'r')
    try {
        fs.readSync(fd, header, 0, 16, 0)
    } finally {
        fs.closeSync(fd)
    }
    if (header.toString('latin1') === SQLITE_PLAIN_HEADER) {
        throw new Error('PRAGMA rekey had no effect: output still has a plaintext SQLite header (is SQLite3 Multiple Ciphers loaded?).')
    }
    const verify = new Database(outPath, { fileMustExist: true })
    try {
        applyKey(verify, 'key', key)
        verify.prepare('SELECT count(*) FROM sqlite_master').get()
    } finally {
        verify.close()
    }

    console.log('✅ Database encrypted and verified successfully.')
    console.log('To use it, start the server with DB_ENCRYPTION_KEY=<your-key>')
    console.log(`and point the database configuration to ${outPath}.`)
} catch (error) {
    console.error('❌ Failed to encrypt database:', error)
    if (fs.existsSync(outPath)) {
        try {
            fs.unlinkSync(outPath)
            console.log(`Cleaned up partial output file: ${outPath}`)
        } catch (e) {
            console.warn(`Warning: Failed to clean up partial output file ${outPath}:`, e)
        }
    }
    process.exit(1)
}
