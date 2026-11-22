import path from 'node:path'
import Database from 'better-sqlite3'

const dbPath =
    process.env['MEMORY_JOURNAL_DB_PATH'] ??
    process.env['DB_PATH'] ??
    path.resolve(process.cwd(), 'data/memory_journal.db')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
    const rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] ?? process.env['DB_ENCRYPTION_KEY']
    if (rawKey !== undefined && rawKey !== '') {
        if (rawKey.includes('\0')) {
            throw new Error('Invalid encryption key: NUL bytes are not allowed')
        }
        if (rawKey.startsWith("x'") || rawKey.startsWith("X'")) {
            if (!/^x'(?:[0-9a-fA-F]{2})+'$/i.test(rawKey)) {
                throw new Error("Invalid hex encryption key: expected x'<even hex digits>'")
            }
            db.pragma(`key = ${rawKey}`)
        } else {
            db.pragma(`key = '${rawKey.replace(/'/g, "''")}'`)
        }
    }
    const entries = db
        .prepare(
            "SELECT id, session_id, entry_type, content, project_number, workspace_id, is_archived FROM memory_journal WHERE deleted_at IS NULL AND (session_id IS NULL OR session_id = '')"
        )
        .all()
    console.log(JSON.stringify(entries, null, 2))
} catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err)
    const rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] ?? process.env['DB_ENCRYPTION_KEY']
    let safeMsg = rawMsg
        .replace(/x'[0-9a-fA-F]*'/gi, "x'[REDACTED]'")
        .replace(/(pragma\s+(?:re)?key\s*=\s*)(?:"(?:[^"]|"")*"|'(?:[^']|'')*')/gi, "$1'[REDACTED]'")
    if (rawKey !== undefined && rawKey !== '') {
        safeMsg = safeMsg.split(rawKey).join('[REDACTED]')
    }
    console.error(`Query script failed: ${safeMsg}`)
    process.exitCode = 1
} finally {
    db.close()
}
