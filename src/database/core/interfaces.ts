import type {
    JournalEntry,
    Tag,
    Relationship,
    EntryType,
    RelationshipType,
    ImportanceResult,
} from '../../types/index.js'
import type { CreateEntryInput } from './schema.js'

export interface QueryResult {
    columns: string[]
    values: unknown[][]
}


/**
 * Universal SQLite interface mapping the sql.js API shape so that
 * business logic (EntriesManager, TagsManager) doesn't need to change.
 */
export interface IDatabaseConnection {
    /**
     * Executes queries that return results (SELECT, PRAGMA)
     * Must return the sql.js shape: { columns: string[], values: unknown[][] }[]
     */
    exec(sql: string, params?: unknown[]): QueryResult[]

    /**
     * Executes queries that modify data (INSERT, UPDATE, DELETE)
     */
    run(sql: string, params?: unknown[]): void

    /**
     * Prepares and executes startup operations
     */
    initialize(): Promise<void>

    /**
     * Explicit trigger to save database to disk (if applicable)
     */
    scheduleSave(): void
    flushSave(): void

    /**
     * Closes the database connection safely
     */
    close(): void

    /**
     * Team schema initialization hook
     */
    applyTeamSchema(): void

    /**
     * Directory path access for backups
     */
    getBackupsDir(): string
    getDbPath(): string

    /**
     * Provides the underlying driver (sql.js Database or better-sqlite3 Database)
     * Note: Avoid using this in business logic to prevent driver-coupling
     */
    getRawDb(): unknown

    /**
     * Execute a PRAGMA command.
     * Wraps the driver-specific pragma call so callers don't need getRawDb().
     */
    pragma(command: string): void

    /**
     * Internal mechanisms for backup/restore
     */
    closeDbBeforeRestore(): void
    setDbAndInitialized(db: unknown): void
}

/**
 * The public facade representing the capabilities of any memory-journal DB adapter
 */
export interface IDatabaseAdapter {
    initialize(): Promise<void>
    applyTeamSchema(): void
    flushSave(): void
    close(): void

    // Entries Manager
    createEntry(input: CreateEntryInput): JournalEntry
    getEntryById(id: number): JournalEntry | null
    getEntryByIdIncludeDeleted(id: number): JournalEntry | null
    getEntriesByIds(ids: number[]): Map<number, JournalEntry>
    calculateImportance(entryId: number): ImportanceResult
    getRecentEntries(limit?: number, isPersonal?: boolean): JournalEntry[]
    getEntriesPage(offset: number, limit: number): JournalEntry[]
    getActiveEntryCount(): number
    updateEntry(
        id: number,
        updates: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
        }
    ): JournalEntry | null
    deleteEntry(id: number, permanent?: boolean): boolean
    searchEntries(
        query: string,
        options?: {
            limit?: number
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
        }
    ): JournalEntry[]
    searchByDateRange(
        startDate: string,
        endDate: string,
        options?: {
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            workflowRunId?: number
            limit?: number
        }
    ): JournalEntry[]
    getStatistics(
        groupBy?: 'day' | 'week' | 'month',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean
    ): Record<string, unknown>

    // Tags Manager
    getTagsForEntry(entryId: number): string[]
    listTags(): Tag[]
    mergeTags(
        sourceTag: string,
        targetTag: string
    ): { entriesUpdated: number; sourceDeleted: boolean }

    // Relationships Manager
    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string
    ): Relationship
    getRelationships(entryId: number): Relationship[]

    // Backup Manager
    getBackupsDir(): string
    exportToFile(backupName?: string): Promise<{ filename: string; path: string; sizeBytes: number }>
    listBackups(): { filename: string; path: string; sizeBytes: number; createdAt: string }[]
    deleteOldBackups(keepCount: number): { deleted: string[]; kept: number }
    restoreFromFile(filename: string): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }>
    getHealthStatus(): {
        database: {
            path: string
            sizeBytes: number
            entryCount: number
            deletedEntryCount: number
            relationshipCount: number
            tagCount: number
        }
        backups: {
            directory: string
            count: number
            lastBackup: { filename: string; createdAt: string; sizeBytes: number } | null
        }
    }

    getRawDb(): unknown
    pragma(command: string): void
    executeRawQuery(sql: string, params?: unknown[]): QueryResult[]
}
