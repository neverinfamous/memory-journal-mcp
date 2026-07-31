import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

function getDatabasePath(): string {
    if (process.env['MEMORY_JOURNAL_DB_PATH']) {
        return path.resolve(process.env['MEMORY_JOURNAL_DB_PATH'])
    }
    const defaultProdPath = path.resolve(process.cwd(), 'data', 'mj-production.db')
    if (fs.existsSync(defaultProdPath)) {
        return defaultProdPath
    }
    const globalPath = path.resolve(os.homedir(), '.gemini', 'antigravity', 'memory-journal.db')
    if (fs.existsSync(globalPath)) {
        return globalPath
    }
    return defaultProdPath
}

function checkUnassignedEntries(): void {
    const dbPath = getDatabasePath()
    if (!fs.existsSync(dbPath)) {
        console.log(`ℹ️ Database file not found at '${dbPath}', skipping workspace isolation check.`)
        return
    }

    let db: Database.Database
    try {
        db = new Database(dbPath, { readonly: true })
        const rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] || process.env['DB_ENCRYPTION_KEY']
        if (rawKey) {
            if (rawKey.startsWith("x'") && rawKey.endsWith("'")) {
                db.pragma(`key = "${rawKey}"`)
            } else {
                db.pragma(`key = '${rawKey}'`)
            }
        }
    } catch (err) {
        console.log(`ℹ️ Could not open database at '${dbPath}' (encrypted or locked): ${err instanceof Error ? err.message : String(err)}. Skipping workspace isolation check.`)
        return
    }

    try {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_journal'").get()
        if (!tableCheck) {
            console.log("ℹ️ Table 'memory_journal' does not exist yet. Skipping check.")
            db.close()
            return
        }

        const rows = db.prepare(`
            SELECT id, entry_type, workspace_id, project_number, created_at 
            FROM memory_journal 
            WHERE workspace_id = 'default' 
               OR workspace_id IS NULL 
               OR project_number = 0 
               OR project_number IS NULL
        `).all() as Array<{
            id: number
            entry_type: string
            workspace_id: string
            project_number: number
            created_at: string
        }>

        if (rows.length > 0) {
            console.error(`\n❌ Workspace Isolation Validation Failed!`)
            console.error(`Found ${rows.length} unassigned or 'default' workspace entries in database '${dbPath}':\n`)
            for (const row of rows) {
                console.error(`- Entry #${row.id}: [Type: ${row.entry_type}, Workspace: '${row.workspace_id}', Project: #${row.project_number}] (${row.created_at})`)
            }
            console.error(`\n💡 All journal entries must be explicitly bound to a valid workspace and project number. Read resource memory://agent-id to retrieve your project number.`)
            db.close()
            process.exit(1)
        }

        console.log(`✅ Workspace Isolation Check Passed: 0 unassigned or 'default' workspace entries found.`)
        db.close()
    } catch (err) {
        db.close()
        console.log(`ℹ️ Unassigned entry check skipped (database encrypted or table unreadable): ${err instanceof Error ? err.message : String(err)}`)
    }
}

checkUnassignedEntries()
