import DatabaseAdapter from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { isRecord } from '../../utils/type-guards.js'
import { applySqlCipherKey } from './sqlcipher-key.js'
import { ConnectionError } from '../../types/errors.js'
import { MigrationManager, getExpectedUserVersion } from '../migrations/migration-manager.js'
import type { IDatabaseConnection, QueryResult } from '../core/interfaces.js'
import { scanSqlQuotedSpan, stripSqlComments } from './backup-ddl-validators.js'
import {
    applyNativePragmas,
    detectFtsRebuildReason,
    installStatementCache,
    loadVecExtensionOnDb,
    runOptimizeAfterMigrations,
    runOptimizeAndCheckpointBeforeClose,
    runPassiveCheckpoint,
} from './connection-pragmas.js'
import { runImmediateWriteTx } from './row-helpers.js'

/**
 * Pre-compiled regex to detect SQL mutation statements.
 * Hoisted to module scope to avoid recompilation on every exec() call.
 */
const IS_MUTATION_RE =
    /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA\s+(?!\s|table_info|foreign_key_list|foreign_key_check|index_info|index_list|journal_mode|synchronous|temp_store|integrity_check|quick_check|table_list|wal_checkpoint))./i

const ALLOWED_PRAGMAS_RE =
    /^\s*(?:wal_checkpoint(?:\s*\(\s*(?:PASSIVE|FULL|RESTART|TRUNCATE)\s*\))?|integrity_check|quick_check|foreign_key_check|foreign_keys(?:\s*=\s*(?:ON|OFF|1|0))?|journal_mode(?:\s*=\s*(?:WAL|DELETE|TRUNCATE|PERSIST|MEMORY|OFF))?|synchronous(?:\s*=\s*(?:OFF|NORMAL|FULL|EXTRA|0|1|2|3))?|temp_store(?:\s*=\s*(?:DEFAULT|FILE|MEMORY|0|1|2))?|busy_timeout(?:\s*=\s*\d+)?|optimize|table_info\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)|index_list\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)|index_info\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)|foreign_key_list\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\))\s*$/i

/** Delay before the deferred FTS5 rebuild starts, so server startup is not blocked. */
const FTS_REBUILD_DEFER_MS = 5000

/** Shortened FTS5 rebuild delay used when NODE_ENV is 'test'. */
const FTS_REBUILD_DEFER_TEST_MS = 10


function stripSqlStringsAndComments(sql: string): string {
    const noComments = stripSqlComments(sql)
    let out = ''
    let i = 0
    while (i < noComments.length) {
        const ch = noComments[i] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            i = scanSqlQuotedSpan(noComments, i, ch)
            out += ' '
            continue
        }
        out += ch
        i++
    }
    return out
}

function isDatabaseHandle(db: unknown): db is Database {
    return isRecord(db) && typeof db['prepare'] === 'function' && typeof db['close'] === 'function'
}

export class NativeConnectionManager implements IDatabaseConnection {
    private db: Database | null = null
    private readonly dbPath: string
    private readonly explicitBackupsDir: string | undefined
    private initialized = false
    private initializingPromise: Promise<void> | null = null
    private initEpoch = 0
    private teamSchemaApplied = false
    private ftsRebuildTimer: ReturnType<typeof setTimeout> | null = null

    constructor(dbPath: string, backupsDir?: string) {
        if (dbPath.trim() === '') {
            throw new ConnectionError('Database path cannot be empty or whitespace-only.')
        }
        this.dbPath = dbPath
        this.explicitBackupsDir = backupsDir
    }

    async initialize(): Promise<void> {
        if (this.initialized) return
        if (this.initializingPromise !== null) {
            return this.initializingPromise
        }

        const promise = this.performInitialize().finally(() => {
            if (this.initializingPromise === promise) {
                this.initializingPromise = null
            }
        })
        this.initializingPromise = promise
        return promise
    }

    private async performInitialize(): Promise<void> {
        if (this.initialized) return
        const epoch = this.initEpoch

        const dir = path.dirname(this.dbPath)
        if (dir && !fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
        }
        if (this.initEpoch !== epoch) {
            throw new ConnectionError('Database closed during initialization.')
        }

        let initDb: Database | undefined
        try {
            const db = new DatabaseAdapter(this.dbPath)
            initDb = db
            this.db = db

            // Decrypt if key is provided (must be done before any other PRAGMAs or queries)
            applySqlCipherKey(db, true)

            applyNativePragmas(db)
            installStatementCache(db)

            // Load sqlite-vec extension for vector search
            const loaded = await loadVecExtensionOnDb(db, () => this.db === db && this.initEpoch === epoch)
            if (!loaded || this.db !== db || this.initEpoch !== epoch) {
                throw new ConnectionError('Database closed during initialization.')
            }

            const expectedUserVersion = getExpectedUserVersion(this.teamSchemaApplied)
            const isWarmCurrent =
                expectedUserVersion > 0 &&
                db.pragma('user_version', { simple: true }) === expectedUserVersion &&
                db
                    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'`)
                    .get() !== undefined
            const hasVectorMeta =
                isWarmCurrent &&
                db
                    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vector_metadata'`)
                    .get() !== undefined

            // Run schema migrations (creates memory_journal and other core tables versioned)
            this.migrateSchema(isWarmCurrent)

            if (!hasVectorMeta) {
                db.exec('CREATE TABLE IF NOT EXISTS vector_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            }
            if (!isWarmCurrent) runOptimizeAfterMigrations(db)

            this.initialized = true
            logger.info('Native database opened', { module: 'NativeConnectionManager', dbPath: this.dbPath })
        } catch (error) {
            this.cleanupFailedInit(initDb, error)
            throw new ConnectionError(`Native DB Initialization failed: ${String(error)}`)
        }
    }

    private cleanupFailedInit(initDb: Database | undefined, error: unknown): void {
        if (this.ftsRebuildTimer !== null) {
            clearTimeout(this.ftsRebuildTimer)
            this.ftsRebuildTimer = null
        }
        if (initDb !== undefined && this.db === initDb) {
            try {
                initDb.close()
            } catch (closeErr: unknown) {
                logger.debug('Cleanup close after failed initialization logged error', {
                    module: 'NativeConnectionManager',
                    error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                })
            }
            this.db = null
            this.initialized = false
        } else if (this.db === null) {
            this.initialized = false
        }
        logger.error('Failed to initialize native database', { module: 'NativeConnectionManager', error: String(error) })
    }

    private migrateSchema(isWarmCurrent = false): void {
        const db = this.ensureDb()

        // 1. Run versioned migrations (fast-path skips tx/DDL when user_version matches)
        MigrationManager.runMigrations(db, this.teamSchemaApplied)

        if (isWarmCurrent) {
            const rebuildReason = detectFtsRebuildReason(db)
            if (rebuildReason !== null) this.scheduleFtsRebuild(rebuildReason)
            return
        }

        // 2. Perform post-migration checks and updates on cold/upgraded databases
        runImmediateWriteTx(db, () => {
            db.prepare('UPDATE tags SET usage_count = 0 WHERE usage_count IS NULL').run()
            const rebuildReason = detectFtsRebuildReason(db)
            if (rebuildReason !== null) this.scheduleFtsRebuild(rebuildReason)
        })
    }

    /**
     * Defer rebuilding the FTS5 index (in-process, on the existing connection) so server startup is not blocked.
     * The timer is unref'd and cleared on close().
     */
    private scheduleFtsRebuild(rebuildReason: string): void {
        const deferMs =
            process.env['NODE_ENV'] === 'test' ? FTS_REBUILD_DEFER_TEST_MS : FTS_REBUILD_DEFER_MS
        if (this.ftsRebuildTimer !== null) clearTimeout(this.ftsRebuildTimer)
        this.ftsRebuildTimer = setTimeout(() => {
            this.ftsRebuildTimer = null
            if (this.db === null) return
            const db = this.db
            try {
                // In-process rebuild on the existing (keyed, busy_timeout-configured) connection (live entries only)
                runImmediateWriteTx(db, () => {
                    db.exec("INSERT INTO fts_content(fts_content) VALUES ('delete-all')")
                    db.exec(
                        'INSERT INTO fts_content(rowid, content) SELECT id, content FROM memory_journal WHERE deleted_at IS NULL'
                    )
                })
                logger.info(`Deferred FTS5 rebuild completed (${rebuildReason})`, {
                    module: 'NativeConnectionManager',
                    dbPath: this.dbPath,
                })
            } catch (err) {
                logger.error('Failed to rebuild FTS5 index', {
                    module: 'NativeConnectionManager',
                    error: err instanceof Error ? err.message : String(err),
                })
            }
        }, deferMs)
        this.ftsRebuildTimer.unref()
    }

    applyTeamSchema(): void {
        const db = this.ensureDb()
        MigrationManager.applyTeamMigrations(db)
        this.teamSchemaApplied = true
    }


    /**
     * @internal QUARANTINED
     * Maps better-sqlite3 results to the legacy `{ columns: string[], values: unknown[][] }[]` shape
     * Because better-sqlite3 returns arrays of objects instantly, we map them out.
     */
    exec(sql: string, params?: unknown[]): QueryResult[] {
        const db = this.ensureDb()

        // Strip SQL comments and string/identifier literals safely before checking for multiple statements
        const strippedSql = stripSqlStringsAndComments(sql)
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
        const isMutation = IS_MUTATION_RE.test(strippedSql)

        const stmt = db.prepare<unknown[], Record<string, unknown>>(sql)

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
        const rows = params && params.length > 0 ? stmt.all(...params) : stmt.all()

        const firstRow = rows[0]
        if (firstRow === undefined) {
            return []
        }

        const columns = Object.keys(firstRow)
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
        if (this.db === null) {
            return
        }
        runPassiveCheckpoint(this.db)
    }

    close(): void {
        this.initEpoch++
        if (this.ftsRebuildTimer !== null) {
            clearTimeout(this.ftsRebuildTimer)
            this.ftsRebuildTimer = null
        }
        if (this.db) {
            runOptimizeAndCheckpointBeforeClose(this.db)
            try {
                this.db.close()
            } catch (closeErr: unknown) {
                logger.debug('Database close encountered error', {
                    module: 'NativeConnectionManager',
                    error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                })
            }
            this.db = null
        }
        this.initializingPromise = null
        this.initialized = false
        logger.info('Native database closed', { module: 'NativeConnectionManager' })
    }

    private ensureDb(): Database {
        if (!this.db) {
            throw new ConnectionError('Database not initialized. Call initialize() first.')
        }
        return this.db
    }

    pragma(command: string): void {
        if (!ALLOWED_PRAGMAS_RE.test(command)) {
            throw new Error(`Disallowed PRAGMA command: ${command}`)
        }
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
        if (this.explicitBackupsDir !== undefined) return this.explicitBackupsDir
        if (this.teamSchemaApplied) return path.join(path.dirname(this.dbPath), 'backups-team')
        return path.join(path.dirname(this.dbPath), 'backups')
    }

    closeDbBeforeRestore(): void {
        this.initEpoch++
        if (this.ftsRebuildTimer !== null) {
            clearTimeout(this.ftsRebuildTimer)
            this.ftsRebuildTimer = null
        }
        if (this.db !== null) {
            try {
                this.db.close()
            } catch (closeErr: unknown) {
                logger.debug('Database close before restore encountered error', {
                    module: 'NativeConnectionManager',
                    error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                })
            }
            this.db = null
        }
        this.initializingPromise = null
        this.initialized = false
    }

    setDbAndInitialized(db: unknown): void {
        if (!isDatabaseHandle(db)) {
            throw new ConnectionError('Invalid database handle passed to setDbAndInitialized.')
        }
        this.db = db
        if (typeof db.pragma === 'function') {
            applyNativePragmas(db)
        }
        installStatementCache(db)
        this.initialized = true
    }

    // ========================================================================
    // Vector Metadata and Tables
    // ========================================================================

    getVectorMetadata(key: string): string | undefined {
        const db = this.ensureDb()
        const row = db
            .prepare<unknown[], { value: string }>('SELECT value FROM vector_metadata WHERE key = ?')
            .get(key)
        return row?.value
    }

    setVectorMetadata(key: string, value: string): void {
        const db = this.ensureDb()
        db.prepare('INSERT INTO vector_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    }

    createVecTable(dimensions: number): void {
        if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 8192) {
            throw new Error(`Invalid vector dimensions: ${String(dimensions)}`)
        }
        // vec0 does not support parameterized dimensions via '?'; validated positive int above
        this.ensureDb().exec(
            `CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(chunk_size=256, entry_id INTEGER PRIMARY KEY, embedding float[${dimensions}])`
        )
    }

    dropVecTable(): void {
        this.ensureDb().exec('DROP TABLE IF EXISTS vec_embeddings')
    }
}
