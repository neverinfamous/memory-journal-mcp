import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'
import { MIGRATIONS } from './migration-list.js'

/**
 * Ensures the schema_migrations table exists.
 */
function ensureMigrationsTable(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version INTEGER UNIQUE NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `)
}

/**
 * Detects pre-migration-framework databases, analyzes their schema,
 * and seeds the schema_migrations table so they are retrofitted safely.
 */
function retrofitPreMigrationDb(db: Database): void {
    // 1. Check if memory_journal exists
    const tableCheck = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_journal'`)
        .get() as { name: string } | undefined

    if (!tableCheck) {
        // New database, no retrofitting needed
        return
    }

    // 2. Check if schema_migrations already exists
    const migTableCheck = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
        .get() as { name: string } | undefined

    if (migTableCheck) {
        // Already has migration framework
        return
    }

    logger.info('Pre-migration database detected. Retrofitting schema migrations tracking...', {
        module: 'MigrationManager',
    })

    // Create the migrations table
    ensureMigrationsTable(db)

    // Inspect existing database schema to determine applied steps
    const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as {
        name: string
    }[]
    const columns = new Set(tableInfo.map((row) => row.name))

    const retrofittedVersions: { version: number; name: string }[] = []

    // Version 1 is applied if memory_journal exists
    retrofittedVersions.push({ version: 1, name: '001-init' })

    // Version 2: significance_type and auto_context
    if (columns.has('significance_type') && columns.has('auto_context')) {
        retrofittedVersions.push({ version: 2, name: '002-add-significance-and-context' })
    }

    // Version 3: deleted_at and is_archived
    if (columns.has('deleted_at') && columns.has('is_archived')) {
        retrofittedVersions.push({ version: 3, name: '003-add-deleted-and-archived' })
    }

    // Version 4: github fields
    if (columns.has('project_number') && columns.has('project_owner')) {
        retrofittedVersions.push({ version: 4, name: '004-add-github-and-workflow-integration' })
    }

    // Version 5: entry_revisions table
    const revTableCheck = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='entry_revisions'`)
        .get() as { name: string } | undefined
    if (revTableCheck) {
        retrofittedVersions.push({ version: 5, name: '005-add-entry-revisions' })
    }

    // Version 6: analytics_snapshots table
    const snapTableCheck = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_snapshots'`)
        .get() as { name: string } | undefined
    if (snapTableCheck) {
        retrofittedVersions.push({ version: 6, name: '006-add-analytics-snapshots' })
    }

    // Version 7: author (for team columns)
    if (columns.has('author')) {
        retrofittedVersions.push({ version: 7, name: '007-add-team-author' })
    }

    // Insert into schema_migrations
    const insertStmt = db.prepare(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
    )

    db.transaction(() => {
        for (const v of retrofittedVersions) {
            insertStmt.run(v.version, v.name)
        }
    })()

    logger.info('Database retrofitted successfully', {
        module: 'MigrationManager',
        versions: retrofittedVersions.map((v) => v.version),
    })
}

export const MigrationManager = {
    /**
     * Runs all pending migrations for the database.
     * @param db The better-sqlite3 database instance
     * @param isTeam Whether the database is a team database
     */
    runMigrations(db: Database, isTeam = false): void {
        // Retrofit pre-existing databases before running new migrations
        retrofitPreMigrationDb(db)

        // Ensure migrations table exists
        ensureMigrationsTable(db)

        // Query applied migrations
        const rows = db.prepare('SELECT version FROM schema_migrations').all() as {
            version: number
        }[]
        const applied = new Set(rows.map((row) => row.version))

        // Run migrations inside a transaction
        db.transaction(() => {
            for (const migration of MIGRATIONS) {
                // If it is migration 7 (team author) and we are not a team database,
                // skip it unless it's explicitly team mode.
                if (migration.version === 7 && !isTeam) {
                    continue
                }

                if (!applied.has(migration.version)) {
                    logger.info(`Applying migration ${migration.version}: ${migration.name}...`, {
                        module: 'MigrationManager',
                    })

                    migration.up(db)

                    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
                        migration.version,
                        migration.name
                    )

                    logger.info(`Migration ${migration.version} applied successfully.`, {
                        module: 'MigrationManager',
                    })
                }
            }
        })()
    },

    /**
     * Applies team-specific migrations (such as adding the author column).
     */
    applyTeamMigrations(db: Database): void {
        this.runMigrations(db, true)
    },
}
