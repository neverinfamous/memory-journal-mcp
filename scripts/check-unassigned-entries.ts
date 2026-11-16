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
    } catch (err) {
        console.warn(
            'Warning: Failed to read server config for database path:',
            err instanceof Error ? err.message : String(err)
        )
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
    const isStrict = process.argv.includes('--strict') || process.env['CI'] === 'true'
    if (!fs.existsSync(dbPath)) {
        const message = `Database file not found at '${dbPath}', skipping workspace isolation check.`
        if (isStrict || Boolean(process.env['MJ_DB_ENCRYPTION_KEY']) || Boolean(process.env['DB_ENCRYPTION_KEY'])) {
            console.error(message)
            process.exit(1)
        }
        console.log(`ℹ️ ${message}`)
        return
    }
    let rawKey = process.env['MJ_DB_ENCRYPTION_KEY'] || process.env['DB_ENCRYPTION_KEY']
    let db: Database.Database | undefined
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
            if (rawKey.startsWith("x'") || rawKey.startsWith("X'")) {
                if (!/^x'(?:[0-9a-fA-F]{2})+'$/i.test(rawKey)) {
                    throw new Error("Invalid hex encryption key: expected x'<even hex digits>'")
                }
                db.pragma(`key = ${rawKey}`)
            } else {
                db.pragma(`key = '${rawKey.replace(/'/g, "''")}'`)
            }
        }
    } catch (err) {
        if (db?.open) {
            db.close()
        }
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`❌ Could not open database at '${dbPath}': ${msg}`)
        process.exit(1)
    }

    try {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_journal'").get()
        if (!tableCheck) {
            console.log("ℹ️ Table 'memory_journal' does not exist yet. Skipping check.")
            return
        }

        const rows = db.prepare(`
            SELECT id, entry_type, workspace_id, project_number, timestamp 
            FROM memory_journal 
            WHERE workspace_id = 'default' 
               OR workspace_id IS NULL 
               OR TRIM(workspace_id) = '' 
               OR project_number <= 0 
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
            console.error(`\n💡 All journal entries must be explicitly bound to a valid workspace and project number. Read resource memory://agent-context/{repo} to retrieve your project number.`)
            process.exitCode = 1
            return
        }

        console.log(`✅ Workspace Isolation Check Passed: 0 unassigned or 'default' workspace entries found.`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isStrict || Boolean(rawKey)) {
            console.error(`❌ Unassigned entry check failed on '${dbPath}': ${msg}`)
            process.exitCode = 1
            return
        }
        console.log(`ℹ️ Unassigned entry check skipped (database encrypted or table unreadable): ${msg}`)
    } finally {
        if (db.open) {
            db.close()
        }
    }
}

checkUnassignedEntries()
