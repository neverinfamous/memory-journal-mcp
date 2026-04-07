import DatabaseAdapter from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { ConnectionError } from '../../types/errors.js'
import { SCHEMA_SQL, TEAM_SCHEMA_SQL } from '../core/schema.js'
import type { IDatabaseConnection, QueryResult } from '../core/interfaces.js'

/**
 * Pre-compiled regex to detect SQL mutation statements.
 * Hoisted to module scope to avoid recompilation on every exec() call.
 */
const IS_MUTATION_RE =
    /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA (?!table_info|foreign_key_list|index_info|index_list|journal_mode|synchronous|temp_store))./i

/**
 * Shared migration columns required by both personal and team schemas.
 * Adding a new column here ensures it is applied in both migrateSchema() and applyTeamSchema().
 */
const SHARED_MIGRATION_COLUMNS: { name: string; sql: string }[] = [
    {
        name: 'significance_type',
        sql: 'ALTER TABLE memory_journal ADD COLUMN significance_type TEXT',
    },
    { name: 'auto_context', sql: 'ALTER TABLE memory_journal ADD COLUMN auto_context TEXT' },
    { name: 'deleted_at', sql: 'ALTER TABLE memory_journal ADD COLUMN deleted_at TEXT' },
    { name: 'project_number', sql: 'ALTER TABLE memory_journal ADD COLUMN project_number INTEGER' },
    { name: 'project_owner', sql: 'ALTER TABLE memory_journal ADD COLUMN project_owner TEXT' },
    { name: 'issue_number', sql: 'ALTER TABLE memory_journal ADD COLUMN issue_number INTEGER' },
    { name: 'issue_url', sql: 'ALTER TABLE memory_journal ADD COLUMN issue_url TEXT' },
    { name: 'pr_number', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_number INTEGER' },
    { name: 'pr_url', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_url TEXT' },
    { name: 'pr_status', sql: 'ALTER TABLE memory_journal ADD COLUMN pr_status TEXT' },
    {
        name: 'workflow_run_id',
        sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_run_id INTEGER',
    },
    { name: 'workflow_name', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_name TEXT' },
    { name: 'workflow_status', sql: 'ALTER TABLE memory_journal ADD COLUMN workflow_status TEXT' },
]

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
            const db = this.db

            // Native-only PRAGMAs for performance and safety
            db.pragma('journal_mode = WAL')
            db.pragma('synchronous = NORMAL')
            db.pragma('foreign_keys = ON')
            db.pragma('temp_store = MEMORY')

            // Load sqlite-vec extension for vector search
            // Use local `db` ref to avoid race with concurrent close() during await
            const sqliteVec = await import('sqlite-vec')

            // Guard: if close() was called during the await, abort initialization
            if (this.db === null) {
                logger.info('Database closed during initialization, aborting', {
                    module: 'NativeConnectionManager',
                })
                return
            }

            sqliteVec.load(db)
            logger.info('sqlite-vec extension loaded', { module: 'NativeConnectionManager' })

            // Create base schema
            db.exec(SCHEMA_SQL)

            // Create vector embeddings table (sqlite-vec vec0 virtual table)
            db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
                    entry_id INTEGER PRIMARY KEY,
                    embedding float[384]
                )
            `)

            // Run schema migrations
            this.migrateSchema()

            this.initialized = true
            logger.info('Native database opened', {
                module: 'NativeConnectionManager',
                dbPath: this.dbPath,
            })
        } catch (error) {
            logger.error('Failed to initialize native database', {
                module: 'NativeConnectionManager',
                error: String(error),
            })
            throw new ConnectionError(`Native DB Initialization failed: ${String(error)}`)
        }
    }

    private migrateSchema(): void {
        const db = this.ensureDb()

        // table_info in better-sqlite3 returns an array of objects like { "cid": 0, "name": "id", ...}
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as {
            name: string
        }[]
        const columns = new Set(tableInfo.map((row) => row.name))

        const added: string[] = []
        for (const col of SHARED_MIGRATION_COLUMNS) {
            if (!columns.has(col.name)) {
                db.exec(col.sql)
                added.push(col.name)
            }
        }

        db.prepare('UPDATE tags SET usage_count = 0 WHERE usage_count IS NULL').run()

        // Populate FTS5 index for existing databases that were created before FTS5 was added.
        // Uses FTS5's built-in 'rebuild' command for content-sync tables.
        // We query the fts_content_docsize shadow table to get the true number of indexed documents
        // because querying fts_content directly merely delegates to the content table (memory_journal).
        let ftsCount = 0;
        try {
            ftsCount = (db.prepare('SELECT COUNT(*) as c FROM fts_content_docsize').get() as { c: number }).c
        } catch {
            // Shadow table doesn't exist yet or FTS5 disabled
        }
        
        const entryCount = (
            db.prepare('SELECT COUNT(*) as c FROM memory_journal').get() as { c: number }
        ).c
        if (ftsCount === 0 && entryCount > 0) {
            db.exec("INSERT INTO fts_content(fts_content) VALUES ('rebuild')")
            added.push('fts5:populated')
        } else if (ftsCount > entryCount) {
            // Ghost entries: FTS has more rows than the journal (hard deletes before the
            // fts_content_ad trigger existed). Rebuild to remove stale FTS tokens.
            db.exec("INSERT INTO fts_content(fts_content) VALUES ('rebuild')")
            added.push('fts5:rebuilt-ghost-cleanup')
        }

        if (added.length > 0) {
            logger.info('Schema migrated', {
                module: 'NativeConnectionManager',
                dbPath: this.dbPath,
                changes: added.map((c) => (c.startsWith('fts5:') ? c : `column:${c}`)),
            })
        }
    }

    applyTeamSchema(): void {
        const db = this.ensureDb()
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as {
            name: string
        }[]
        const columns = new Set(tableInfo.map((row) => row.name))

        // Shared columns + team-only author column
        const teamColumns: { name: string; sql: string }[] = [
            ...SHARED_MIGRATION_COLUMNS,
            { name: 'author', sql: TEAM_SCHEMA_SQL.trim() },
        ]

        const added: string[] = []
        for (const col of teamColumns) {
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
     * Maps better-sqlite3 results to the legacy `{ columns: string[], values: unknown[][] }[]` shape
     * Because better-sqlite3 returns arrays of objects instantly, we map them out.
     */
    exec(sql: string, params?: unknown[]): QueryResult[] {
        const db = this.ensureDb()

        // Use pre-compiled regex to detect true mutations that should return an empty set
        const isMutation = IS_MUTATION_RE.test(sql)

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
        const rows =
            params && params.length > 0
                ? (stmt.all(...params) as Record<string, unknown>[])
                : (stmt.all() as Record<string, unknown>[])

        if (rows.length === 0) {
            return []
        }

        const columns = Object.keys(rows[0] as object)
        const values: unknown[][] = rows.map((row) => columns.map((col) => row[col]))

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
