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
 * Universal SQLite database connection interface.
 * Business logic (EntriesManager, TagsManager) programs against this
 * abstraction rather than the better-sqlite3 driver directly.
 */
export interface IDatabaseConnection {
    /**
     * @internal QUARANTINED: Internal schema and migration use only.
     * Executes queries that return results (SELECT, PRAGMA)
     * Must return the shape: { columns: string[], values: unknown[][] }[]
     */
    exec(sql: string, params?: unknown[]): QueryResult[]

    /**
     * @internal QUARANTINED: Internal schema and migration use only.
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
     * @internal QUARANTINED
     * Provides the underlying better-sqlite3 Database instance.
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
    getEntriesByIdsWithImportance(
        ids: number[]
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }>
    calculateImportance(entryId: number): ImportanceResult
    getRecentEntries(
        limit?: number,
        isPersonal?: boolean,
        sortBy?: 'timestamp' | 'importance'
    ): JournalEntry[]
    getEntriesPage(offset: number, limit: number): JournalEntry[]
    getActiveEntryCount(): number
    updateEntry(
        id: number,
        updates: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            significanceType?: string
            autoContext?: string | null
            projectNumber?: number
            projectOwner?: string
            issueNumber?: number
            issueUrl?: string
            prNumber?: number
            prUrl?: string
            prStatus?: string
            workflowRunId?: number
            workflowName?: string
            workflowStatus?: string
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
            prStatus?: string
            workflowRunId?: number
            tags?: string[]
            entryType?: EntryType
            startDate?: string
            endDate?: string
            sortBy?: 'timestamp' | 'importance'
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
            sortBy?: 'timestamp' | 'importance'
        }
    ): JournalEntry[]
    getStatistics(
        groupBy?: 'day' | 'week' | 'month' | 'year',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean
    ): Record<string, unknown>
    getAuthorStatistics(): { author: string; count: number }[]
    getAuthorsForEntries(entryIds: number[]): Map<number, string | null>

    // Tags Manager
    getTagsForEntry(entryId: number): string[]
    getTagsForEntries(entryIds: number[]): Map<number, string[]>
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
    getRelationshipsForEntries(entryIds: number[]): Map<number, Relationship[]>

    // Backup Manager
    getBackupsDir(): string
    exportToFile(
        backupName?: string
    ): Promise<{ filename: string; path: string; sizeBytes: number }>
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

    // Analytics Snapshots
    saveAnalyticsSnapshot(type: string, data: Record<string, unknown>): number
    getLatestAnalyticsSnapshot(
        type: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null
    getAnalyticsSnapshots(
        type: string,
        limit?: number
    ): { id: number; createdAt: string; data: Record<string, unknown> }[]
    computeDigest(): Record<string, unknown>

    pragma(command: string): void

    // Advanced Analytic and Relationship queries (Replaces raw queries)
    getCrossProjectInsights(options: { 
        startDate?: string; 
        endDate?: string; 
        minEntries: number; 
        inactiveThresholdDays: number 
    }): {
        projects: Record<string, unknown>[]
        inactiveProjects: { project_number: number; last_entry_date: string }[]
    }

    visualizeRelationships(options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
    }): {
        nodes: { id: string | number; label: string; group: string; metadata?: Record<string, unknown> }[]
        edges: { from: string | number; to: string | number; label: string; type: string }[]
    }

    getTeamCollaborationMatrix(options: { period: string; limit: number }): {
        totalAuthors: number
        totalEntries: number
        authorActivity: { author: string; period: string; entryCount: number }[]
        crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
        impactFactor: { author: string; inboundLinks: number }[]
    }

    getWorkflowActionEntries(limit: number): JournalEntry[]
    getSignificantEntries(limit: number, projectNumber?: number): JournalEntry[]
    getRecentGraphRelationships(limit: number): {
        from_entry_id: number; to_entry_id: number; relationship_type: string;
        from_content: string; to_content: string;
    }[]

    /**
     * @internal QUARANTINED
     * @deprecated Exposes underlying database instance, violating adapter boundaries. Slated for removal.
     */
    getRawDb(): unknown
}
