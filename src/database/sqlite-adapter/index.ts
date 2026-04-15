import type {
    JournalEntry,
    Tag,
    Relationship,
    EntryType,
    RelationshipType,
    ImportanceResult,
} from '../../types/index.js'
import type { CreateEntryInput } from '../core/schema.js'
import type { IDatabaseAdapter, QueryResult } from '../core/interfaces.js'

import { NativeConnectionManager } from './native-connection.js'
import { TagsManager } from './tags.js'
import { EntriesManager } from './entries/index.js'
import { RelationshipsManager } from './relationships.js'
import { BackupManager } from './backup.js'
import {
    saveAnalyticsSnapshot as saveSnapshot,
    getLatestAnalyticsSnapshot as getLatestSnapshot,
    getAnalyticsSnapshots as getSnapshots,
    computeDigest,
} from './entries/digest.js'
import type { Database } from 'better-sqlite3'
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

    constructor(dbPath: string) {
        this.connection = new NativeConnectionManager(dbPath)
        this.tagsMgr = new TagsManager(this.connection)
        this.entriesMgr = new EntriesManager(this.connection, this.tagsMgr)
        this.relationshipsMgr = new RelationshipsManager(this.connection, this.entriesMgr)
        this.backupMgr = new BackupManager(this.connection)
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
        sortBy?: 'timestamp' | 'importance'
    ): JournalEntry[] {
        return this.entriesMgr.getRecentEntries(limit ?? 10, isPersonal, sortBy)
    }

    getEntriesPage(offset: number, limit: number): JournalEntry[] {
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
    ): JournalEntry | null {
        return this.entriesMgr.updateEntry(id, updates)
    }

    deleteEntry(id: number, permanent = false): boolean {
        return this.entriesMgr.deleteEntry(id, permanent)
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
        }
    ): JournalEntry[] {
        return this.entriesMgr.searchEntries(query, options)
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
        }
    ): JournalEntry[] {
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

    async restoreFromFile(filename: string): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        return this.backupMgr.restoreFromFile(filename)
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

    /**
     * @deprecated Exposes underlying database instance, violating adapter boundaries. Slated for removal.
     */
    getRawDb(): unknown {
        return this.connection.getRawDb()
    }

    getWorkflowActionEntries(limit: number): JournalEntry[] {
        const rows = this.connection.exec(`
            SELECT * FROM memory_journal
            WHERE workflow_run_id IS NOT NULL AND deleted_at IS NULL
            ORDER BY timestamp DESC
            LIMIT ?
        `, [limit])
        
        if (!rows[0] || rows[0].values.length === 0) return []
        
        const cols = rows[0].columns
        return rows[0].values.map((row: unknown[]): JournalEntry => {
            const getVal = (idx: number): unknown => row[idx]
            return {
                id: getVal(cols.indexOf('id')) as number,
                entryType: getVal(cols.indexOf('entry_type')) as EntryType,
                content: getVal(cols.indexOf('content')) as string,
                timestamp: getVal(cols.indexOf('timestamp')) as string,
                tags: this.getTagsForEntry(getVal(cols.indexOf('id')) as number),
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
        return rows[0].values.map((row: unknown[]): JournalEntry => {
            const getVal = (idx: number): unknown => row[idx]
            return {
                id: getVal(cols.indexOf('id')) as number,
                entryType: getVal(cols.indexOf('entry_type')) as EntryType,
                content: getVal(cols.indexOf('content')) as string,
                timestamp: getVal(cols.indexOf('timestamp')) as string,
                tags: this.getTagsForEntry(getVal(cols.indexOf('id')) as number),
                isPersonal: Boolean(getVal(cols.indexOf('is_personal'))),
                projectNumber: getVal(cols.indexOf('project_number')) as number | undefined,
                issueNumber: getVal(cols.indexOf('issue_number')) as number | undefined,
                prNumber: getVal(cols.indexOf('pr_number')) as number | undefined,
                significanceType: getVal(cols.indexOf('significance_type')) as string | undefined,
            } as JournalEntry
        })
    }

    getRecentGraphRelationships(limit: number): {
        from_entry_id: number; to_entry_id: number; relationship_type: string;
        from_content: string; to_content: string;
    }[] {
        const rows = this.connection.exec(`
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
        `, [limit])

        if (!rows[0] || rows[0].values.length === 0) return []
        
        const cols = rows[0].columns
        return rows[0].values.map(row => ({
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
                `SELECT COALESCE(author, 'unknown') as author, COUNT(*) as count
                 FROM memory_journal
                 WHERE deleted_at IS NULL
                 GROUP BY COALESCE(author, 'unknown')
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
                `SELECT id, author FROM memory_journal WHERE id IN (${placeholders})`,
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
        return saveSnapshot(this.connection.getRawDb() as Database, type, data)
    }

    getLatestAnalyticsSnapshot(
        type: string
    ): { id: number; createdAt: string; data: Record<string, unknown> } | null {
        return getLatestSnapshot(this.connection.getRawDb() as Database, type)
    }

    getAnalyticsSnapshots(
        type: string,
        limit?: number
    ): { id: number; createdAt: string; data: Record<string, unknown> }[] {
        return getSnapshots(this.connection.getRawDb() as Database, type, limit)
    }

    computeDigest(): Record<string, unknown> {
        return computeDigest(this.connection.getRawDb() as Database) as unknown as Record<string, unknown>
    }

    getCrossProjectInsights(options: { 
        startDate?: string; 
        endDate?: string; 
        minEntries: number; 
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
            const projectNumbers = projects.map(p => p['project_number'] as number)
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
            const tagMap = new Map<number, {name: string, count: number}[]>()
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
        nodes: { id: string | number; label: string; group: string; metadata?: Record<string, unknown> }[]
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

        const nodes: { id: string | number; label: string; group: string; metadata: { is_personal: boolean, content: string } }[] = []
        if (entriesResult[0] && entriesResult[0].values.length > 0) {
            const cols = entriesResult[0].columns
            for (const row of entriesResult[0].values) {
                nodes.push({
                    id: row[cols.indexOf('id')] as number,
                    group: row[cols.indexOf('entry_type')] as string,
                    label: `Node ${row[cols.indexOf('id')] as number}`,
                    metadata: {
                        content: row[cols.indexOf('content')] as string,
                        is_personal: Boolean(row[cols.indexOf('is_personal')])
                    }
                })
            }
        }

        const edges: { from: string | number; to: string | number; label: string; type: string }[] = []
        if (nodes.length > 0) {
            const entryIds = nodes.map(n => n.id as number)
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
                        type: row[2] as string
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
                COALESCE(author, 'unknown') AS author,
                ${dateExpression} AS period,
                COUNT(*) AS entry_count
            FROM memory_journal
            WHERE deleted_at IS NULL
            GROUP BY author, period
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
                COALESCE(m1.author, 'unknown') AS from_author,
                COALESCE(m2.author, 'unknown') AS to_author,
                COUNT(*) AS link_count
            FROM relationships r
            JOIN memory_journal m1 ON r.from_entry_id = m1.id
            JOIN memory_journal m2 ON r.to_entry_id = m2.id
            WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL
                AND COALESCE(m1.author, 'unknown') != COALESCE(m2.author, 'unknown')
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
                COALESCE(m2.author, 'unknown') AS author,
                COUNT(*) AS inbound_links
            FROM relationships r
            JOIN memory_journal m2 ON r.to_entry_id = m2.id
            WHERE m2.deleted_at IS NULL
            GROUP BY author
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
                COUNT(DISTINCT COALESCE(author, 'unknown')) AS total_authors,
                COUNT(*) AS total_entries
            FROM memory_journal
            WHERE deleted_at IS NULL`
        )
        const totalAuthors =
            (totalsResult[0]?.values[0]?.[0] as number | undefined) ?? 0
        const totalEntries =
            (totalsResult[0]?.values[0]?.[1] as number | undefined) ?? 0

        return {
            totalAuthors,
            totalEntries,
            authorActivity,
            crossAuthorLinks,
            impactFactor,
        }
    }
}
