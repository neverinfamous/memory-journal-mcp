import type {
    JournalEntry,
    Relationship,
    RelationshipType,
} from '../../types/index.js'
import type { IDatabaseAdapter } from '../core/interfaces.js'
import type { ActiveThreadRow, RecentLinkageStats, RecentNeighborhood } from './graph-pivots.js'
import type { DigestSnapshot } from './entries/digest.js'
import { AdapterBaseDelegates } from './adapter-base-delegates.js'

/**
 * Extended delegate layer for SQLite DatabaseAdapter:
 * Houses relationships, backups, health, lifecycle, vector operations, and insights.
 */
export class AdapterDelegates extends AdapterBaseDelegates {

    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string,
        workspaceId?: string
    ): Relationship {
        return this.relationshipsMgr.linkEntries(
            fromEntryId,
            toEntryId,
            relationshipType,
            description,
            workspaceId
        )
    }

    getRelationships(entryId: number, workspaceId?: string): Relationship[] {
        return this.relationshipsMgr.getRelationships(entryId, workspaceId)
    }

    getRelationshipsForEntries(
        entryIds: number[],
        workspaceId?: string
    ): Map<number, Relationship[]> {
        return this.relationshipsMgr.getRelationshipsForEntries(entryIds, workspaceId)
    }

    getRelationshipHubs(
        limit: number,
        workspaceId?: string
    ): { entryId: number; content: string; totalLinks: number }[] {
        return this.relationshipsMgr.getRelationshipHubs(limit, workspaceId)
    }

    getOrphanCount(workspaceId?: string): number {
        return this.relationshipsMgr.getOrphanCount(workspaceId)
    }

    getRelationshipDegrees(entryIds: readonly number[], workspaceId?: string): Map<number, number> {
        return this.relationshipsMgr.getRelationshipDegrees(entryIds, workspaceId)
    }

    getActiveThreads(sinceIso: string, limit: number, workspaceId?: string): ActiveThreadRow[] {
        return this.relationshipsMgr.getActiveThreads(sinceIso, limit, workspaceId)
    }

    getRecentLinkageStats(sinceIso: string, workspaceId?: string): RecentLinkageStats {
        return this.relationshipsMgr.getRecentLinkageStats(sinceIso, workspaceId)
    }

    getEntryIdsByCommitShas(shas: readonly string[], workspaceId?: string): Map<string, number> {
        return this.relationshipsMgr.getEntryIdsByCommitShas(shas, workspaceId)
    }

    getRecentNeighborhood(sinceIso: string, edgeLimit: number, workspaceId?: string): RecentNeighborhood {
        return this.relationshipsMgr.getRecentNeighborhood(sinceIso, edgeLimit, workspaceId)
    }

    getEntriesSharingAnchors(
        entryId: number,
        sinceIso: string,
        limit: number,
        workspaceId?: string,
        projectNumber?: number
    ): { entryId: number; entryType: string; content: string; sharedAnchors: number }[] {
        return this.relationshipsMgr.getEntriesSharingAnchors(
            entryId,
            sinceIso,
            limit,
            workspaceId,
            projectNumber
        )
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

    deleteOldBackups(keepCount: number): { deleted: string[]; failed?: string[]; kept: number } {
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
        try {
            return await this.backupMgr.restoreFromFile(filename, runtime)
        } finally {
            this.membersMgr.invalidateCache()
        }
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
        limit: number,
        workspaceId?: string,
        projectNumber?: number
    ): { entry_id: number; distance: number }[] {
        return this.vectorOps.searchVectors(embedding, limit, workspaceId, projectNumber)
    }

    getVector(entryId: number): Float32Array | null {
        return this.vectorOps.getVector(entryId)
    }

    getExistingVectorIds(entryIds: number[]): Set<number> {
        return this.vectorOps.getExistingVectorIds(entryIds)
    }

    deleteVector(entryId: number): boolean {
        return this.vectorOps.deleteVector(entryId)
    }

    deleteVectors(entryIds: number[]): number {
        return this.vectorOps.deleteVectors(entryIds)
    }

    hasVectors(): boolean {
        return this.vectorOps.hasVectors()
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
        workspaceId?: string
        projectNumber?: number
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

    getRecentGraphRelationships(
        limit: number,
        workspaceId?: string
    ): {
        from_entry_id: number
        to_entry_id: number
        relationship_type: string
        from_content: string
        to_content: string
    }[] {
        return this.insightsOps.getRecentGraphRelationships(limit, workspaceId)
    }

    getAuthorStatistics(workspaceId?: string, projectNumber?: number): { author: string; count: number }[] {
        return this.insightsOps.getAuthorStatistics(workspaceId, projectNumber)
    }

    getAuthorsForEntries(entryIds: number[]): Map<number, string | null> {
        return this.insightsOps.getAuthorsForEntries(entryIds)
    }

    saveAnalyticsSnapshot(
        type: string,
        data: DigestSnapshot | Record<string, unknown>,
        workspaceId?: string
    ): number {
        return this.insightsOps.saveAnalyticsSnapshot(type, data, workspaceId)
    }

    getLatestAnalyticsSnapshot(
        type: string,
        workspaceId?: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null {
        return this.insightsOps.getLatestAnalyticsSnapshot(type, workspaceId)
    }

    getAnalyticsSnapshots(
        type: string,
        limit?: number,
        workspaceId?: string
    ): { id: number; createdAt: string; data: Record<string, unknown> }[] {
        return this.insightsOps.getAnalyticsSnapshots(type, limit, workspaceId)
    }

    computeDigest(workspaceId?: string): DigestSnapshot {
        return this.insightsOps.computeDigest(workspaceId)
    }

    getCrossProjectInsights(options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
        workspaceId?: string
        projectNumber?: number
    }): ReturnType<IDatabaseAdapter['getCrossProjectInsights']> {
        return this.insightsOps.getCrossProjectInsights(options)
    }

    visualizeRelationships(options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
        workspaceId?: string
        projectNumber?: number
    }): ReturnType<IDatabaseAdapter['visualizeRelationships']> {
        return this.insightsOps.visualizeRelationships(options)
    }

    getTeamCollaborationMatrix(options: {
        period: string
        limit: number
        workspaceId?: string
        projectNumber?: number
    }): ReturnType<IDatabaseAdapter['getTeamCollaborationMatrix']> {
        return this.insightsOps.getTeamCollaborationMatrix(options)
    }
}
