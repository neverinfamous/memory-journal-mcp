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

    getEntryById(id: number): JournalEntry | null {
        return this.entriesMgr.getEntryById(id)
    }

    getEntryHistory(id: number): EntryRevision[] {
        return this.entriesMgr.getEntryHistory(id)
    }

    getEntryByIdIncludeDeleted(id: number): JournalEntry | null {
        return this.entriesMgr.getEntryByIdIncludeDeleted(id)
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
        includeArchived?: boolean
    ): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getRecentEntries(limit ?? 10, isPersonal, sortBy, cursor, includeArchived)
    }

    getEntriesPage(offset: number, limit: number): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getEntriesPage(offset, limit)
    }

    getActiveEntryCount(): number {
        return this.entriesMgr.getActiveEntryCount()
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

    addTeamMember(author: string, role: TeamRole, addedBy?: string, displayName?: string): TeamMember {
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

    getDeletedEntries(options?: { limit?: number; offset?: number }): { entries: JournalEntry[]; count: number } {
        return this.entriesMgr.getDeletedEntries(options)
    }

    createEntries(inputs: CreateEntryInput[]): { created: JournalEntry[]; errors: { index: number; error: Error }[] } {
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
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return this.entriesMgr.updateEntries(updates)
    }

    deleteEntries(ids: number[], permanent = false): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        // deleteEntries now manages its own per-item error capturing internally.
        // But we still wrap the overall process in a transaction to handle the vector deletion.
        return this.executeInTransaction(() => {
            const result = this.entriesMgr.deleteEntries(ids, permanent)
            for (const id of result.deleted) {
                try {
                    this.deleteVector(id)
                } catch {
                    // Vectors failure shouldn't fail the entry deletion, but we could record it
                    // Actually, if it throws, the transaction rolls back, breaking partial success.
                    // Let's catch it.
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
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean; highlights?: { id: number; snippet: string }[]; suggestions?: string[]; correctedQuery?: string } {
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
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean } {
        return this.entriesMgr.searchByDateRange(startDate, endDate, options)
    }

    getStatistics(
        groupBy?: 'day' | 'week' | 'month',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean
    ): ReturnType<EntriesManager['getStatistics']> {
        return this.entriesMgr.getStatistics(groupBy, startDate, endDate, projectBreakdown)
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
        return this.connection.getVectorMetadata(key)
    }

    setVectorMetadata(key: string, value: string): void {
        this.connection.setVectorMetadata(key, value)
    }

    createVecTable(dimensions: number): void {
        this.connection.createVecTable(dimensions)
    }

    dropVecTable(): void {
        this.connection.dropVecTable()
    }

    upsertVector(entryId: number, embedding: Float32Array): void {
        const bigId = BigInt(entryId)
        const db = this.connection.getNativeDb()
        db.prepare('DELETE FROM vec_embeddings WHERE entry_id = ?').run(bigId)
        db.prepare('INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)').run(
            bigId,
            embedding
        )
    }

    upsertVectors(vectors: { entryId: number; embedding: Float32Array }[]): void {
        const db = this.connection.getNativeDb()
        const deleteStmt = db.prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
        const insertStmt = db.prepare(
            'INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)'
        )

        db.transaction(() => {
            for (const vec of vectors) {
                const bigId = BigInt(vec.entryId)
                deleteStmt.run(bigId)
                insertStmt.run(bigId, vec.embedding)
            }
        })()
    }

    searchVectors(
        embedding: Float32Array,
        limit: number
    ): { entry_id: number; distance: number }[] {
        const db = this.connection.getNativeDb()
        return db
            .prepare(
                `SELECT v.entry_id, v.distance 
                 FROM vec_embeddings v
                 LEFT JOIN memory_journal mj ON v.entry_id = mj.id
                 WHERE v.embedding MATCH ? AND v.k = ? AND mj.deleted_at IS NULL 
                 ORDER BY v.distance LIMIT ?`
            )
            .all(embedding, limit * 4, limit) as { entry_id: number; distance: number }[]
    }

    getVector(entryId: number): Float32Array | null {
        try {
            const db = this.connection.getNativeDb()
            const row = db
                .prepare('SELECT embedding FROM vec_embeddings WHERE entry_id = ?')
                .get(BigInt(entryId)) as { embedding: Buffer } | undefined
            if (!row) return null
            return new Float32Array(row.embedding.buffer, row.embedding.byteOffset)
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return null
            }
            throw error
        }
    }

    deleteVector(entryId: number): void {
        try {
            this.connection
                .getNativeDb()
                .prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
                .run(BigInt(entryId))
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return
            }
            throw error
        }
    }

    clearVectors(): void {
        try {
            this.connection.getNativeDb().prepare('DELETE FROM vec_embeddings').run()
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return
            }
            throw error
        }
    }

    getVectorCount(): number {
        try {
            const row = this.connection
                .getNativeDb()
                .prepare('SELECT COUNT(*) as count FROM vec_embeddings')
                .get() as { count: number } | undefined
            return row?.count ?? 0
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return 0
            }
            throw error
        }
    }

    cleanupStaleVectors(): number {
        try {
            const db = this.connection.getNativeDb()
            const result = db
                .prepare(
                    'DELETE FROM vec_embeddings WHERE entry_id NOT IN (SELECT id FROM memory_journal WHERE deleted_at IS NULL)'
                )
                .run()
            return result.changes
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return 0
            }
            throw error
        }
    }

    executeDataLifecycle(options: { archiveOlderThanDays: number; pruneOlderThanDays: number; hardDeleteOlderThanDays: number; importanceThreshold: number; dryRun?: boolean; excludeTags?: string[]; }): ReturnType<IDatabaseAdapter["executeDataLifecycle"]> {
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

    getCrossProjectInsights(options:  { startDate?: string; endDate?: string; minEntries: number; inactiveThresholdDays: number; }): ReturnType<IDatabaseAdapter["getCrossProjectInsights"]> {
        return this.insightsOps.getCrossProjectInsights(options)
    }

    visualizeRelationships(options:  { entryId?: number; tags?: string[]; relationshipType?: string; depth: number; limit: number; }): ReturnType<IDatabaseAdapter["visualizeRelationships"]> {
        return this.insightsOps.visualizeRelationships(options)
    }

    getTeamCollaborationMatrix(options:  { period: string; limit: number; }): ReturnType<IDatabaseAdapter["getTeamCollaborationMatrix"]> {
        return this.insightsOps.getTeamCollaborationMatrix(options)
    }
}
