import type { Database } from 'better-sqlite3'
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
    CreateEntryInput as BaseCreateEntryInput,
    CreateTeamEntryInput as BaseCreateTeamEntryInput,
} from '../../types/index.js'
import type { IDatabaseVectorAndAdminAdapter } from './vector-and-admin-interfaces.js'

export type * from './vector-and-admin-interfaces.js'

export type CreateEntryInput = Omit<BaseCreateEntryInput, 'anchors'> & {
    anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[] | undefined
}
export type CreateTeamEntryInput = Omit<BaseCreateTeamEntryInput, 'anchors'> & {
    anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[] | undefined
}

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
    getNativeDb?(): Database
}

/**
 * The public facade representing the capabilities of any memory-journal DB adapter
 */
export interface IDatabaseAdapter extends IDatabaseVectorAndAdminAdapter {
    initialize(): Promise<void>
    applyTeamSchema(): void
    flushSave(): void
    close(): void
    getDbPath(): string

    // Entries Manager
    createEntry(input: CreateEntryInput): JournalEntry
    getEntryById(id: number, workspaceId?: string): JournalEntry | null
    hasActiveEntry?(id: number): boolean
    getActiveEntryIds?(ids: readonly number[]): Set<number>
    getEntryByIdIncludeDeleted(id: number, workspaceId?: string): JournalEntry | null
    getEntriesByIdsIncludeDeleted?(ids: number[], workspaceId?: string): Map<number, JournalEntry>
    getAnchorsByEntryIds?(entryIds: number[], workspaceId?: string): Map<number, Anchor[]>
    getImportanceScoresByIds?(entryIds: number[], workspaceId?: string): Map<number, ImportanceResult>
    getEntryHistory(id: number, workspaceId?: string): EntryRevision[]
    getEntriesByIds(ids: number[], workspaceId?: string): Map<number, JournalEntry>
    getEntriesByIdsWithImportance(
        ids: number[],
        workspaceId?: string
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }>
    calculateImportance(entryId: number, workspaceId?: string): ImportanceResult | null
    getRecentEntries(
        limit?: number,
        isPersonal?: boolean,
        sortBy?: 'timestamp' | 'importance',
        cursor?: string,
        includeArchived?: boolean,
        workspaceId?: string,
        projectNumber?: number,
        offset?: number
    ): { entries: JournalEntry[]; nextCursor?: string | undefined }
    getEntriesPage(offset: number, limit: number, workspaceId?: string, projectNumber?: number): { entries: JournalEntry[]; nextCursor?: string }
    getEntriesAfter?(
        limit: number,
        workspaceId?: string,
        projectNumber?: number,
        cursor?: { timestamp: string; id: number }
    ): JournalEntry[]
    getLatestEntryPerProject?(): Map<string, { id: number; timestamp: string; entryType: string }>
    getActiveEntryCount(workspaceId?: string, projectNumber?: number): number
    updateEntry(
        id: number,
        updates: {
            content?: string | undefined
            entryType?: EntryType | undefined
            tags?: string[] | undefined
            isPersonal?: boolean | undefined
            significanceType?: string | null | undefined
            autoContext?: string | null | undefined
            projectNumber?: number | null | undefined
            projectOwner?: string | null | undefined
            issueNumber?: number | null | undefined
            issueUrl?: string | null | undefined
            prNumber?: number | null | undefined
            prUrl?: string | null | undefined
            prStatus?: string | null | undefined
            workflowRunId?: number | null | undefined
            workflowName?: string | null | undefined
            workflowStatus?: string | null | undefined
            isArchived?: boolean | undefined
            expectedVersion?: number | undefined
            workspaceId?: string | undefined
            trustScore?: number | undefined
            impactScore?: number | undefined
            validationStatus?: 'passed' | 'failed' | 'none' | undefined
            sessionId?: string | null | undefined
            anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[] | undefined
            targetWorkspaceId?: string | undefined
        }
    ): JournalEntry | null
    deleteEntry(id: number, permanent?: boolean, workspaceId?: string): { success: boolean; warning?: string }
    getAnchorsByEntryId(entryId: number, workspaceId?: string): Anchor[]
    updateAnchorStatus(
        id: number,
        status: AnchorStatus,
        workspaceId?: string,
        projectNumber?: number
    ): boolean

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
    addAuthorAlias(alias: string, canonicalAuthor: string, createdBy?: string, workspaceId?: string): AuthorAlias
    removeAuthorAlias(alias: string, workspaceId?: string): boolean
    listAuthorAliases(canonicalAuthor?: string, workspaceId?: string): AuthorAlias[]
    resolveAuthor(rawAuthor: string, workspaceId?: string): string
    resolveAuthors(rawAuthors: string[], workspaceId?: string): Map<string, string>
    consolidateAuthors(canonicalAuthor: string, workspaceId?: string, projectNumber?: number | null): number

    // Soft-Delete Recovery
    restoreEntry(id: number, workspaceId?: string): boolean
    getDeletedEntries(options?: { limit?: number | undefined; offset?: number | undefined; workspaceId?: string | undefined; projectNumber?: number | undefined }): { entries: JournalEntry[]; count: number }

    // Batch Operations
    createEntries(inputs: CreateEntryInput[]): { created: JournalEntry[]; errors: { index: number; error: Error }[] }
    updateEntries(
        updates: {
            id: number
            content?: string | undefined
            entryType?: EntryType | undefined
            tags?: string[] | undefined
            isPersonal?: boolean | undefined
            significanceType?: string | null | undefined
            autoContext?: string | null | undefined
            projectNumber?: number | null | undefined
            projectOwner?: string | null | undefined
            issueNumber?: number | null | undefined
            issueUrl?: string | null | undefined
            prNumber?: number | null | undefined
            prUrl?: string | null | undefined
            prStatus?: string | null | undefined
            workflowRunId?: number | null | undefined
            workflowName?: string | null | undefined
            workflowStatus?: string | null | undefined
            isArchived?: boolean | undefined
            expectedVersion?: number | undefined
            workspaceId?: string | undefined
            trustScore?: number | undefined
            impactScore?: number | undefined
            validationStatus?: 'passed' | 'failed' | 'none' | undefined
            sessionId?: string | null | undefined
            anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[] | undefined
            targetWorkspaceId?: string | undefined
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] }
    deleteEntries(
        ids: number[],
        permanent?: boolean,
        workspaceId?: string
    ): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[]; warning?: string }

    searchEntries(
        query: string,
        options?: {
            limit?: number | undefined
            cursor?: string | undefined
            isPersonal?: boolean | undefined
            projectNumber?: number | undefined
            issueNumber?: number | undefined
            prNumber?: number | undefined
            prStatus?: string | undefined
            workflowRunId?: number | undefined
            tags?: string[] | undefined
            excludeTags?: string[] | undefined
            entryType?: EntryType | undefined
            startDate?: string | undefined
            endDate?: string | undefined
            sortBy?: 'timestamp' | 'importance' | 'blended' | undefined
            includeArchived?: boolean | undefined
            includeHighlights?: boolean | undefined
            fuzzy_match?: boolean | undefined
            auto_correct?: boolean | undefined
            workspaceId?: string | undefined
            offset?: number | undefined
        }
    ): { entries: JournalEntry[]; nextCursor?: string | undefined; degraded?: boolean | undefined; highlights?: { id: number; snippet: string }[] | undefined; suggestions?: string[] | undefined; correctedQuery?: string | undefined }
    getSearchFacets(
        query: string,
        options?: {
            isPersonal?: boolean | undefined
            projectNumber?: number | undefined
            issueNumber?: number | undefined
            prNumber?: number | undefined
            prStatus?: string | undefined
            workflowRunId?: number | undefined
            tags?: string[] | undefined
            excludeTags?: string[] | undefined
            entryType?: EntryType | undefined
            startDate?: string | undefined
            endDate?: string | undefined
            includeArchived?: boolean | undefined
            workspaceId?: string | undefined
        }
    ): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[]; degraded?: boolean }
    searchByDateRange(
        startDate: string,
        endDate: string,
        options?: {
            entryType?: EntryType | undefined
            tags?: string[] | undefined
            excludeTags?: string[] | undefined
            cursor?: string | undefined
            isPersonal?: boolean | undefined
            projectNumber?: number | undefined
            issueNumber?: number | undefined
            prNumber?: number | undefined
            workflowRunId?: number | undefined
            limit?: number | undefined
            sortBy?: 'timestamp' | 'importance' | 'blended' | undefined
            includeArchived?: boolean | undefined
            workspaceId?: string | undefined
        }
    ): { entries: JournalEntry[]; nextCursor?: string }
    getStatistics(
        groupBy?: 'day' | 'week' | 'month' | 'year',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean,
        workspaceId?: string,
        projectNumber?: number
    ): Record<string, unknown>
    getAuthorStatistics(workspaceId?: string, projectNumber?: number): { author: string; count: number }[]
    getAuthorsForEntries(entryIds: number[]): Map<number, string | null>

    // Tags Manager
    getTagsForEntry(entryId: number): string[]
    getTagsForEntries(entryIds: number[]): Map<number, string[]>
    /** Team DB only: team entry ID -> origin personal ID for mirrored rows (migration 020). */
    getMirrorOrigins?(entryIds: number[]): Map<number, number>
    listTags(workspaceId?: string, projectNumber?: number): Tag[]
    mergeTags(
        sourceTag: string,
        targetTag: string,
        workspaceId?: string,
        projectNumber?: number
    ): { entriesUpdated: number; sourceDeleted: boolean }

    // Relationships Manager
    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string,
        workspaceId?: string
    ): Relationship
    getRelationships(entryId: number, workspaceId?: string): Relationship[]
    getRelationshipsForEntries(
        entryIds: number[],
        workspaceId?: string
    ): Map<number, Relationship[]>
}
