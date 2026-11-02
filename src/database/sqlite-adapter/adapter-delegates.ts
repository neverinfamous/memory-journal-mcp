import type {
    JournalEntry,
    Tag,
    Relationship,
    RelationshipType,
    ToolHandlerConfig,
} from '../../types/index.js'
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
 * Base delegate layer for SQLite DatabaseAdapter:
 * Houses connection lifecycle, RBAC team members, author aliases, tags,
 * relationships, backups, health, lifecycle, vector operations, and insights.
 */
export class AdapterDelegates {
    protected connection: NativeConnectionManager
    protected tagsMgr: TagsManager
    protected entriesMgr: EntriesManager
    protected relationshipsMgr: RelationshipsManager
    protected backupMgr: BackupManager
    protected membersMgr: MembersManager
    protected aliasMgr: AliasManager
    protected healthOps: HealthOperations
    protected lifecycleOps: LifecycleOperations
    protected insightsOps: InsightsOperations
    protected vectorOps: VectorOperations

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

    pragma(command: string): void {
        this.connection.pragma(command)
    }

    executeInTransaction<T>(cb: () => T): T {
        return this.connection.getNativeDb().transaction(cb)()
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

    // Author Aliases (Level 2 Identity)

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

    // Tags & Relationships

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

    getRelationshipHubs(limit: number): { entryId: number; content: string; totalLinks: number }[] {
        return this.relationshipsMgr.getRelationshipHubs(limit)
    }

    getOrphanCount(workspaceId?: string): number {
        return this.relationshipsMgr.getOrphanCount(workspaceId)
    }

    // Backups & Health

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

    // Vector Search Primitives

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

    // Insights & Analytics

    getWorkflowActionEntries(limit: number, workspaceId?: string): JournalEntry[] {
        return this.insightsOps.getWorkflowActionEntries(limit, workspaceId)
    }

    getSignificantEntries(
        limit: number,
        projectNumber?: number,
        workspaceId?: string
    ): JournalEntry[] {
        return this.insightsOps.getSignificantEntries(limit, projectNumber, workspaceId)
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

    getAuthorStatistics(workspaceId?: string): { author: string; count: number }[] {
        return this.insightsOps.getAuthorStatistics(workspaceId)
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

    computeDigest(workspaceId?: string): Record<string, unknown> {
        return this.insightsOps.computeDigest(workspaceId)
    }

    getCrossProjectInsights(options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
        workspaceId?: string
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
