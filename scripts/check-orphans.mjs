import Database from 'better-sqlite3'
import { resolve } from 'node:path'

function checkOrphans() {
    const defaultDbPath = resolve(process.cwd(), 'data/memory_journal.db')
    const dbPath = process.argv[2] ?? process.env['DB_PATH'] ?? defaultDbPath

    let db
    try {
        console.log(`Checking for orphaned entries in: ${dbPath}`)
        db = new Database(dbPath, { readonly: true, fileMustExist: true })
        const rawKey = process.env['DB_ENCRYPTION_KEY']
        if (rawKey !== undefined && rawKey !== '') {
            if (rawKey.startsWith("x'") && rawKey.endsWith("'")) {
                db.pragma(`key = "${rawKey.replace(/"/g, '""')}"`)
            } else {
                db.pragma(`key = '${rawKey.replace(/'/g, "''")}'`)
            }
        }

        const rows = db
            .prepare(
                `
            SELECT 
                id, 
                entry_type, 
                workspace_id,
                project_number,
                substr(content, 1, 50) as content_preview, 
                timestamp, 
                is_personal 
            FROM memory_journal 
            WHERE project_number IS NULL
               OR project_number <= 0
               OR workspace_id IS NULL
               OR workspace_id = 'default'
        `
            )
            .all()

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
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`\n❌ Error accessing database: ${msg}`)
        console.log('Usage: node scripts/check-orphans.mjs [path/to/database.db]')
        process.exitCode = 1
    } finally {
        db?.close()
    }
}

checkOrphans()
