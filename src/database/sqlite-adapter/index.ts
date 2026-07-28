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
    ToolHandlerConfig
} from '../../types/index.js'
import type { CreateEntryInput } from '../core/schema.js'
import type {
    IDatabaseAdapter,
    QueryResult,
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
import {
    saveAnalyticsSnapshot as saveSnapshot,
    getLatestAnalyticsSnapshot as getLatestSnapshot,
    getAnalyticsSnapshots as getSnapshots,
    computeDigest,
} from './entries/digest.js'
import { buildImportanceCte, buildImportanceSqlExpression } from './entries/importance.js'

import * as fs from 'node:fs'

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
    private config?: ToolHandlerConfig

    constructor(dbPath: string, config?: ToolHandlerConfig) {
        this.config = config
        this.connection = new NativeConnectionManager(dbPath)
        this.tagsMgr = new TagsManager(this.connection)
        this.entriesMgr = new EntriesManager(this.connection, this.tagsMgr, this.config)
        this.relationshipsMgr = new RelationshipsManager(this.connection, this.entriesMgr)
        this.backupMgr = new BackupManager(this.connection)
        this.membersMgr = new MembersManager(this.connection)
        this.aliasMgr = new AliasManager(this.connection)
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
        workspaceId?: string
    ): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getRecentEntries(limit ?? 10, isPersonal, sortBy, cursor, includeArchived, workspaceId)
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
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
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
            workspaceId?: string
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
        return this.entriesMgr.getStatistics(groupBy, startDate, endDate, projectBreakdown, workspaceId)
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
        // Safe query execution through the connection interface
        const dbPath = this.connection.getDbPath()

        let sizeBytes = 0
        try {
            const stats = fs.statSync(dbPath)
            sizeBytes = stats.size
        } catch {
            // File may not exist on disk yet
        }

        // Combined health counts in a single query (batch instead of 4 serial queries)
        const countsResult = this.connection.exec(`
            SELECT
                (SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL) AS entry_count,
                (SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NOT NULL) AS deleted_count,
                (SELECT COUNT(*) FROM relationships) AS rel_count,
                (SELECT COUNT(*) FROM tags) AS tag_count
        `)

        const row = countsResult[0]?.values[0]
        const entryCount = (row?.[0] as number) ?? 0
        const deletedEntryCount = (row?.[1] as number) ?? 0
        const relationshipCount = (row?.[2] as number) ?? 0
        const tagCount = (row?.[3] as number) ?? 0

        const backups = this.listBackups()
        const lastBackup = backups[0] ?? null

        return {
            database: {
                path: dbPath,
                sizeBytes,
                entryCount,
                deletedEntryCount,
                relationshipCount,
                tagCount,
            },
            backups: {
                directory: this.getBackupsDir(),
                count: backups.length,
                lastBackup: lastBackup
                    ? {
                          filename: lastBackup.filename,
                          createdAt: lastBackup.createdAt,
                          sizeBytes: lastBackup.sizeBytes,
                      }
                    : null,
            },
        }
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
    } {
        const db = this.connection.getNativeDb()
        const cte = buildImportanceCte()
        const importanceExpr = buildImportanceSqlExpression()
        const deletedAt = new Date().toISOString()
        
        let excludeTagsSql = ''
        const params: unknown[] = []
        const excludeTags = options.excludeTags ?? []
        
        if (excludeTags.length > 0) {
            const placeholders = excludeTags.map(() => '?').join(',')
            excludeTagsSql = `AND e.id NOT IN (
                SELECT entry_id FROM entry_tags 
                JOIN tags ON tags.id = entry_tags.tag_id 
                WHERE tags.name IN (${placeholders})
            )`
            params.push(...excludeTags)
        }

        // --- Candidates Generation ---
        
        const hardDeleteSelect = `
            SELECT id, CAST((julianday('now') - julianday(deleted_at)) AS INTEGER) as age_days
            FROM memory_journal
            WHERE deleted_at IS NOT NULL
              AND julianday('now') - julianday(deleted_at) > ${String(options.hardDeleteOlderThanDays)}
        `

        const pruneSelect = `
            SELECT e.id, ${importanceExpr} as importance_score
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL
              AND julianday('now') - julianday(e.timestamp) > ${String(options.pruneOlderThanDays)}
              AND ${importanceExpr} < ${String(options.importanceThreshold)}
              ${excludeTagsSql}
        `

        const archiveSelect = `
            SELECT e.id, ${importanceExpr} as importance_score
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL AND e.is_archived = 0
              AND julianday('now') - julianday(e.timestamp) > ${String(options.archiveOlderThanDays)}
              AND ${importanceExpr} < ${String(options.importanceThreshold)}
              ${excludeTagsSql}
        `

        let archivedCount = 0
        let prunedCount = 0
        let hardDeletedCount = 0
        const candidates = {
            archived: [] as { id: number, importance_score: number }[],
            pruned: [] as { id: number, importance_score: number }[],
            hardDeleted: [] as { id: number, age_days: number }[]
        }

        if (options.dryRun) {
            if (options.hardDeleteOlderThanDays > 0) {
                const rows = db.prepare(hardDeleteSelect).all() as { id: number | bigint, age_days: number }[]
                candidates.hardDeleted = rows.map(r => ({
                    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
                    age_days: r.age_days
                }))
            }
            if (options.pruneOlderThanDays > 0) {
                const sql = `WITH ${cte} ${pruneSelect}`
                const rows = db.prepare(sql).all(...params) as { id: number | bigint, importance_score: number }[]
                candidates.pruned = rows.map(r => ({
                    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
                    importance_score: r.importance_score
                }))
            }
            if (options.archiveOlderThanDays > 0) {
                const sql = `WITH ${cte} ${archiveSelect}`
                const rows = db.prepare(sql).all(...params) as { id: number | bigint, importance_score: number }[]
                candidates.archived = rows.map(r => ({
                    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
                    importance_score: r.importance_score
                }))
                const prunedIds = new Set(candidates.pruned.map(c => c.id))
                candidates.archived = candidates.archived.filter(c => !prunedIds.has(c.id))
            }

            return { archivedCount: 0, prunedCount: 0, hardDeletedCount: 0, candidates }
        }

        db.transaction(() => {
            if (options.hardDeleteOlderThanDays > 0) {
                const rows = db.prepare(hardDeleteSelect).all() as { id: number | bigint }[]
                const ids = rows.map(r => typeof r.id === 'bigint' ? Number(r.id) : r.id)
                if (ids.length > 0) {
                    const placeholders = ids.map(() => '?').join(',')
                    const deleteSql = `DELETE FROM memory_journal WHERE id IN (${placeholders})`
                    const result = db.prepare(deleteSql).run(...ids)
                    hardDeletedCount = result.changes
                    
                    try {
                        db.prepare(`DELETE FROM vec_embeddings WHERE entry_id IN (${placeholders})`).run(...ids)
                    } catch {
                        // ignore vector cleanup error if table doesn't exist
                    }
                }
            }

            if (options.pruneOlderThanDays > 0) {
                const sql = `
                    WITH ${cte}
                    UPDATE memory_journal
                    SET deleted_at = ?
                    WHERE id IN (
                        SELECT id FROM (${pruneSelect})
                    )
                `
                const result = db.prepare(sql).run(deletedAt, ...params)
                prunedCount = result.changes
            }

            if (options.archiveOlderThanDays > 0) {
                const sql = `
                    WITH ${cte}
                    UPDATE memory_journal
                    SET is_archived = 1
                    WHERE id IN (
                        SELECT id FROM (${archiveSelect})
                    )
                `
                const result = db.prepare(sql).run(...params)
                archivedCount = result.changes
            }
        })()

        return { archivedCount, prunedCount, hardDeletedCount }
    }

    executeInTransaction<T>(cb: () => T): T {
        return this.connection.getNativeDb().transaction(cb)()
    }

    getWorkflowActionEntries(limit: number): JournalEntry[] {
        const rows = this.connection.exec(
            `
            SELECT * FROM memory_journal
            WHERE workflow_run_id IS NOT NULL AND deleted_at IS NULL
            ORDER BY timestamp DESC
            LIMIT ?
        `,
            [limit]
        )

        if (!rows[0] || rows[0].values.length === 0) return []

        const cols = rows[0].columns
        const entryIds = rows[0].values.map((row) => row[cols.indexOf('id')] as number)
        const tagsMap = new Map<number, string[]>()

        if (entryIds.length > 0) {
            const placeholders = entryIds.map(() => '?').join(',')
            const tagRows = this.connection.exec(
                `SELECT entry_tags.entry_id, tags.name as tag FROM entry_tags JOIN tags ON entry_tags.tag_id = tags.id WHERE entry_tags.entry_id IN (${placeholders})`,
                entryIds
            )
            if (tagRows[0] && tagRows[0].values.length > 0) {
                const tagCols = tagRows[0].columns
                const entryIdIdx = tagCols.indexOf('entry_id')
                const tagIdx = tagCols.indexOf('tag')
                for (const row of tagRows[0].values) {
                    const eId = row[entryIdIdx] as number
                    const tag = row[tagIdx] as string
                    const list = tagsMap.get(eId) ?? []
                    list.push(tag)
                    tagsMap.set(eId, list)
                }
            }
        }

        return rows[0].values.map((row: unknown[]): JournalEntry => {
            const getVal = (idx: number): unknown => row[idx]
            const id = getVal(cols.indexOf('id')) as number
            return {
                id,
                entryType: getVal(cols.indexOf('entry_type')) as EntryType,
                content: getVal(cols.indexOf('content')) as string,
                timestamp: getVal(cols.indexOf('timestamp')) as string,
                tags: tagsMap.get(id) ?? [],
                isPersonal: Boolean(getVal(cols.indexOf('is_personal'))),
                projectNumber: getVal(cols.indexOf('project_number')) as number | undefined,
                issueNumber: getVal(cols.indexOf('issue_number')) as number | undefined,
                prNumber: getVal(cols.indexOf('pr_number')) as number | undefined,
                prStatus: getVal(cols.indexOf('pr_status')) as string | undefined,
                workflowRunId: getVal(cols.indexOf('workflow_run_id')) as number | undefined,
                workflowName: getVal(cols.indexOf('workflow_name')) as string | undefined,
                workflowStatus: getVal(cols.indexOf('workflow_status')) as string | undefined,
                significanceType: getVal(cols.indexOf('significance_type')) as string | undefined,
                autoContext: getVal(cols.indexOf('auto_context')) as string | undefined,
            } as JournalEntry
        })
    }

    getSignificantEntries(limit: number, projectNumber?: number): JournalEntry[] {
        let sql = `
            SELECT * FROM memory_journal
            WHERE significance_type IS NOT NULL AND deleted_at IS NULL
        `
        const params: unknown[] = []
        if (projectNumber !== undefined) {
            sql += ` AND project_number = ?`
            params.push(projectNumber)
        }
        sql += ` ORDER BY timestamp DESC LIMIT ?`
        params.push(limit)

        const rows = this.connection.exec(sql, params)

        if (!rows[0] || rows[0].values.length === 0) return []

        const cols = rows[0].columns
        const entryIds = rows[0].values.map((row) => row[cols.indexOf('id')] as number)
        const tagsMap = new Map<number, string[]>()

        if (entryIds.length > 0) {
            const placeholders = entryIds.map(() => '?').join(',')
            const tagRows = this.connection.exec(
                `SELECT entry_tags.entry_id, tags.name as tag FROM entry_tags JOIN tags ON entry_tags.tag_id = tags.id WHERE entry_tags.entry_id IN (${placeholders})`,
                entryIds
            )
            if (tagRows[0] && tagRows[0].values.length > 0) {
                const tagCols = tagRows[0].columns
                const entryIdIdx = tagCols.indexOf('entry_id')
                const tagIdx = tagCols.indexOf('tag')
                for (const row of tagRows[0].values) {
                    const eId = row[entryIdIdx] as number
                    const tag = row[tagIdx] as string
                    const list = tagsMap.get(eId) ?? []
                    list.push(tag)
                    tagsMap.set(eId, list)
                }
            }
        }

        return rows[0].values.map((row: unknown[]): JournalEntry => {
            const getVal = (idx: number): unknown => row[idx]
            const id = getVal(cols.indexOf('id')) as number
            return {
                id,
                entryType: getVal(cols.indexOf('entry_type')) as EntryType,
                content: getVal(cols.indexOf('content')) as string,
                timestamp: getVal(cols.indexOf('timestamp')) as string,
                tags: tagsMap.get(id) ?? [],
                isPersonal: Boolean(getVal(cols.indexOf('is_personal'))),
                projectNumber: getVal(cols.indexOf('project_number')) as number | undefined,
                issueNumber: getVal(cols.indexOf('issue_number')) as number | undefined,
                prNumber: getVal(cols.indexOf('pr_number')) as number | undefined,
                significanceType: getVal(cols.indexOf('significance_type')) as string | undefined,
            } as JournalEntry
        })
    }

    getRecentGraphRelationships(limit: number): {
        from_entry_id: number
        to_entry_id: number
        relationship_type: string
        from_content: string
        to_content: string
    }[] {
        const rows = this.connection.exec(
            `
            SELECT
                r.from_entry_id, r.to_entry_id, r.relationship_type,
                e1.content as from_content,
                e2.content as to_content
            FROM relationships r
            JOIN memory_journal e1 ON r.from_entry_id = e1.id
            JOIN memory_journal e2 ON r.to_entry_id = e2.id
            WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL
            ORDER BY r.created_at DESC
            LIMIT ?
        `,
            [limit]
        )

        if (!rows[0] || rows[0].values.length === 0) return []

        const cols = rows[0].columns
        return rows[0].values.map((row) => ({
            from_entry_id: row[cols.indexOf('from_entry_id')] as number,
            to_entry_id: row[cols.indexOf('to_entry_id')] as number,
            relationship_type: row[cols.indexOf('relationship_type')] as string,
            from_content: row[cols.indexOf('from_content')] as string,
            to_content: row[cols.indexOf('to_content')] as string,
        }))
    }

    getAuthorStatistics(): { author: string; count: number }[] {
        let authors: { author: string; count: number }[] = []
        try {
            const authorResult = this.connection.exec(
                `SELECT COALESCE(aa.canonical_author, mj.author, 'unknown') as author, COUNT(*) as count
                 FROM memory_journal mj
                 LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias)
                 WHERE mj.deleted_at IS NULL
                 GROUP BY COALESCE(aa.canonical_author, mj.author, 'unknown')
                 ORDER BY count DESC`
            )
            if (authorResult[0]) {
                authors = authorResult[0].values.map((row: unknown[]) => ({
                    author: row[0] as string,
                    count: row[1] as number,
                }))
            }
        } catch {
            // Author column may not exist yet
        }
        return authors
    }

    getAuthorsForEntries(entryIds: number[]): Map<number, string | null> {
        const authorMap = new Map<number, string | null>()
        if (entryIds.length === 0) return authorMap

        const placeholders = entryIds.map(() => '?').join(',')
        try {
            const authorResult = this.connection.exec(
                `SELECT mj.id, COALESCE(aa.canonical_author, mj.author) as author 
                 FROM memory_journal mj
                 LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias)
                 WHERE mj.id IN (${placeholders})`,
                entryIds
            )
            if (authorResult[0]) {
                authorResult[0].values.forEach((row: unknown[]) => {
                    authorMap.set(row[0] as number, row[1] as string | null)
                })
            }
        } catch {
            // Author column may not exist yet
        }
        return authorMap
    }

    saveAnalyticsSnapshot(type: string, data: Record<string, unknown>): number {
        return saveSnapshot(this.connection.getNativeDb(), type, data)
    }

    getLatestAnalyticsSnapshot(
        type: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null {
        return getLatestSnapshot(this.connection.getNativeDb(), type)
    }

    getAnalyticsSnapshots(
        type: string,
        limit?: number
    ): { id: number; createdAt: string; data: Record<string, unknown> }[] {
        return getSnapshots(this.connection.getNativeDb(), type, limit)
    }

    computeDigest(): Record<string, unknown> {
        return computeDigest(this.connection.getNativeDb()) as unknown as Record<string, unknown>
    }

    getCrossProjectInsights(options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
    }): {
        projects: Record<string, unknown>[]
        inactiveProjects: { project_number: number; last_entry_date: string }[]
    } {
        let where = 'WHERE deleted_at IS NULL AND project_number IS NOT NULL'
        const sqlParams: unknown[] = []

        if (options.startDate) {
            where += ' AND DATE(timestamp) >= DATE(?)'
            sqlParams.push(options.startDate)
        }
        if (options.endDate) {
            where += ' AND DATE(timestamp) <= DATE(?)'
            sqlParams.push(options.endDate)
        }

        const projectsResult = this.connection.exec(
            `
            SELECT project_number, COUNT(*) as entry_count,
                   MIN(DATE(timestamp)) as first_entry,
                   MAX(DATE(timestamp)) as last_entry,
                   COUNT(DISTINCT DATE(timestamp)) as active_days
            FROM memory_journal ${where}
            GROUP BY project_number
            HAVING entry_count >= ?
            ORDER BY entry_count DESC
            `,
            [...sqlParams, options.minEntries]
        )

        const projects: Record<string, unknown>[] = []
        if (projectsResult[0] && projectsResult[0].values.length > 0) {
            const columns = projectsResult[0].columns
            for (const row of projectsResult[0].values) {
                const obj: Record<string, unknown> = {}
                columns.forEach((col: string, i: number) => {
                    obj[col] = row[i]
                })
                projects.push(obj)
            }
        }

        if (projects.length > 0) {
            const projectNumbers = projects.map((p) => p['project_number'] as number)
            const placeholders = projectNumbers.map(() => '?').join(',')
            const tagsResult = this.connection.exec(
                `
                SELECT mj.project_number, t.name, COUNT(*) as count
                FROM memory_journal mj
                JOIN entry_tags et ON mj.id = et.entry_id
                JOIN tags t ON et.tag_id = t.id
                WHERE mj.deleted_at IS NULL AND mj.project_number IN (${placeholders})
                GROUP BY mj.project_number, t.name
                ORDER BY count DESC
                `,
                projectNumbers
            )
            const tagMap = new Map<number, { name: string; count: number }[]>()
            if (tagsResult[0]) {
                for (const row of tagsResult[0].values) {
                    const pNum = row[0] as number
                    const list = tagMap.get(pNum) ?? []
                    list.push({ name: row[1] as string, count: row[2] as number })
                    tagMap.set(pNum, list)
                }
            }
            for (const p of projects) {
                p['top_tags'] = (tagMap.get(p['project_number'] as number) ?? []).slice(0, 5)
            }
        } else {
            for (const p of projects) {
                p['top_tags'] = []
            }
        }

        const msPerDay = 86_400_000
        const cutoffDate = new Date(Date.now() - options.inactiveThresholdDays * msPerDay)
            .toISOString()
            .split('T')[0]

        const inactiveResult = this.connection.exec(
            `
            SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
            FROM memory_journal
            WHERE deleted_at IS NULL AND project_number IS NOT NULL
            GROUP BY project_number
            HAVING last_entry_date < ?
            `,
            [cutoffDate]
        )

        const inactiveProjects: { project_number: number; last_entry_date: string }[] = []
        if (inactiveResult[0]) {
            for (const row of inactiveResult[0].values) {
                inactiveProjects.push({
                    project_number: row[0] as number,
                    last_entry_date: row[1] as string,
                })
            }
        }

        return { projects, inactiveProjects }
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
    } {
        let entriesResult: QueryResult[]

        if (options.entryId !== undefined) {
            entriesResult = this.connection.exec(
                `
                WITH RECURSIVE connected_entries(id, distance) AS (
                    SELECT id, 0 FROM memory_journal WHERE id = ? AND deleted_at IS NULL
                    UNION
                    SELECT DISTINCT
                        CASE
                            WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                            ELSE r.from_entry_id
                        END,
                        ce.distance + 1
                    FROM connected_entries ce
                    JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
                    WHERE ce.distance < ?
                )
                SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                FROM memory_journal mj
                JOIN connected_entries ce ON mj.id = ce.id
                WHERE mj.deleted_at IS NULL
                LIMIT ?
            `,
                [options.entryId, options.depth, options.limit]
            )
        } else if (options.tags && options.tags.length > 0) {
            const placeholders = options.tags.map(() => '?').join(',')
            entriesResult = this.connection.exec(
                `
                SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                FROM memory_journal mj
                WHERE mj.deleted_at IS NULL
                  AND mj.id IN (
                      SELECT et.entry_id FROM entry_tags et
                      JOIN tags t ON et.tag_id = t.id
                      WHERE t.name IN (${placeholders})
                  )
                LIMIT ?
            `,
                [...options.tags, options.limit]
            )
        } else {
            entriesResult = this.connection.exec(
                `
                SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                FROM memory_journal mj
                WHERE mj.deleted_at IS NULL
                  AND mj.id IN (
                      SELECT DISTINCT from_entry_id FROM relationships
                      UNION
                      SELECT DISTINCT to_entry_id FROM relationships
                  )
                ORDER BY mj.id DESC
                LIMIT ?
            `,
                [options.limit]
            )
        }

        const nodes: {
            id: string | number
            label: string
            group: string
            metadata: { is_personal: boolean; content: string }
        }[] = []
        if (entriesResult[0] && entriesResult[0].values.length > 0) {
            const cols = entriesResult[0].columns
            for (const row of entriesResult[0].values) {
                nodes.push({
                    id: row[cols.indexOf('id')] as number,
                    group: row[cols.indexOf('entry_type')] as string,
                    label: `Node ${row[cols.indexOf('id')] as number}`,
                    metadata: {
                        content: row[cols.indexOf('content')] as string,
                        is_personal: Boolean(row[cols.indexOf('is_personal')]),
                    },
                })
            }
        }

        const edges: { from: string | number; to: string | number; label: string; type: string }[] =
            []
        if (nodes.length > 0) {
            const entryIds = nodes.map((n) => n.id as number)
            const placeholders = entryIds.map(() => '?').join(',')

            let relsQuery = `
                SELECT from_entry_id, to_entry_id, relationship_type
                FROM relationships
                WHERE from_entry_id IN (${placeholders})
                  AND to_entry_id IN (${placeholders})
            `
            const relsParams: unknown[] = [...entryIds, ...entryIds]

            if (options.relationshipType) {
                relsQuery += ' AND relationship_type = ?'
                relsParams.push(options.relationshipType)
            }

            const relsResult = this.connection.exec(relsQuery, relsParams)
            if (relsResult[0]) {
                for (const row of relsResult[0].values) {
                    edges.push({
                        from: row[0] as number,
                        to: row[1] as number,
                        label: row[2] as string,
                        type: row[2] as string,
                    })
                }
            }
        }

        return { nodes, edges }
    }

    getTeamCollaborationMatrix(options: { period: string; limit: number }): {
        totalAuthors: number
        totalEntries: number
        authorActivity: { author: string; period: string; entryCount: number }[]
        crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
        impactFactor: { author: string; inboundLinks: number }[]
    } {
        const limit = options.limit
        const period = options.period

        const dateExpression =
            period === 'week'
                ? `strftime('%Y-W%W', timestamp)`
                : period === 'quarter'
                  ? `strftime('%Y-Q', timestamp) || CAST(((CAST(strftime('%m', timestamp) AS INTEGER) + 2) / 3) AS INTEGER)`
                  : `strftime('%Y-%m', timestamp)`

        // Author activity heatmap
        const activityResult = this.connection.exec(
            `SELECT
                COALESCE(aa.canonical_author, mj.author, 'unknown') AS author,
                ${dateExpression} AS period,
                COUNT(*) AS entry_count
            FROM memory_journal mj
            LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias)
            WHERE mj.deleted_at IS NULL
            GROUP BY COALESCE(aa.canonical_author, mj.author, 'unknown'), period
            ORDER BY period DESC, entry_count DESC
            LIMIT ?`,
            [limit * 10]
        )
        const authorActivity =
            activityResult[0]?.values.map((row: unknown[]) => ({
                author: row[0] as string,
                period: row[1] as string,
                entryCount: row[2] as number,
            })) ?? []

        // Cross-author linking
        const crossLinkResult = this.connection.exec(
            `SELECT
                COALESCE(aa1.canonical_author, m1.author, 'unknown') AS from_author,
                COALESCE(aa2.canonical_author, m2.author, 'unknown') AS to_author,
                COUNT(*) AS link_count
            FROM relationships r
            JOIN memory_journal m1 ON r.from_entry_id = m1.id
            JOIN memory_journal m2 ON r.to_entry_id = m2.id
            LEFT JOIN author_aliases aa1 ON LOWER(m1.author) = LOWER(aa1.alias)
            LEFT JOIN author_aliases aa2 ON LOWER(m2.author) = LOWER(aa2.alias)
            WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL
                AND COALESCE(aa1.canonical_author, m1.author, 'unknown') != COALESCE(aa2.canonical_author, m2.author, 'unknown')
            GROUP BY from_author, to_author
            ORDER BY link_count DESC
            LIMIT ?`,
            [limit]
        )
        const crossAuthorLinks =
            crossLinkResult[0]?.values.map((row: unknown[]) => ({
                fromAuthor: row[0] as string,
                toAuthor: row[1] as string,
                linkCount: row[2] as number,
            })) ?? []

        // Impact factor
        const impactResult = this.connection.exec(
            `SELECT
                COALESCE(aa2.canonical_author, m2.author, 'unknown') AS author,
                COUNT(*) AS inbound_links
            FROM relationships r
            JOIN memory_journal m2 ON r.to_entry_id = m2.id
            LEFT JOIN author_aliases aa2 ON LOWER(m2.author) = LOWER(aa2.alias)
            WHERE m2.deleted_at IS NULL
            GROUP BY COALESCE(aa2.canonical_author, m2.author, 'unknown')
            ORDER BY inbound_links DESC
            LIMIT ?`,
            [limit]
        )
        const impactFactor =
            impactResult[0]?.values.map((row: unknown[]) => ({
                author: row[0] as string,
                inboundLinks: row[1] as number,
            })) ?? []

        // Totals
        const totalsResult = this.connection.exec(
            `SELECT
                COUNT(DISTINCT COALESCE(aa.canonical_author, mj.author, 'unknown')) AS total_authors,
                COUNT(*) AS total_entries
            FROM memory_journal mj
            LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias)
            WHERE mj.deleted_at IS NULL`
        )
        const totalAuthors = (totalsResult[0]?.values[0]?.[0] as number | undefined) ?? 0
        const totalEntries = (totalsResult[0]?.values[0]?.[1] as number | undefined) ?? 0

        return {
            totalAuthors,
            totalEntries,
            authorActivity,
            crossAuthorLinks,
            impactFactor,
        }
    }
}
