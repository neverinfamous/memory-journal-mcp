import type { Database } from 'better-sqlite3'

/**
 * Interface representing a versioned database schema migration.
 */
export interface Migration {
    /**
     * Unique, strictly incrementing version number starting at 1.
     */
    readonly version: number

    /**
     * Descriptive name of the migration in kebab-case.
     */
    readonly name: string

    /**
     * Applies the migration steps to the database.
     */
    up(db: Database): void
}
