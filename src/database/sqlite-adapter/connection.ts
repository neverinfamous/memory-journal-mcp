import initSqlJs, { type Database } from 'sql.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { ConnectionError } from '../../types/errors.js'
import { SCHEMA_SQL, TEAM_SCHEMA_SQL } from '../schema.js'

export interface DatabaseContext {
    ensureDb(): Database
    scheduleSave(): void
    flushSave(): void
    getBackupsDir(): string
    getDbPath(): string
}

export class ConnectionManager implements DatabaseContext {
    private db: Database | null = null
    private readonly dbPath: string
    private initialized = false
    private saveTimer: ReturnType<typeof setTimeout> | null = null
    private static readonly SAVE_DEBOUNCE_MS = 500

    constructor(dbPath: string) {
        this.dbPath = dbPath
    }

    async initialize(): Promise<void> {
        if (this.initialized) return

        const SQL = await initSqlJs()

        let dbBuffer: Buffer | null = null
        if (fs.existsSync(this.dbPath)) {
            try {
                dbBuffer = fs.readFileSync(this.dbPath)
            } catch {
                // File doesn't exist or can't be read, create new
            }
        }

        if (dbBuffer) {
            this.db = new SQL.Database(dbBuffer)
        } else {
            this.db = new SQL.Database()
            const dir = path.dirname(this.dbPath)
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
        }

        this.db.run(SCHEMA_SQL)
        this.migrateSchema()
        this.db.run('PRAGMA foreign_keys = ON')
        this.db.run('PRAGMA journal_mode = MEMORY')
        this.db.run('PRAGMA synchronous = OFF')
        this.db.run('PRAGMA temp_store = MEMORY')

        this.initialized = true
        logger.info('Database opened', { module: 'ConnectionManager', dbPath: this.dbPath })
        this.flushSave()
    }

    private migrateSchema(): void {
        const db = this.ensureDb()
        const tableInfo = db.exec('PRAGMA table_info(memory_journal)')
        const columns = new Set((tableInfo[0]?.values ?? []).map((row) => String(row[1])))

        const requiredColumns: { name: string; sql: string }[] = [
            { name: 'significance_type', sql: 'ALTER TABLE memory_journal ADD COLUMN significance_type TEXT' },
            { name: 'auto_context', sql: 'ALTER TABLE memory_journal ADD COLUMN auto_context TEXT' },
            { name: 'deleted_at', sql: 'ALTER TABLE memory_journal ADD COLUMN deleted_at TEXT' },
            { name: 'project_number', sql: 'ALTER TABLE memory_journal ADD COLUMN project_number INTEGER' },
            { name: 'project_owner', sql: 'ALTER TABLE memory_journal ADD COLUMN project_owner TEXT' },
            { name: 'issue_number', sql: 'ALTER TABLE memory_journal ADD COLUMN issue_number INTEGER' },
            { name: 'issue_url', sql: 'ALTER TABLE memory_journal ADD COLUMN issue_url TEXT' },
            { name: 'pr_number', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_number INTEGER' },
            { name: 'pr_url', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_url TEXT' },
            { name: 'pr_status', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_status TEXT' },
            { name: 'workflow_run_id', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_run_id INTEGER' },
            { name: 'workflow_name', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_name TEXT' },
            { name: 'workflow_status', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_status TEXT' },
        ]

        const added: string[] = []
        for (const col of requiredColumns) {
            if (!columns.has(col.name)) {
                db.run(col.sql)
                added.push(col.name)
            }
        }

        db.run('UPDATE tags SET usage_count = 0 WHERE usage_count IS NULL')

        const dropped: string[] = []
        const triggers = db.exec("SELECT name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%fts%'")
        const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
        for (const row of triggers[0]?.values ?? []) {
            const name = String(row[0])
            if (!SAFE_IDENTIFIER_RE.test(name)) {
                logger.warning('Skipping trigger with unsafe name during migration', {
                    module: 'ConnectionManager',
                    triggerName: name,
                })
                continue
            }
            db.run(`DROP TRIGGER IF EXISTS "${name}"`)
            dropped.push(`trigger:${name}`)
        }

        const changes = [...added.map((c) => `column:${c}`), ...dropped]
        if (changes.length > 0) {
            this.flushSave()
            logger.info('Schema migrated', {
                module: 'ConnectionManager',
                dbPath: this.dbPath,
                changes,
            })
        }
    }

    applyTeamSchema(): void {
        const db = this.ensureDb()
        const tableInfo = db.exec('PRAGMA table_info(memory_journal)')
        const columns = new Set((tableInfo[0]?.values ?? []).map((row) => String(row[1])))

        const requiredColumns: { name: string; sql: string }[] = [
            { name: 'issue_number', sql: 'ALTER TABLE memory_journal ADD COLUMN issue_number INTEGER' },
            { name: 'issue_url', sql: 'ALTER TABLE memory_journal ADD COLUMN issue_url TEXT' },
            { name: 'pr_number', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_number INTEGER' },
            { name: 'pr_url', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_url TEXT' },
            { name: 'pr_status', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_status TEXT' },
            { name: 'workflow_run_id', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_run_id INTEGER' },
            { name: 'workflow_name', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_name TEXT' },
            { name: 'workflow_status', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_status TEXT' },
            { name: 'project_number', sql: 'ALTER TABLE memory_journal ADD COLUMN project_number INTEGER' },
            { name: 'project_owner', sql: 'ALTER TABLE memory_journal ADD COLUMN project_owner TEXT' },
            { name: 'significance_type', sql: 'ALTER TABLE memory_journal ADD COLUMN significance_type TEXT' },
            { name: 'auto_context', sql: 'ALTER TABLE memory_journal ADD COLUMN auto_context TEXT' },
            { name: 'deleted_at', sql: 'ALTER TABLE memory_journal ADD COLUMN deleted_at TEXT' },
            { name: 'author', sql: TEAM_SCHEMA_SQL.trim() },
        ]

        const added: string[] = []
        for (const col of requiredColumns) {
            if (!columns.has(col.name)) {
                db.run(col.sql)
                added.push(col.name)
            }
        }

        if (added.length > 0) {
            this.flushSave()
            logger.info('Team schema migrated', {
                module: 'ConnectionManager',
                dbPath: this.dbPath,
                columnsAdded: added,
            })
        }
    }

    scheduleSave(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer)
        }
        this.saveTimer = setTimeout(() => {
            this.flushSave()
        }, ConnectionManager.SAVE_DEBOUNCE_MS)
    }

    flushSave(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer)
            this.saveTimer = null
        }
        if (!this.db) return
        const data = this.db.export()
        const buffer = Buffer.from(data)
        fs.writeFileSync(this.dbPath, buffer)
    }

    close(): void {
        if (this.db) {
            this.flushSave()
            this.db.close()
            this.db = null
        }
        logger.info('Database closed', { module: 'ConnectionManager' })
    }

    ensureDb(): Database {
        if (!this.db) {
            throw new ConnectionError('Database not initialized. Call initialize() first.')
        }
        return this.db
    }

    getRawDb(): Database {
        return this.ensureDb()
    }

    getDbPath(): string {
        return this.dbPath
    }

    getBackupsDir(): string {
        return path.join(path.dirname(this.dbPath), 'backups')
    }

    closeDbBeforeRestore(): void {
        this.db?.close()
        this.db = null
        this.initialized = false
    }

    setDbAndInitialized(db: Database): void {
        this.db = db
        this.db.run('PRAGMA foreign_keys = ON')
        this.initialized = true
        this.flushSave()
    }
}
