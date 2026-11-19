import type { JournalEntry } from '../../types/index.js'
import type { DigestSnapshot } from '../sqlite-adapter/entries/digest.js'
import type {
    ActiveThreadRow,
    RecentLinkageStats,
    RecentNeighborhood,
} from '../sqlite-adapter/graph-pivots.js'

export interface VectorSearchRow {
    entry_id: number
    distance: number
}

export interface SearchVectorsOptions {
    workspaceId?: string
    projectNumber?: number
}

export interface CrossProjectInsightsOptions {
    startDate?: string
    endDate?: string
    minEntries: number
    inactiveThresholdDays: number
    workspaceId?: string
    projectNumber?: number
}

export interface CrossProjectInsightsResult {
    projects: Record<string, unknown>[]
    inactiveProjects: { project_number: number; last_entry_date: string }[]
}

export interface VisualizeRelationshipsOptions {
    entryId?: number
    tags?: string[]
    relationshipType?: string
    depth: number
    limit: number
    workspaceId?: string
    projectNumber?: number
}

export interface VisualizeRelationshipsResult {
    nodes: {
        id: string | number
        label: string
        group: string
        metadata?: Record<string, unknown>
    }[]
    edges: { from: string | number; to: string | number; label: string; type: string }[]
}

export interface TeamCollaborationMatrixOptions {
    period: string
    limit: number
    workspaceId?: string
    projectNumber?: number
}

export interface TeamCollaborationMatrixResult {
    totalAuthors: number
    totalEntries: number
    authorActivity: { author: string; period: string; entryCount: number }[]
    crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
    impactFactor: { author: string; inboundLinks: number }[]
}

export interface RecentGraphRelationshipRow {
    from_entry_id: number
    to_entry_id: number
    relationship_type: string
    from_content: string
    to_content: string
}

export interface BackupExportResult {
    filename: string
    path: string
    sizeBytes: number
}

export interface BackupFileInfo {
    filename: string
    path: string
    sizeBytes: number
    createdAt: string
}

export interface DeleteOldBackupsResult {
    deleted: string[]
    failed?: string[]
    kept: number
}

export interface RestoreBackupResult {
    restoredFrom: string
    previousEntryCount: number
    newEntryCount: number
}

export interface DatabaseHealthStatus {
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

export interface DataLifecycleOptions {
    archiveOlderThanDays: number
    pruneOlderThanDays: number
    hardDeleteOlderThanDays: number
    importanceThreshold: number
    dryRun?: boolean
    excludeTags?: string[]
    workspaceId?: string
    projectNumber?: number
}

export interface DataLifecycleResult {
    archivedCount: number
    prunedCount: number
    hardDeletedCount: number
    candidates?: {
        archived: { id: number; importance_score: number }[]
        pruned: { id: number; importance_score: number }[]
        hardDeleted: { id: number; age_days: number }[]
    }
}

export interface RelationshipHubRow {
    entryId: number
    content: string
    totalLinks: number
}

/**
 * Backup, analytics, relationship-graph, vector, and lifecycle methods of IDatabaseAdapter.
 */
export interface IDatabaseVectorAndAdminAdapter {
    // Backup Manager
    getBackupsDir(): string
    exportToFile(backupName?: string): Promise<BackupExportResult>
    listBackups(): BackupFileInfo[]
    deleteOldBackups(keepCount: number): DeleteOldBackupsResult
    restoreFromFile(filename: string, runtime?: unknown): Promise<RestoreBackupResult>
    getHealthStatus(): DatabaseHealthStatus

    // Analytics Snapshots
    saveAnalyticsSnapshot(
        type: string,
        data: DigestSnapshot | Record<string, unknown>,
        workspaceId?: string
    ): number
    getLatestAnalyticsSnapshot(
        type: string,
        workspaceId?: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null
    getAnalyticsSnapshots(
        type: string,
        limit?: number,
        workspaceId?: string
    ): { id: number; createdAt: string; data: Record<string, unknown> }[]
    computeDigest(workspaceId?: string): DigestSnapshot

    pragma(command: string): void

    // Advanced Analytic and Relationship queries
    getCrossProjectInsights(options: CrossProjectInsightsOptions): CrossProjectInsightsResult
    visualizeRelationships(options: VisualizeRelationshipsOptions): VisualizeRelationshipsResult
    getTeamCollaborationMatrix(options: TeamCollaborationMatrixOptions): TeamCollaborationMatrixResult
    getWorkflowActionEntries(limit: number, workspaceId?: string): JournalEntry[]
    getSignificantEntries(limit: number, projectNumber?: number, workspaceId?: string): JournalEntry[]
    getRecentGraphRelationships(limit: number, workspaceId?: string): RecentGraphRelationshipRow[]

    // Vector Search Primitives
    getVectorMetadata(key: string): string | undefined
    setVectorMetadata(key: string, value: string): void
    createVecTable(dimensions: number): void
    dropVecTable(): void
    upsertVector(entryId: number, embedding: Float32Array): void
    upsertVectors(vectors: { entryId: number; embedding: Float32Array }[]): void
    searchVectors(
        embedding: Float32Array,
        limit: number,
        workspaceId?: string,
        projectNumber?: number
    ): VectorSearchRow[]
    getVector(entryId: number): Float32Array | null
    getExistingVectorIds?(entryIds: number[]): Set<number>
    deleteVector(entryId: number): boolean
    deleteVectors?(entryIds: number[]): number
    hasVectors?(): boolean
    clearVectors(): void
    getVectorCount(): number
    cleanupStaleVectors(): void

    // Auto-Prune
    executeDataLifecycle(options: DataLifecycleOptions): DataLifecycleResult
    executeInTransaction<T>(cb: () => T): T
    getRelationshipHubs(limit: number, workspaceId?: string): RelationshipHubRow[]
    getOrphanCount(workspaceId?: string): number
    // Graph pivots (optional so lightweight adapters/mocks degrade gracefully)
    getRelationshipDegrees?(entryIds: readonly number[], workspaceId?: string): Map<number, number>
    getActiveThreads?(sinceIso: string, limit: number, workspaceId?: string): ActiveThreadRow[]
    getRecentLinkageStats?(sinceIso: string, workspaceId?: string): RecentLinkageStats
    getEntryIdsByCommitShas?(shas: readonly string[], workspaceId?: string): Map<string, number>
    getRecentNeighborhood?(sinceIso: string, edgeLimit: number, workspaceId?: string): RecentNeighborhood
    /** Entries written under one agent session (newest first) — used for post-compaction recovery. */
    getEntriesBySession?(sessionId: string, limit?: number, workspaceId?: string): JournalEntry[]
    /** Recent entries sharing file/symbol anchors with `entryId` (write-time link suggestions). */
    getEntriesSharingAnchors?(
        entryId: number,
        sinceIso: string,
        limit: number,
        workspaceId?: string
    ): { entryId: number; entryType: string; content: string; sharedAnchors: number }[]
}
