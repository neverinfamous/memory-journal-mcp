import type {
    JournalEntry,
    Tag,
    Relationship,
    EntryType,
    RelationshipType,
    ImportanceResult,
    EntryRevision,
    AnchorStatus,
    Anchor,
} from '../../types/index.js'
import type { CreateEntryInput } from './schema.js'

export type TeamRole = 'admin' | 'member' | 'viewer'

export interface TeamMember {
    id: number
    author: string
    role: TeamRole
    displayName: string | null
    addedBy: string | null
    createdAt: string
    updatedAt: string
}

export interface AuthorAlias {
    id: number
    alias: string
    canonicalAuthor: string
    createdAt: string
    createdBy: string | null
}

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
    getEntryById(id: number, workspaceId?: string): JournalEntry | null
    getEntryByIdIncludeDeleted(id: number, workspaceId?: string): JournalEntry | null
    getEntryHistory(id: number): EntryRevision[]
    getEntriesByIds(ids: number[]): Map<number, JournalEntry>
    getEntriesByIdsWithImportance(
        ids: number[]
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }>
    calculateImportance(entryId: number): ImportanceResult
    getRecentEntries(
        limit?: number,
        isPersonal?: boolean,
        sortBy?: 'timestamp' | 'importance',
        cursor?: string,
        includeArchived?: boolean,
        workspaceId?: string
    ): { entries: JournalEntry[]; nextCursor?: string }
    getEntriesPage(offset: number, limit: number): { entries: JournalEntry[]; nextCursor?: string }
    getActiveEntryCount(workspaceId?: string): number
    updateEntry(
        id: number,
        updates: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            significanceType?: string | null
            autoContext?: string | null
            projectNumber?: number | null
            projectOwner?: string | null
            issueNumber?: number | null
            issueUrl?: string | null
            prNumber?: number | null
            prUrl?: string | null
            prStatus?: string | null
            workflowRunId?: number | null
            workflowName?: string | null
            workflowStatus?: string | null
            isArchived?: boolean
            expectedVersion?: number
            workspaceId?: string
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
            sessionId?: string
            targetWorkspaceId?: string
        }
    ): JournalEntry | null
    deleteEntry(id: number, permanent?: boolean): boolean
    getAnchorsByEntryId(entryId: number): Anchor[]
    updateAnchorStatus(id: number, status: AnchorStatus): void

    // Team Membership (RBAC)
    addTeamMember(author: string, role: TeamRole, addedBy?: string, displayName?: string): TeamMember
    removeTeamMember(author: string): boolean
    updateTeamMemberRole(author: string, newRole: TeamRole): TeamMember | null
    getTeamMember(author: string): TeamMember | null
    listTeamMembers(): TeamMember[]
    getTeamMemberCount(): number
    isTeamRbacActive(): boolean
    resolveTeamRole(author: string, defaultRole?: TeamRole | 'denied'): TeamRole | null
    
    // Author Aliases (Level 2 Identity)
    addAuthorAlias(alias: string, canonicalAuthor: string, createdBy?: string): AuthorAlias
    removeAuthorAlias(alias: string): boolean
    listAuthorAliases(canonicalAuthor?: string): AuthorAlias[]
    resolveAuthor(rawAuthor: string): string
    resolveAuthors(rawAuthors: string[]): Map<string, string>
    consolidateAuthors(canonicalAuthor: string): number

    // Soft-Delete Recovery
    restoreEntry(id: number): boolean
    getDeletedEntries(options?: { limit?: number; offset?: number; workspaceId?: string }): { entries: JournalEntry[]; count: number }
    
    // Batch Operations
    createEntries(inputs: CreateEntryInput[]): { created: JournalEntry[]; errors: { index: number; error: Error }[] }
    updateEntries(
        updates: {
            id: number
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            significanceType?: string | null
            autoContext?: string | null
            projectNumber?: number | null
            projectOwner?: string | null
            issueNumber?: number | null
            issueUrl?: string | null
            prNumber?: number | null
            prUrl?: string | null
            prStatus?: string | null
            workflowRunId?: number | null
            workflowName?: string | null
            workflowStatus?: string | null
            isArchived?: boolean
            expectedVersion?: number
            workspaceId?: string
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
            sessionId?: string
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] }
    deleteEntries(
        ids: number[],
        permanent?: boolean
    ): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] }

    searchEntries(
        query: string,
        options?: {
            limit?: number
            cursor?: string
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
            includeArchived?: boolean
            includeHighlights?: boolean
            fuzzy_match?: boolean
            auto_correct?: boolean
            workspaceId?: string
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean; highlights?: { id: number; snippet: string }[]; suggestions?: string[]; correctedQuery?: string }
    getSearchFacets(
        query: string,
        options?: {
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
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[] }
    searchByDateRange(
        startDate: string,
        endDate: string,
        options?: {
            entryType?: EntryType
            tags?: string[]
            cursor?: string
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            workflowRunId?: number
            limit?: number
            sortBy?: 'timestamp' | 'importance'
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { entries: JournalEntry[]; nextCursor?: string }
    getStatistics(
        groupBy?: 'day' | 'week' | 'month' | 'year',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean,
        workspaceId?: string
    ): Record<string, unknown>
    getAuthorStatistics(workspaceId?: string): { author: string; count: number }[]
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
    restoreFromFile(
        filename: string,
        runtime?: unknown
    ): Promise<{
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
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
        workspaceId?: string
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
        nodes: {
            id: string | number
            label: string
            group: string
            metadata?: Record<string, unknown>
        }[]
        edges: { from: string | number; to: string | number; label: string; type: string }[]
    }

    getTeamCollaborationMatrix(options: { period: string; limit: number }): {
        totalAuthors: number
        totalEntries: number
        authorActivity: { author: string; period: string; entryCount: number }[]
        crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
        impactFactor: { author: string; inboundLinks: number }[]
    }

    getWorkflowActionEntries(limit: number, workspaceId?: string): JournalEntry[]
    getSignificantEntries(limit: number, projectNumber?: number, workspaceId?: string): JournalEntry[]
    getRecentGraphRelationships(limit: number): {
        from_entry_id: number
        to_entry_id: number
        relationship_type: string
        from_content: string
        to_content: string
    }[]

    // ========================================================================
    // Vector Search Primitives
    // ========================================================================

    getVectorMetadata(key: string): string | undefined
    setVectorMetadata(key: string, value: string): void
    createVecTable(dimensions: number): void
    dropVecTable(): void

    upsertVector(entryId: number, embedding: Float32Array): void
    upsertVectors(vectors: { entryId: number; embedding: Float32Array }[]): void
    searchVectors(embedding: Float32Array, limit: number): { entry_id: number; distance: number }[]
    getVector(entryId: number): Float32Array | null
    deleteVector(entryId: number): void
    clearVectors(): void
    getVectorCount(): number
    cleanupStaleVectors(): void

    // Auto-Prune
    executeDataLifecycle(options: {
        archiveOlderThanDays: number
        pruneOlderThanDays: number
        hardDeleteOlderThanDays: number
        importanceThreshold: number
        dryRun?: boolean
        excludeTags?: string[]
    }): {
        archivedCount: number
        prunedCount: number
        hardDeletedCount: number
        candidates?: {
            archived: { id: number; importance_score: number }[]
            pruned: { id: number; importance_score: number }[]
            hardDeleted: { id: number; age_days: number }[]
        }
    }

    executeInTransaction<T>(cb: () => T): T

    getRelationshipHubs(limit: number): { entryId: number; content: string; totalLinks: number }[]
    getOrphanCount(workspaceId?: string): number
}
