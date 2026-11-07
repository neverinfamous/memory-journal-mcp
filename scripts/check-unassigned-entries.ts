import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

function getDatabasePath(): string {
    const envDbPath = process.env['MEMORY_JOURNAL_DB_PATH'] || process.env['DB_PATH']
    if (envDbPath) {
        return path.resolve(envDbPath)
    }
    try {
        const cfgPath =
            process.env['MEMORY_JOURNAL_CONFIG'] ||
            path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
        if (fs.existsSync(cfgPath)) {
            const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { dbPath?: string }
            if (typeof parsed.dbPath === 'string' && parsed.dbPath.trim() !== '') {
                const resolvedCfgDb = path.resolve(parsed.dbPath)
                if (fs.existsSync(resolvedCfgDb)) return resolvedCfgDb
            }
        }
    } catch {
        // Ignore config read errors and fall through to standard paths
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

    const isStrict = process.argv.includes('--strict') || process.env['CI'] === 'true'
    let rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] || process.env['DB_ENCRYPTION_KEY']
    let db: Database.Database
    try {
        db = new Database(dbPath, { readonly: true })
        
        // Fallback to IDE MCP configuration if running directly
        if (!rawKey) {
            try {
                const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'mcp_config.json')
                if (fs.existsSync(configPath)) {
                    const mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
                    rawKey = mcpConfig.mcpServers?.['memory-journal-mcp']?.env?.DB_ENCRYPTION_KEY
                }
            } catch (err) {
                console.warn('Warning: Failed to read mcp_config.json fallback:', err instanceof Error ? err.message : String(err))
            }
        }

        if (rawKey) {
            if (rawKey.startsWith("x'") && rawKey.endsWith("'")) {
                db.pragma(`key = "${rawKey.replace(/"/g, '""')}"`)
            } else {
                db.pragma(`key = '${rawKey.replace(/'/g, "''")}'`)
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isStrict || Boolean(rawKey)) {
            console.error(`❌ Could not open database at '${dbPath}': ${msg}`)
            process.exit(1)
        }
        console.log(`ℹ️ Could not open database at '${dbPath}' (encrypted or locked): ${msg}. Skipping workspace isolation check.`)
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
            SELECT id, entry_type, workspace_id, project_number, timestamp 
            FROM memory_journal 
            WHERE workspace_id = 'default' 
               OR workspace_id IS NULL 
               OR TRIM(workspace_id) = '' 
               OR project_number = 0 
               OR project_number IS NULL
        `).all() as Array<{
            id: number
            entry_type: string
            workspace_id: string
            project_number: number
            timestamp: string
        }>

        if (rows.length > 0) {
            console.error(`\n❌ Workspace Isolation Validation Failed!`)
            console.error(`Found ${rows.length} unassigned or 'default' workspace entries in database '${dbPath}':\n`)
            for (const row of rows) {
                console.error(`- Entry #${row.id}: [Type: ${row.entry_type}, Workspace: '${row.workspace_id}', Project: #${row.project_number}] (${row.timestamp})`)
            }
            console.error(`\n💡 All journal entries must be explicitly bound to a valid workspace and project number. Read resource memory://agent-id to retrieve your project number.`)
            db.close()
            process.exit(1)
        }

        console.log(`✅ Workspace Isolation Check Passed: 0 unassigned or 'default' workspace entries found.`)
        db.close()
    } catch (err) {
        db.close()
        const msg = err instanceof Error ? err.message : String(err)
        if (isStrict || Boolean(rawKey)) {
            console.error(`❌ Unassigned entry check failed on '${dbPath}': ${msg}`)
            process.exit(1)
        }
        console.log(`ℹ️ Unassigned entry check skipped (database encrypted or table unreadable): ${msg}`)
    }
}

checkUnassignedEntries()
