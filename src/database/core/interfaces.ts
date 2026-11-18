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
    ): { entries: JournalEntry[]; nextCursor?: string }
    getEntriesPage(offset: number, limit: number, workspaceId?: string, projectNumber?: number): { entries: JournalEntry[]; nextCursor?: string }
    getActiveEntryCount(workspaceId?: string, projectNumber?: number): number
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
            sessionId?: string | null
            targetWorkspaceId?: string
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
    getDeletedEntries(options?: { limit?: number; offset?: number; workspaceId?: string; projectNumber?: number }): { entries: JournalEntry[]; count: number }

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
            sessionId?: string | null
            targetWorkspaceId?: string
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
            limit?: number
            cursor?: string
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            prStatus?: string
            workflowRunId?: number
            tags?: string[]
            excludeTags?: string[]
            entryType?: EntryType
            startDate?: string
            endDate?: string
            sortBy?: 'timestamp' | 'importance' | 'blended'
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
            excludeTags?: string[]
            entryType?: EntryType
            startDate?: string
            endDate?: string
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[]; degraded?: boolean }
    searchByDateRange(
        startDate: string,
        endDate: string,
        options?: {
            entryType?: EntryType
            tags?: string[]
            excludeTags?: string[]
            cursor?: string
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            workflowRunId?: number
            limit?: number
            sortBy?: 'timestamp' | 'importance' | 'blended'
            includeArchived?: boolean
            workspaceId?: string
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
