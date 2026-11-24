import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'
import { MIGRATIONS } from './migration-list.js'

/** Migration versions that only apply to team databases (7: author, 20: origin_personal_id). */
const TEAM_ONLY_MIGRATION_VERSIONS: ReadonlySet<number> = new Set([7, 20])

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

/** True when a table with the given name exists in the database. */
function tableExists(db: Database, name: string): boolean {
    const row = db
        .prepare<unknown[], { name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name)
    return row !== undefined
}

/**
 * Infer which versioned migrations a pre-framework database has already applied,
 * from its memory_journal columns and the presence of later tables.
 */
function detectAppliedVersions(
    db: Database,
    columns: Set<string>
): { version: number; name: string }[] {
    // Version 1 is applied if memory_journal exists
    const versions: { version: number; name: string }[] = [{ version: 1, name: '001-init' }]

    // Version 2: significance_type and auto_context
    if (columns.has('significance_type') && columns.has('auto_context')) {
        versions.push({ version: 2, name: '002-add-significance-and-context' })
    }

    // Version 3: deleted_at and is_archived
    if (columns.has('deleted_at') && columns.has('is_archived')) {
        versions.push({ version: 3, name: '003-add-deleted-and-archived' })
    }

    // Version 4: github fields
    if (columns.has('project_number') && columns.has('project_owner')) {
        versions.push({ version: 4, name: '004-add-github-and-workflow-integration' })
    }

    // Version 5: entry_revisions table
    if (tableExists(db, 'entry_revisions')) {
        versions.push({ version: 5, name: '005-add-entry-revisions' })
    }

    // Version 6: analytics_snapshots table
    if (tableExists(db, 'analytics_snapshots')) {
        versions.push({ version: 6, name: '006-add-analytics-snapshots' })
    }

    // Version 7: author (for team columns)
    if (columns.has('author')) {
        versions.push({ version: 7, name: '007-add-team-author' })
    }
    return versions
}

function runInImmediateTx(db: Database, fn: () => void): void {
    if (db.inTransaction) {
        fn()
    } else {
        db.transaction(fn).immediate()
    }
}

/**
 * Detects pre-migration-framework databases, analyzes their schema,
 * and seeds the schema_migrations table so they are retrofitted safely.
 */
function retrofitPreMigrationDb(db: Database): void {
    runInImmediateTx(db, () => {
        if (!tableExists(db, 'memory_journal') || tableExists(db, 'schema_migrations')) {
            return
        }

        logger.info('Pre-migration database detected. Retrofitting schema migrations tracking...', {
            module: 'MigrationManager',
        })

        ensureMigrationsTable(db)

        const tableInfo = db.prepare<unknown[], { name: string }>('PRAGMA table_info(memory_journal)').all()
        const columns = new Set(tableInfo.map((row) => row.name))
        const retrofittedVersions = detectAppliedVersions(db, columns)

        const insertStmt = db.prepare(
            'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
        )
        for (const v of retrofittedVersions) {
            insertStmt.run(v.version, v.name)
        }

        logger.info('Database retrofitted successfully', {
            module: 'MigrationManager',
            versions: retrofittedVersions.map((v) => v.version),
        })
    })
}

export const MigrationManager = {
    /**
     * Runs all pending migrations for the database.
     * @param db The better-sqlite3 database instance
     * @param isTeam Whether the database is a team database
     */
    runMigrations(db: Database, isTeam = false): void {
        runInImmediateTx(db, () => {
            retrofitPreMigrationDb(db)
            ensureMigrationsTable(db)

            const rows = db.prepare<unknown[], { version: number }>('SELECT version FROM schema_migrations').all()
            const applied = new Set(rows.map((row) => row.version))

            for (const migration of MIGRATIONS) {
                if (TEAM_ONLY_MIGRATION_VERSIONS.has(migration.version) && !isTeam) {
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
        })
    },

    /**
     * Applies team-specific migrations (such as adding the author column).
     */
    applyTeamMigrations(db: Database): void {
        this.runMigrations(db, true)
    },
}
