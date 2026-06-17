import DatabaseAdapter from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { logger } from '../../utils/logger.js'
import { ConnectionError } from '../../types/errors.js'
import { MigrationManager } from '../migrations/migration-manager.js'
import type { IDatabaseConnection, QueryResult } from '../core/interfaces.js'


/**
 * Pre-compiled regex to detect SQL mutation statements.
 * Hoisted to module scope to avoid recompilation on every exec() call.
 */
const IS_MUTATION_RE =
    /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA (?!table_info|foreign_key_list|index_info|index_list|journal_mode|synchronous|temp_store|integrity_check))./i


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

            // Decrypt if key is provided (must be done before any other PRAGMAs or queries)
            if (process.env['DB_ENCRYPTION_KEY']) {
                const key = process.env['DB_ENCRYPTION_KEY']
                if (key.startsWith("x'") && key.endsWith("'")) {
                    // Raw hex keys must not be wrapped in additional single quotes
                    db.pragma(`key = "${key}"`)
                } else {
                    db.pragma(`key = '${key}'`)
                }
                logger.info('Database encryption key applied', { module: 'NativeConnectionManager' })
            }

            // Native-only PRAGMAs for performance and safety
            db.pragma('journal_mode = WAL')
            db.pragma('synchronous = NORMAL')
            db.pragma('foreign_keys = ON')
            db.pragma('temp_store = MEMORY')

            // Load sqlite-vec extension for vector search
            // Use local `db` ref to avoid race with concurrent close() during await
            try {
                // Try the npm package first (for local development on macOS/Windows/glibc)
                const sqliteVec = await import('sqlite-vec')

                // Guard: if close() was called during the await, abort initialization
                if (this.db === null) {
                    logger.info('Database closed during initialization, aborting', {
                        module: 'NativeConnectionManager',
                    })
                    return
                }

                sqliteVec.load(db)
                logger.info('sqlite-vec extension loaded via npm package', {
                    module: 'NativeConnectionManager',
                })
            } catch {
                // Fallback: try loading the compiled .so directly (for Alpine Docker)
                // In production, the .so is placed in /app/vec0.so, so we resolve relative to the process root or a known path.
                const fallbackPath = path.resolve(process.cwd(), 'vec0')
                db.loadExtension(fallbackPath)
                logger.info('sqlite-vec extension loaded via compiled fallback', {
                    module: 'NativeConnectionManager',
                    path: fallbackPath,
                })
            }

            // Run schema migrations (creates memory_journal and other core tables versioned)
            this.migrateSchema()

            // Create vector metadata table
            db.exec(`
                CREATE TABLE IF NOT EXISTS vector_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            `)

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

        // 1. Run versioned migrations
        MigrationManager.runMigrations(db, false)

        // 2. Perform post-migration checks and updates
        db.transaction(() => {
            db.prepare('UPDATE tags SET usage_count = 0 WHERE usage_count IS NULL').run()

            // Populate FTS5 index for existing databases that were created before FTS5 was added.
            // Uses FTS5's built-in 'rebuild' command for content-sync tables.
            // We query the fts_content_docsize shadow table to get the true number of indexed documents
            // because querying fts_content directly merely delegates to the content table (memory_journal).
            let ftsCount = 0
            try {
                ftsCount = (
                    db.prepare('SELECT COUNT(*) as c FROM fts_content_docsize').get() as {
                        c: number
                    }
                ).c
            } catch {
                // Shadow table doesn't exist yet or FTS5 disabled
            }

            const entryCount = (
                db.prepare('SELECT COUNT(*) as c FROM memory_journal').get() as { c: number }
            ).c
            let needsRebuild = false
            let rebuildReason = ''

            if (ftsCount === 0 && entryCount > 0) {
                needsRebuild = true
                rebuildReason = 'fts5:populated'
            } else if (ftsCount > entryCount) {
                // Ghost entries: FTS has more rows than the journal (hard deletes before the
                // fts_content_ad trigger existed). Rebuild to remove stale FTS tokens.
                needsRebuild = true
                rebuildReason = 'fts5:rebuilt-ghost-cleanup'
            }

            if (needsRebuild) {
                // Defer rebuilding FTS5 index to prevent blocking server startup
                const deferMs = process.env['NODE_ENV'] === 'test' ? 10 : 5000
                setTimeout(() => {
                    // Start a detached node process to rebuild the index without blocking the main event loop
                    const code = `
                        const Database = require('better-sqlite3');
                        const db = new Database(process.argv[1]);
                        db.exec("INSERT INTO fts_content(fts_content) VALUES ('rebuild')");
                        db.close();
                    `
                    execFile('node', ['-e', code, this.dbPath], (err, _stdout, stderr) => {
                        if (err) {
                            logger.error('Failed to rebuild FTS5 index in background process', {
                                module: 'NativeConnectionManager',
                                error: err?.message || 'unknown error',
                                stderr,
                            })
                        } else {
                            logger.info(
                                `Deferred FTS5 rebuild completed (${rebuildReason}) in background process`,
                                { module: 'NativeConnectionManager', dbPath: this.dbPath }
                            )
                        }
                    })
                }, deferMs)
            }
        })()
    }

    applyTeamSchema(): void {
        const db = this.ensureDb()
        MigrationManager.applyTeamMigrations(db)
    }


    /**
     * @internal QUARANTINED
     * Maps better-sqlite3 results to the legacy `{ columns: string[], values: unknown[][] }[]` shape
     * Because better-sqlite3 returns arrays of objects instantly, we map them out.
     */
    exec(sql: string, params?: unknown[]): QueryResult[] {
        const db = this.ensureDb()

        // Strip string literals to safely check for multiple statements
        // SQLite uses single quotes for strings and double quotes for identifiers
        const strippedSql = sql.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
        const statements = strippedSql
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)

        // Reject multiple statements separated by semicolon to prevent unparameterized footguns
        if (statements.length > 1) {
            throw new Error(
                'Multi-statement queries via exec() are strictly forbidden. Use properly parameterized adapter methods instead.'
            )
        }

        // Use pre-compiled regex to detect true mutations that should return an empty set
        const isMutation = IS_MUTATION_RE.test(sql)

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
     * @internal QUARANTINED
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

    /**
     * @internal
     * Restricted to internal SQLite components only
     */
    getNativeDb(): Database {
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

    // ========================================================================
    // Vector Metadata and Tables
    // ========================================================================

    getVectorMetadata(key: string): string | undefined {
        const db = this.ensureDb()
        const row = db.prepare('SELECT value FROM vector_metadata WHERE key = ?').get(key) as { value: string } | undefined
        return row?.value
    }

    setVectorMetadata(key: string, value: string): void {
        const db = this.ensureDb()
        db.prepare('INSERT INTO vector_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    }

    createVecTable(dimensions: number): void {
        const db = this.ensureDb()
        // Wait, vec0 doesn't support parameterized dimensions via '?', we have to interpolate
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
                entry_id INTEGER PRIMARY KEY,
                embedding float[${dimensions}]
            )
        `)
    }

    dropVecTable(): void {
        const db = this.ensureDb()
        db.exec('DROP TABLE IF EXISTS vec_embeddings')
    }
}
