import DatabaseAdapter from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { ConnectionError } from '../../types/errors.js'
import { SCHEMA_SQL, TEAM_SCHEMA_SQL } from '../core/schema.js'
import type { IDatabaseConnection, QueryResult } from '../core/interfaces.js'

export class NativeConnectionManager implements IDatabaseConnection {
    private db: Database | null = null
    private readonly dbPath: string
    private initialized = false

    constructor(dbPath: string) {
        this.dbPath = dbPath
    }

    async initialize(): Promise<void> {
        if (this.initialized) return

        const dir = path.dirname(this.dbPath)
        if (dir && !fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true })
        }

        try {
            this.db = new DatabaseAdapter(this.dbPath)
            
            // Native-only PRAGMAs for performance and safety
            this.db.pragma('journal_mode = WAL')
            this.db.pragma('synchronous = NORMAL')
            this.db.pragma('foreign_keys = ON')
            this.db.pragma('temp_store = MEMORY')

            // Create base schema
            this.db.exec(SCHEMA_SQL)
            
            // Run schema migrations
            this.migrateSchema()

            this.initialized = true
            logger.info('Native database opened', { module: 'NativeConnectionManager', dbPath: this.dbPath })
        } catch (error) {
            logger.error('Failed to initialize native database', {
                module: 'NativeConnectionManager',
                error: String(error)
            })
            throw new ConnectionError(`Native DB Initialization failed: ${String(error)}`)
        }
    }

    private migrateSchema(): void {
        const db = this.ensureDb()
        
        // table_info in better-sqlite3 returns an array of objects like { "cid": 0, "name": "id", ...}
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
        const columns = new Set(tableInfo.map((row) => row.name))

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
                db.exec(col.sql)
                added.push(col.name)
            }
        }

        db.prepare('UPDATE tags SET usage_count = 0 WHERE usage_count IS NULL').run()

        const dropped: string[] = []
        const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%fts%'").all() as { name: string }[]
        const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
        
        for (const row of triggers) {
            const name = row.name
            if (!SAFE_IDENTIFIER_RE.test(name)) {
                logger.warning('Skipping trigger with unsafe name during migration', {
                    module: 'NativeConnectionManager',
                    triggerName: name,
                })
                continue
            }
            db.exec(`DROP TRIGGER IF EXISTS "${name}"`)
            dropped.push(`trigger:${name}`)
        }

        const changes = [...added.map((c) => `column:${c}`), ...dropped]
        if (changes.length > 0) {
            logger.info('Schema migrated', {
                module: 'NativeConnectionManager',
                dbPath: this.dbPath,
                changes,
            })
        }
    }

    applyTeamSchema(): void {
        const db = this.ensureDb()
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
        const columns = new Set(tableInfo.map((row) => row.name))

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
                db.exec(col.sql)
                added.push(col.name)
            }
        }

        if (added.length > 0) {
            logger.info('Team schema migrated', {
                module: 'NativeConnectionManager',
                dbPath: this.dbPath,
                columnsAdded: added,
            })
        }
    }

    /**
     * Polyfills sql.js `exec` signature: `{ columns: string[], values: unknown[][] }[]`
     * Because better-sqlite3 returns arrays of objects instantly, we map them out.
     */
    exec(sql: string, params?: unknown[]): QueryResult[] {
        const db = this.ensureDb()
        
        // Use regex to detect true mutations that should return an empty set
        const isMutation = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA (?!table_info|foreign_key_list|index_info|index_list|journal_mode|synchronous|temp_store))./i.test(sql)

        // For multiple statements separated by semicolon where they just want it to run
        if (isMutation && sql.includes(';')) {
            db.exec(sql)
            return []
        }

        const stmt = db.prepare(sql)

        if (isMutation || !stmt.reader) {
            // It's a mutation, don't try to read rows back
            if (params && params.length > 0) {
                stmt.run(...params)
            } else {
                stmt.run()
            }
            return []
        }

        // It's a SELECT/PRAGMA with a reader
        const rows = (params && params.length > 0)
            ? stmt.all(...params) as Record<string, unknown>[]
            : stmt.all() as Record<string, unknown>[]

        if (rows.length === 0) {
            return []
        }

        const columns = Object.keys(rows[0] as object)
        const values: unknown[][] = rows.map((row) => 
            columns.map((col) => row[col])
        )

        return [{ columns, values }]
    }

    /**
     * Wrapper for INSERT/UPDATE/DELETE
     */
    run(sql: string, params?: unknown[]): void {
        const db = this.ensureDb()
        if (params && params.length > 0) {
            db.prepare(sql).run(...params)
        } else {
            db.prepare(sql).run()
        }
    }

    scheduleSave(): void {
        // No-op for Native SQLite, disk writes are automatic
    }

    flushSave(): void {
        // No-op for Native SQLite
    }

    close(): void {
        if (this.db) {
            // Ensure WAL checkpoint
            try {
                this.db.pragma('wal_checkpoint(TRUNCATE)')
            } catch {
                // ignore
            }
            this.db.close()
            this.db = null
        }
        logger.info('Native database closed', { module: 'NativeConnectionManager' })
    }

    private ensureDb(): Database {
        if (!this.db) {
            throw new ConnectionError('Database not initialized. Call initialize() first.')
        }
        return this.db
    }

    pragma(command: string): void {
        const db = this.ensureDb()
        db.pragma(command)
    }

    getRawDb(): unknown {
        return this.ensureDb()
    }

    getDbPath(): string {
        return this.dbPath
    }

    getBackupsDir(): string {
        return path.join(path.dirname(this.dbPath), 'backups')
    }

    closeDbBeforeRestore(): void {
        this.close()
        this.initialized = false
    }

    setDbAndInitialized(db: unknown): void {
        this.db = db as Database
        this.db.pragma('foreign_keys = ON')
        this.initialized = true
    }
}
