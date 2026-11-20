import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
    options: {
        in: { type: 'string' },
        out: { type: 'string' },
    },
})

const inPath = values.in
const outPath = values.out
const key = process.env['MJ_DB_ENCRYPTION_KEY'] || process.env['DB_ENCRYPTION_KEY']

if (!inPath || !outPath || !key) {
    console.error('Usage: DB_ENCRYPTION_KEY=<secret> npm run encrypt-db -- --in <plaintext.db> --out <encrypted.db>')
    console.error('Set MJ_DB_ENCRYPTION_KEY or DB_ENCRYPTION_KEY in the environment (CLI --key flag disabled to prevent process-table exposure).')
    process.exit(1)
}
if (key.includes('\0')) {
    console.error('Invalid encryption key: NUL bytes are not allowed.')
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
    if (secret.startsWith("x'") || secret.startsWith("X'")) {
        if (!/^x'(?:[0-9a-fA-F]{2})+'$/i.test(secret)) {
            throw new Error("Invalid hex encryption key: expected x'<even hex digits>'")
        }
        db.pragma(`${pragma} = ${secret}`)
    } else {
        db.pragma(`${pragma} = '${secret.replace(/'/g, "''")}'`)
    }
}

function sanitizeScriptError(err: unknown, secret?: string): string {
    const raw = err instanceof Error ? err.message : String(err)
    let safe = raw
        .replace(/x'[0-9a-fA-F]*'/gi, "x'[REDACTED]'")
        .replace(/(pragma\s+(?:re)?key\s*=\s*)(?:"(?:[^"]|"")*"|'(?:[^']|'')*')/gi, "$1'[REDACTED]'")
    if (secret !== undefined && secret.length > 0) {
        safe = safe.replaceAll(secret, '[REDACTED]')
        const escaped = secret.replace(/'/g, "''")
        if (escaped !== secret) {
            safe = safe.replaceAll(escaped, '[REDACTED]')
        }
    }
    return safe
}

const tmpPath = `${outPath}.tmp-${String(process.pid)}`

function removeIfExists(filePath: string): void {
    if (!fs.existsSync(filePath)) return
    try {
        fs.unlinkSync(filePath)
    } catch (e) {
        console.warn(`Warning: Failed to clean up temporary file ${filePath}: ${sanitizeScriptError(e, key)}`)
    }
}

try {
    // [INVARIANT] Fold pending WAL frames into the main file first; copying only the .db would silently drop them.
    const source = new Database(inPath, { fileMustExist: true })
    try {
        source.pragma('busy_timeout = 5000')
        const ckpt = source.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy?: number }>
        if (Array.isArray(ckpt) && (ckpt[0]?.busy ?? 0) !== 0) {
            throw new Error('Source database has active WAL locks (wal_checkpoint busy != 0); retry when idle.')
        }
    } finally {
        source.close()
    }

    // SQLite3 Multiple Ciphers uses PRAGMA rekey for in-place encryption
    // Stage into a temp file with restricted permissions and swap atomically only after verification.
    fs.copyFileSync(inPath, tmpPath)
    try {
        fs.chmodSync(tmpPath, 0o600)
    } catch {
        // chmod 0600 is best-effort on Windows filesystems
    }

    const db = new Database(tmpPath)
    try {
        // [INVARIANT] rekey is unsupported in WAL mode; switch the copy to rollback journaling.
        db.pragma('journal_mode = DELETE')
        applyKey(db, 'rekey', key)
    } finally {
        db.close()
    }

    // Verify: the header must no longer be plaintext, and the key must open & pass integrity_check.
    const header = Buffer.alloc(16)
    const fd = fs.openSync(tmpPath, 'r')
    try {
        fs.readSync(fd, header, 0, 16, 0)
    } finally {
        fs.closeSync(fd)
    }
    if (header.toString('latin1') === SQLITE_PLAIN_HEADER) {
        throw new Error('PRAGMA rekey had no effect: output still has a plaintext SQLite header (is SQLite3 Multiple Ciphers loaded?).')
    }
    const verify = new Database(tmpPath, { fileMustExist: true })
    try {
        applyKey(verify, 'key', key)
        const integrity = verify.pragma('integrity_check', { simple: true })
        if (integrity !== 'ok') {
            throw new Error(`Encrypted database integrity check failed: ${String(integrity)}`)
        }
    } finally {
        verify.close()
    }

    fs.renameSync(tmpPath, outPath)
    try {
        fs.chmodSync(outPath, 0o600)
    } catch {
        // chmod 0600 is best-effort on Windows filesystems
    }

    console.log('✅ Database encrypted and verified successfully.')
    console.log('To use it, start the server with DB_ENCRYPTION_KEY=<your-key>')
    console.log(`and point the database configuration to ${outPath}.`)
} catch (error) {
    console.error('❌ Failed to encrypt database:', sanitizeScriptError(error, key))
    removeIfExists(tmpPath)
    removeIfExists(`${tmpPath}-wal`)
    removeIfExists(`${tmpPath}-shm`)
    removeIfExists(outPath)
    process.exit(1)
}
