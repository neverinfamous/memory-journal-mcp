import path from 'node:path'
import Database from 'better-sqlite3'

const dbPath = process.env['DB_PATH'] ?? path.resolve(process.cwd(), 'data/memory_journal.db')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
    const rawKey = process.env['DB_ENCRYPTION_KEY']
    if (rawKey !== undefined && rawKey !== '') {
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
            'SELECT id, session_id, entry_type, content, project_number, workspace_id, is_archived FROM memory_journal WHERE session_id IS NULL OR session_id = ""'
        )
        .all()
    console.log(JSON.stringify(entries, null, 2))
} finally {
    db.close()
}
