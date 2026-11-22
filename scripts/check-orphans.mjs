import Database from 'better-sqlite3'
import { resolve } from 'node:path'

const ORPHAN_ENTRIES_SQL = `
    SELECT
        id,
        entry_type,
        workspace_id,
        project_number,
        substr(content, 1, 50) as content_preview,
        timestamp,
        is_personal
    FROM memory_journal
    WHERE deleted_at IS NULL
      AND (
           project_number IS NULL
           OR project_number <= 0
           OR workspace_id IS NULL
           OR TRIM(workspace_id) = ''
           OR workspace_id = 'default'
      )
`

function checkOrphans() {
    const defaultDbPath = resolve(process.cwd(), 'data', 'memory_journal.db')
    const dbPath = process.argv[2] ?? process.env['DB_PATH'] ?? defaultDbPath

    let db
    let rawKey
    try {
        console.log(`Checking for orphaned entries in: ${dbPath}`)
        db = new Database(dbPath, { readonly: true, fileMustExist: true })
        rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] ?? process.env['DB_ENCRYPTION_KEY']
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

        const tableCheck = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_journal'")
            .get()
        if (!tableCheck) {
            console.log("ℹ️ Table 'memory_journal' does not exist yet. Skipping orphan check.")
            return
        }

        const rows = db.prepare(ORPHAN_ENTRIES_SQL).all()

        if (rows.length === 0) {
            console.log('\n✅ No orphaned entries found (project_number is strictly enforced).')
        } else {
            console.log(`\n⚠️ Found ${String(rows.length)} orphaned entries without a project_number:`)
            console.log(JSON.stringify(rows, null, 2))
            console.log(
                '\nRecommendation: Update these entries using the `update_entry` tool with a valid project_number, or use `batch_update_entries` for bulk assignment.'
            )
        }

        if (rows.length > 0) process.exitCode = 1
    } catch (e) {
        const rawMsg = e instanceof Error ? e.message : String(e)
        let msg = rawMsg
            .replace(/x'[0-9a-fA-F]*'/gi, "x'[REDACTED]'")
            .replace(/(pragma\s+(?:re)?key\s*=\s*)(?:"(?:[^"]|"")*"|'(?:[^']|'')*')/gi, "$1'[REDACTED]'")
        if (rawKey !== undefined && rawKey !== '') {
            msg = msg.split(rawKey).join('[REDACTED]')
        }
        console.error(`\n❌ Error accessing database: ${msg}`)
        console.log('Usage: node scripts/check-orphans.mjs [path/to/database.db]')
        process.exitCode = 1
    } finally {
        db?.close()
    }
}

checkOrphans()
