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
    ToolHandlerConfig,
} from '../../types/index.js'
import type { CreateEntryInput } from '../core/schema.js'
import type {
    IDatabaseAdapter,
    TeamMember,
    TeamRole,
    AuthorAlias,
} from '../core/interfaces.js'

import { NativeConnectionManager } from './native-connection.js'
import { AliasManager } from './aliases.js'
import { TagsManager } from './tags.js'
import { EntriesManager } from './entries/index.js'
import { RelationshipsManager } from './relationships.js'
import { BackupManager } from './backup.js'
import { MembersManager } from './members.js'
import { HealthOperations } from './health-operations.js'
import { LifecycleOperations } from './lifecycle-operations.js'
import { InsightsOperations } from './insights-operations.js'
import { VectorOperations } from './vector-operations.js'

/**
 * SQLite Database Adapter for Memory Journal using better-sqlite3 native driver
 */
export class DatabaseAdapter implements IDatabaseAdapter {
    private connection: NativeConnectionManager
    private tagsMgr: TagsManager
    private entriesMgr: EntriesManager
    private relationshipsMgr: RelationshipsManager
    private backupMgr: BackupManager
    private membersMgr: MembersManager
    private aliasMgr: AliasManager
    private healthOps: HealthOperations
    private lifecycleOps: LifecycleOperations
    private insightsOps: InsightsOperations
    private vectorOps: VectorOperations

    constructor(dbPath: string, config?: ToolHandlerConfig) {
        this.connection = new NativeConnectionManager(dbPath)
        this.tagsMgr = new TagsManager(this.connection)
        this.entriesMgr = new EntriesManager(this.connection, this.tagsMgr, config)
        this.relationshipsMgr = new RelationshipsManager(this.connection, this.entriesMgr)
        this.backupMgr = new BackupManager(this.connection)
        this.membersMgr = new MembersManager(this.connection)
        this.aliasMgr = new AliasManager(this.connection)
        this.healthOps = new HealthOperations(this.connection, this.backupMgr)
        this.lifecycleOps = new LifecycleOperations(this.connection)
        this.insightsOps = new InsightsOperations(this.connection)
        this.vectorOps = new VectorOperations(this.connection)
    }

    async initialize(): Promise<void> {
        return this.connection.initialize()
    }

    applyTeamSchema(): void {
        this.connection.applyTeamSchema()
    }

    flushSave(): void {
        this.connection.flushSave()
    }

    close(): void {
        this.connection.close()
    }

    createEntry(input: CreateEntryInput): JournalEntry {
        return this.entriesMgr.createEntry(input)
    }

    getEntryById(id: number, workspaceId?: string): JournalEntry | null {
        return this.entriesMgr.getEntryById(id, workspaceId)
    }

    getEntryHistory(id: number): EntryRevision[] {
        return this.entriesMgr.getEntryHistory(id)
    }

    getEntryByIdIncludeDeleted(id: number, workspaceId?: string): JournalEntry | null {
        return this.entriesMgr.getEntryByIdIncludeDeleted(id, workspaceId)
    }

    getEntriesByIds(ids: number[]): Map<number, JournalEntry> {
        return this.entriesMgr.getEntriesByIds(ids)
    }

    getEntriesByIdsWithImportance(
        ids: number[]
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }> {
        return this.entriesMgr.getEntriesByIdsWithImportance(ids)
    }

    calculateImportance(entryId: number): ImportanceResult {
        return this.entriesMgr.calculateImportance(entryId)
    }

    getRecentEntries(
        limit?: number,
        isPersonal?: boolean,
        sortBy?: 'timestamp' | 'importance',
        cursor?: string,
        includeArchived?: boolean,
        workspaceId?: string,
        projectNumber?: number,
        offset?: number
    ): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getRecentEntries(
            limit ?? 10,
            isPersonal,
            sortBy,
            cursor,
            includeArchived,
            workspaceId,
            projectNumber,
            offset
        )
    }

    getEntriesPage(offset: number, limit: number): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getEntriesPage(offset, limit)
    }

    getActiveEntryCount(workspaceId?: string): number {
        return this.entriesMgr.getActiveEntryCount(workspaceId)
    }

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
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
            workspaceId?: string
            targetWorkspaceId?: string
        }
    ): JournalEntry | null {
        return this.entriesMgr.updateEntry(id, updates)
    }

    deleteEntry(id: number, permanent = false): boolean {
        return this.executeInTransaction(() => {
            const success = this.entriesMgr.deleteEntry(id, permanent)
            if (success) {
                this.deleteVector(id)
            }
            return success
        })
    }

    updateAnchorStatus(id: number, status: AnchorStatus): void {
        this.entriesMgr.updateAnchorStatus(id, status)
    }

    getAnchorsByEntryId(entryId: number): Anchor[] {
        return this.entriesMgr.getAnchorsByEntryId(entryId)
    }

    // Team Membership (RBAC)

    addTeamMember(
        author: string,
        role: TeamRole,
        addedBy?: string,
        displayName?: string
    ): TeamMember {
        return this.membersMgr.addMember(author, role, addedBy, displayName)
    }

    removeTeamMember(author: string): boolean {
        return this.membersMgr.removeMember(author)
    }

    updateTeamMemberRole(author: string, newRole: TeamRole): TeamMember | null {
        return this.membersMgr.updateRole(author, newRole)
    }

    getTeamMember(author: string): TeamMember | null {
        return this.membersMgr.getMember(author)
    }

    listTeamMembers(): TeamMember[] {
        return this.membersMgr.listMembers()
    }

    getTeamMemberCount(): number {
        return this.membersMgr.getMemberCount()
    }

    isTeamRbacActive(): boolean {
        return this.membersMgr.isRbacActive()
    }

    resolveTeamRole(author: string, defaultRole?: TeamRole | 'denied'): TeamRole | null {
        return this.membersMgr.resolveRole(author, defaultRole)
    }

    // ========================================================================
    // Author Aliases (Level 2 Identity)
    // ========================================================================

    addAuthorAlias(alias: string, canonicalAuthor: string, createdBy?: string): AuthorAlias {
        return this.aliasMgr.addAlias(alias, canonicalAuthor, createdBy)
    }

    removeAuthorAlias(alias: string): boolean {
        return this.aliasMgr.removeAlias(alias)
    }

    listAuthorAliases(canonicalAuthor?: string): AuthorAlias[] {
        return this.aliasMgr.listAliases(canonicalAuthor)
    }

    resolveAuthor(rawAuthor: string): string {
        return this.aliasMgr.resolveAuthor(rawAuthor)
    }

    resolveAuthors(rawAuthors: string[]): Map<string, string> {
        return this.aliasMgr.resolveAuthors(rawAuthors)
    }

    consolidateAuthors(canonicalAuthor: string): number {
        return this.aliasMgr.consolidateAuthors(canonicalAuthor)
    }

    restoreEntry(id: number): boolean {
        return this.entriesMgr.restoreEntry(id)
    }

    getDeletedEntries(options?: {
        limit?: number
        offset?: number
    }): { entries: JournalEntry[]; count: number } {
        return this.entriesMgr.getDeletedEntries(options)
    }

    createEntries(inputs: CreateEntryInput[]): {
        created: JournalEntry[]
        errors: { index: number; error: Error }[]
    } {
        return this.entriesMgr.createEntries(inputs)
    }

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
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return this.entriesMgr.updateEntries(updates)
    }

    deleteEntries(
        ids: number[],
        permanent = false
    ): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return this.executeInTransaction(() => {
            const result = this.entriesMgr.deleteEntries(ids, permanent)
            for (const id of result.deleted) {
                try {
                    this.deleteVector(id)
                } catch {
                    // Vectors failure shouldn't fail the entry deletion
                }
            }
            return result
        })
    }

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
            cursor?: string
            includeArchived?: boolean
            includeHighlights?: boolean
            fuzzy_match?: boolean
            auto_correct?: boolean
            workspaceId?: string
        }
    ): {
        entries: JournalEntry[]
        nextCursor?: string
        degraded?: boolean
        highlights?: { id: number; snippet: string }[]
        suggestions?: string[]
        correctedQuery?: string
    } {
        return this.entriesMgr.searchEntries(query, options)
    }

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
    ): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[] } {
        return this.entriesMgr.getSearchFacets(query, options)
    }

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
            cursor?: string
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean } {
        return this.entriesMgr.searchByDateRange(startDate, endDate, options)
    }

    getStatistics(
        groupBy?: 'day' | 'week' | 'month' | 'year',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean,
        workspaceId?: string
    ): ReturnType<EntriesManager['getStatistics']> {
        return this.entriesMgr.getStatistics(
            groupBy,
            startDate,
            endDate,
            projectBreakdown,
            workspaceId
        )
    }

    getTagsForEntry(entryId: number): string[] {
        return this.tagsMgr.getTagsForEntry(entryId)
    }

    getTagsForEntries(entryIds: number[]): Map<number, string[]> {
        return this.tagsMgr.batchGetTagsForEntries(entryIds)
    }

    listTags(): Tag[] {
        return this.tagsMgr.listTags()
    }

    mergeTags(
        sourceTag: string,
        targetTag: string
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        return this.tagsMgr.mergeTags(sourceTag, targetTag)
    }

    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string
    ): Relationship {
        return this.relationshipsMgr.linkEntries(
            fromEntryId,
            toEntryId,
            relationshipType,
            description
        )
    }

    getRelationships(entryId: number): Relationship[] {
        return this.relationshipsMgr.getRelationships(entryId)
    }

    getRelationshipsForEntries(entryIds: number[]): Map<number, Relationship[]> {
        return this.relationshipsMgr.getRelationshipsForEntries(entryIds)
    }

    getBackupsDir(): string {
        return this.connection.getBackupsDir()
    }

    async exportToFile(
        backupName?: string
    ): Promise<{ filename: string; path: string; sizeBytes: number }> {
        return this.backupMgr.exportToFile(backupName)
    }

    listBackups(): { filename: string; path: string; sizeBytes: number; createdAt: string }[] {
        return this.backupMgr.listBackups()
    }

    deleteOldBackups(keepCount: number): { deleted: string[]; kept: number } {
        return this.backupMgr.deleteOldBackups(keepCount)
    }

    async restoreFromFile(
        filename: string,
        runtime?: unknown
    ): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        return this.backupMgr.restoreFromFile(filename, runtime)
    }

    getHealthStatus(): ReturnType<IDatabaseAdapter['getHealthStatus']> {
        return this.healthOps.getHealthStatus()
    }

    pragma(command: string): void {
        this.connection.pragma(command)
    }

    getRelationshipHubs(limit: number): { entryId: number; content: string; totalLinks: number }[] {
        return this.relationshipsMgr.getRelationshipHubs(limit)
    }

    getOrphanCount(workspaceId?: string): number {
        return this.relationshipsMgr.getOrphanCount(workspaceId)
    }

    // ========================================================================
    // Vector Search Primitives
    // ========================================================================

    getVectorMetadata(key: string): string | undefined {
        return this.vectorOps.getVectorMetadata(key)
    }

    setVectorMetadata(key: string, value: string): void {
        this.vectorOps.setVectorMetadata(key, value)
    }

    createVecTable(dimensions: number): void {
        this.vectorOps.createVecTable(dimensions)
    }

    dropVecTable(): void {
        this.vectorOps.dropVecTable()
    }

    upsertVector(entryId: number, embedding: Float32Array): void {
        this.vectorOps.upsertVector(entryId, embedding)
    }

    upsertVectors(vectors: { entryId: number; embedding: Float32Array }[]): void {
        this.vectorOps.upsertVectors(vectors)
    }

    searchVectors(
        embedding: Float32Array,
        limit: number
    ): { entry_id: number; distance: number }[] {
        return this.vectorOps.searchVectors(embedding, limit)
    }

    getVector(entryId: number): Float32Array | null {
        return this.vectorOps.getVector(entryId)
    }

    deleteVector(entryId: number): void {
        this.vectorOps.deleteVector(entryId)
    }

    clearVectors(): void {
        this.vectorOps.clearVectors()
    }

    getVectorCount(): number {
        return this.vectorOps.getVectorCount()
    }

    cleanupStaleVectors(): number {
        return this.vectorOps.cleanupStaleVectors()
    }

    executeDataLifecycle(options: {
        archiveOlderThanDays: number
        pruneOlderThanDays: number
        hardDeleteOlderThanDays: number
        importanceThreshold: number
        dryRun?: boolean
        excludeTags?: string[]
    }): ReturnType<IDatabaseAdapter['executeDataLifecycle']> {
        return this.lifecycleOps.executeDataLifecycle(options)
    }

    executeInTransaction<T>(cb: () => T): T {
        return this.connection.getNativeDb().transaction(cb)()
    }

    getWorkflowActionEntries(limit: number): JournalEntry[] {
        return this.insightsOps.getWorkflowActionEntries(limit)
    }

    getSignificantEntries(limit: number, projectNumber?: number): JournalEntry[] {
        return this.insightsOps.getSignificantEntries(limit, projectNumber)
    }

    getRecentGraphRelationships(limit: number): {
        from_entry_id: number
        to_entry_id: number
        relationship_type: string
        from_content: string
        to_content: string
    }[] {
        return this.insightsOps.getRecentGraphRelationships(limit)
    }

    getAuthorStatistics(): { author: string; count: number }[] {
        return this.insightsOps.getAuthorStatistics()
    }

    getAuthorsForEntries(entryIds: number[]): Map<number, string | null> {
        return this.insightsOps.getAuthorsForEntries(entryIds)
    }

    saveAnalyticsSnapshot(type: string, data: Record<string, unknown>): number {
        return this.insightsOps.saveAnalyticsSnapshot(type, data)
    }

    getLatestAnalyticsSnapshot(
        type: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null {
        return this.insightsOps.getLatestAnalyticsSnapshot(type)
    }

    getAnalyticsSnapshots(
        type: string,
        limit?: number
    ): { id: number; createdAt: string; data: Record<string, unknown> }[] {
        return this.insightsOps.getAnalyticsSnapshots(type, limit)
    }

    computeDigest(): Record<string, unknown> {
        return this.insightsOps.computeDigest()
    }

    getCrossProjectInsights(options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
    }): ReturnType<IDatabaseAdapter['getCrossProjectInsights']> {
        return this.insightsOps.getCrossProjectInsights(options)
    }

    visualizeRelationships(options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
    }): ReturnType<IDatabaseAdapter['visualizeRelationships']> {
        return this.insightsOps.visualizeRelationships(options)
    }

    getTeamCollaborationMatrix(options: {
        period: string
        limit: number
    }): ReturnType<IDatabaseAdapter['getTeamCollaborationMatrix']> {
        return this.insightsOps.getTeamCollaborationMatrix(options)
    }
}
