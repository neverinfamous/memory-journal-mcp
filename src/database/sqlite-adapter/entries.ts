import { logger } from '../../utils/logger.js'
import {
    validateDateFormatPattern,
    sanitizeSearchQuery,
} from '../../utils/security-utils.js'
import type {
    JournalEntry,
    EntryType,
    SignificanceType,
    ImportanceBreakdown,
    ImportanceResult,
} from '../../types/index.js'
import type { CreateEntryInput } from '../core/schema.js'
import type { IDatabaseConnection } from '../core/interfaces.js'
import type { TagsManager } from './tags.js'

const ENTRY_COLUMNS =
    'id, entry_type, content, timestamp, is_personal, significance_type, auto_context, deleted_at, ' +
    'project_number, project_owner, issue_number, issue_url, pr_number, pr_url, pr_status, ' +
    'workflow_run_id, workflow_name, workflow_status'

const ALIASED_ENTRY_COLUMNS =
    'm.id, m.entry_type, m.content, m.timestamp, m.is_personal, m.significance_type, m.auto_context, m.deleted_at, ' +
    'm.project_number, m.project_owner, m.issue_number, m.issue_url, m.pr_number, m.pr_url, m.pr_status, ' +
    'm.workflow_run_id, m.workflow_name, m.workflow_status'

export class EntriesManager {
    static readonly IMPORTANCE_WEIGHTS = {
        significance: 0.3,
        relationships: 0.35,
        causal: 0.2,
        recency: 0.15,
    } as const

    constructor(private ctx: IDatabaseConnection, private tagsMgr: TagsManager) {}

    createEntry(input: CreateEntryInput): JournalEntry {
        const db = this.ctx
        const {
            content,
            entryType = 'personal_reflection',
            tags = [],
            isPersonal = true,
            significanceType = null,
            autoContext = null,
            projectNumber,
            projectOwner,
            issueNumber,
            issueUrl,
            prNumber,
            prUrl,
            prStatus,
            workflowRunId,
            workflowName,
            workflowStatus,
        } = input

        db.run(
            `
            INSERT INTO memory_journal (
                entry_type, content, is_personal, significance_type, auto_context,
                project_number, project_owner, issue_number, issue_url,
                pr_number, pr_url, pr_status, workflow_run_id, workflow_name, workflow_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
                entryType,
                content,
                isPersonal ? 1 : 0,
                significanceType,
                autoContext,
                projectNumber ?? null,
                projectOwner ?? null,
                issueNumber ?? null,
                issueUrl ?? null,
                prNumber ?? null,
                prUrl ?? null,
                prStatus ?? null,
                workflowRunId ?? null,
                workflowName ?? null,
                workflowStatus ?? null,
            ]
        )

        const result = db.exec('SELECT last_insert_rowid() as id, datetime(CURRENT_TIMESTAMP) as ts')
        const entryId = result[0]?.values[0]?.[0] as number
        const timestamp = result[0]?.values[0]?.[1] as string

        if (tags.length > 0) {
            this.tagsMgr.linkTagsToEntry(entryId, tags)
        }

        this.ctx.scheduleSave()

        logger.info('Entry created', {
            module: 'SqliteAdapter',
            operation: 'createEntry',
            entityId: entryId,
        })

        return {
            id: entryId,
            entryType,
            content,
            timestamp,
            isPersonal,
            significanceType,
            autoContext,
            deletedAt: null,
            tags: [...tags],
            projectNumber: projectNumber ?? null,
            projectOwner: projectOwner ?? null,
            issueNumber: issueNumber ?? null,
            issueUrl: issueUrl ?? null,
            prNumber: prNumber ?? null,
            prUrl: prUrl ?? null,
            prStatus: prStatus ?? null,
            workflowRunId: workflowRunId ?? null,
            workflowName: workflowName ?? null,
            workflowStatus: workflowStatus ?? null,
        }
    }

    getEntryById(id: number): JournalEntry | null {
        const db = this.ctx
        const result = db.exec(`SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ? AND deleted_at IS NULL`, [id])

        if (result.length === 0 || result[0]?.values.length === 0) return null

        const columns = result[0]?.columns ?? []
        const values = result[0]?.values[0] ?? []
        const row = this.rowToObject(columns, values)

        return this.rowToEntry(row)
    }

    getEntryByIdIncludeDeleted(id: number): JournalEntry | null {
        const db = this.ctx
        const result = db.exec(`SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ?`, [id])

        if (result.length === 0 || result[0]?.values.length === 0) return null

        const columns = result[0]?.columns ?? []
        const values = result[0]?.values[0] ?? []
        const row = this.rowToObject(columns, values)

        return this.rowToEntry(row)
    }

    calculateImportance(entryId: number): ImportanceResult {
        const db = this.ctx
        const round2 = (n: number): number => Math.round(n * 100) / 100

        const result = db.exec(
            `SELECT
                m.significance_type,
                m.timestamp,
                (SELECT COUNT(*) FROM relationships
                 WHERE from_entry_id = ? OR to_entry_id = ?) AS rel_count,
                (SELECT COUNT(*) FROM relationships
                 WHERE (from_entry_id = ? OR to_entry_id = ?)
                 AND relationship_type IN ('blocked_by', 'resolved', 'caused')) AS causal_count
            FROM memory_journal m
            WHERE m.id = ? AND m.deleted_at IS NULL`,
            [entryId, entryId, entryId, entryId, entryId]
        )
        if (result.length === 0 || result[0]?.values.length === 0) {
            return {
                score: 0,
                breakdown: { significance: 0, relationships: 0, causal: 0, recency: 0 },
            }
        }

        const row = result[0]?.values[0] ?? []
        const significanceType = row[0] as string | null
        const timestamp = row[1] as string
        const relCount = (row[2] as number) ?? 0
        const causalCount = (row[3] as number) ?? 0

        const significanceRaw = significanceType ? 1.0 : 0.0
        const relationshipsRaw = Math.min(relCount / 5, 1.0)
        const causalRaw = Math.min(causalCount / 3, 1.0)

        const entryDate = new Date(timestamp)
        const now = new Date()
        const daysSince = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
        const recencyRaw = Math.max(0, 1 - daysSince / 90)

        const w = EntriesManager.IMPORTANCE_WEIGHTS

        const breakdown: ImportanceBreakdown = {
            significance: round2(significanceRaw * w.significance),
            relationships: round2(relationshipsRaw * w.relationships),
            causal: round2(causalRaw * w.causal),
            recency: round2(recencyRaw * w.recency),
        }

        const score = round2(
            significanceRaw * w.significance +
                relationshipsRaw * w.relationships +
                causalRaw * w.causal +
                recencyRaw * w.recency
        )

        return { score, breakdown }
    }

    getRecentEntries(limit = 10, isPersonal?: boolean): JournalEntry[] {
        const db = this.ctx
        let sql = `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL`
        const params: unknown[] = []

        if (isPersonal !== undefined) {
            sql += ` AND is_personal = ?`
            params.push(isPersonal ? 1 : 0)
        }

        sql += ` ORDER BY timestamp DESC, id DESC LIMIT ?`
        params.push(limit)

        const result = db.exec(sql, params)
        if (result.length === 0) return []

        return this.rowsToEntries(result[0]?.columns ?? [], result[0]?.values ?? [])
    }

    getEntriesPage(offset: number, limit: number): JournalEntry[] {
        const db = this.ctx
        const result = db.exec(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL ORDER BY id ASC LIMIT ? OFFSET ?`,
            [limit, offset]
        )
        if (result.length === 0) return []

        return this.rowsToEntries(result[0]?.columns ?? [], result[0]?.values ?? [])
    }

    getActiveEntryCount(): number {
        const db = this.ctx
        const result = db.exec(`SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL`)
        return (result[0]?.values[0]?.[0] as number) ?? 0
    }

    updateEntry(
        id: number,
        updates: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
        }
    ): JournalEntry | null {
        const db = this.ctx

        const setClause: string[] = []
        const params: unknown[] = []

        if (updates.content !== undefined) {
            setClause.push('content = ?')
            params.push(updates.content)
        }
        if (updates.entryType !== undefined) {
            setClause.push('entry_type = ?')
            params.push(updates.entryType)
        }
        if (updates.isPersonal !== undefined) {
            setClause.push('is_personal = ?')
            params.push(updates.isPersonal ? 1 : 0)
        }

        if (setClause.length > 0) {
            params.push(id)
            db.run(
                `UPDATE memory_journal SET ${setClause.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
                params
            )
            const changesResult = db.exec('SELECT changes()')
            const rowsModified = (changesResult[0]?.values[0]?.[0] as number) ?? 0
            if (rowsModified === 0) return null
        } else {
            const exists = db.exec(
                'SELECT 1 FROM memory_journal WHERE id = ? AND deleted_at IS NULL',
                [id]
            )
            if (exists.length === 0 || exists[0]?.values.length === 0) return null
        }

        if (updates.tags !== undefined) {
            db.run('DELETE FROM entry_tags WHERE entry_id = ?', [id])
            this.tagsMgr.linkTagsToEntry(id, updates.tags)
        }

        this.ctx.scheduleSave()

        logger.info('Entry updated', {
            module: 'SqliteAdapter',
            operation: 'updateEntry',
            entityId: id,
        })

        return this.getEntryById(id)
    }

    deleteEntry(id: number, permanent = false): boolean {
        const db = this.ctx

        const entry = permanent ? this.getEntryByIdIncludeDeleted(id) : this.getEntryById(id)
        if (!entry) return false

        if (permanent) {
            db.run('DELETE FROM memory_journal WHERE id = ?', [id])
        } else {
            db.run(`UPDATE memory_journal SET deleted_at = datetime('now') WHERE id = ?`, [id])
        }

        this.ctx.scheduleSave()
        return true
    }

    searchEntries(
        query: string,
        options: {
            limit?: number
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
        } = {}
    ): JournalEntry[] {
        const db = this.ctx
        const { limit = 10, isPersonal, projectNumber, issueNumber, prNumber } = options

        let sql = `
            SELECT ${ENTRY_COLUMNS} FROM memory_journal
            WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '\\'
        `
        const params: unknown[] = [`%${sanitizeSearchQuery(query)}%`]

        if (isPersonal !== undefined) {
            sql += ` AND is_personal = ?`
            params.push(isPersonal ? 1 : 0)
        }
        if (projectNumber !== undefined) {
            sql += ` AND project_number = ?`
            params.push(projectNumber)
        }
        if (issueNumber !== undefined) {
            sql += ` AND issue_number = ?`
            params.push(issueNumber)
        }
        if (prNumber !== undefined) {
            sql += ` AND pr_number = ?`
            params.push(prNumber)
        }

        sql += ` ORDER BY timestamp DESC LIMIT ?`
        params.push(limit)

        const result = db.exec(sql, params)
        if (result.length === 0) return []

        return this.rowsToEntries(result[0]?.columns ?? [], result[0]?.values ?? [])
    }

    searchByDateRange(
        startDate: string,
        endDate: string,
        options: {
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            workflowRunId?: number
            limit?: number
        } = {}
    ): JournalEntry[] {
        const db = this.ctx
        const { entryType, tags, isPersonal, projectNumber, issueNumber, prNumber, workflowRunId } =
            options

        let sql: string
        const params: unknown[] = [startDate, endDate + ' 23:59:59']

        if (tags && tags.length > 0) {
            sql = `
                SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS} FROM memory_journal m
                JOIN entry_tags et ON m.id = et.entry_id
                JOIN tags t ON et.tag_id = t.id
                WHERE m.deleted_at IS NULL
                AND m.timestamp >= ? AND m.timestamp <= ?
            `
            const placeholders = tags.map(() => '?').join(',')
            sql += ` AND t.name IN (${placeholders})`
            params.push(...tags)
        } else {
            sql = `
                SELECT ${ALIASED_ENTRY_COLUMNS} FROM memory_journal m
                WHERE m.deleted_at IS NULL
                AND m.timestamp >= ? AND m.timestamp <= ?
            `
        }

        if (entryType) {
            sql += ` AND m.entry_type = ?`
            params.push(entryType)
        }
        if (isPersonal !== undefined) {
            sql += ` AND m.is_personal = ?`
            params.push(isPersonal ? 1 : 0)
        }
        if (projectNumber !== undefined) {
            sql += ` AND m.project_number = ?`
            params.push(projectNumber)
        }
        if (issueNumber !== undefined) {
            sql += ` AND m.issue_number = ?`
            params.push(issueNumber)
        }
        if (prNumber !== undefined) {
            sql += ` AND m.pr_number = ?`
            params.push(prNumber)
        }
        if (workflowRunId !== undefined) {
            sql += ` AND m.workflow_run_id = ?`
            params.push(workflowRunId)
        }

        sql += ` ORDER BY m.timestamp DESC LIMIT ?`
        params.push(options.limit ?? 500)

        const result = db.exec(sql, params)
        if (result.length === 0) return []

        return this.rowsToEntries(result[0]?.columns ?? [], result[0]?.values ?? [])
    }

    getStatistics(
        groupBy: 'day' | 'week' | 'month' = 'week',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean
    ): {
        totalEntries: number
        entriesByType: Record<string, number>
        entriesByPeriod: { period: string; count: number }[]
        // Enhanced analytics (v4.3.0)
        decisionDensity: { period: string; significantCount: number }[]
        relationshipComplexity: {
            totalRelationships: number
            avgPerEntry: number
        }
        activityTrend: {
            currentPeriod: string
            previousPeriod: string
            growthPercent: number | null
        }
        causalMetrics: {
            blocked_by: number
            resolved: number
            caused: number
        }
        // Optional date range echo (v5.1.0)
        dateRange?: { startDate: string; endDate: string }
        // Optional project breakdown (v5.1.0)
        projectBreakdown?: { project_number: number; entry_count: number }[]
    } {
        const db = this.ctx

        let dateFilter = ''
        const dateParams: unknown[] = []
        if (startDate) {
            dateFilter += ' AND DATE(timestamp) >= DATE(?)'
            dateParams.push(startDate)
        }
        if (endDate) {
            dateFilter += ' AND DATE(timestamp) <= DATE(?)'
            dateParams.push(endDate)
        }

        let totalEntries: number
        const entriesByType: Record<string, number> = {}

        if (dateParams.length > 0) {
            const countResult = db.exec(
                `SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter}`,
                [...dateParams]
            )
            totalEntries = (countResult[0]?.values[0]?.[0] as number) ?? 0

            const typeResult = db.exec(
                `SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter} GROUP BY entry_type`,
                [...dateParams]
            )
            for (const row of typeResult[0]?.values ?? []) {
                entriesByType[row[0] as string] = row[1] as number
            }
        } else {
            const totalResult = db.exec('SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL')
            const typeResult = db.exec(`
                SELECT entry_type, COUNT(*) as count
                FROM memory_journal
                WHERE deleted_at IS NULL
                GROUP BY entry_type
            `)
            totalEntries = (totalResult[0]?.values[0]?.[0] as number) ?? 0
            for (const row of typeResult[0]?.values ?? []) {
                entriesByType[row[0] as string] = row[1] as number
            }
        }

        const dateFormat = validateDateFormatPattern(groupBy)
        const periodResult = db.exec(
            `SELECT
                strftime('${dateFormat}', timestamp) as period,
                COUNT(*) as total_count,
                SUM(CASE WHEN significance_type IS NOT NULL THEN 1 ELSE 0 END) as significant_count
            FROM memory_journal
            WHERE deleted_at IS NULL${dateFilter}
            GROUP BY period
            ORDER BY period DESC
            LIMIT 52`,
            [...dateParams]
        )

        const entriesByPeriod = (periodResult[0]?.values ?? []).map((v: unknown[]) => ({
            period: v[0] as string,
            count: v[1] as number,
        }))

        const decisionDensity = (periodResult[0]?.values ?? [])
            .filter((v: unknown[]) => (v[2] as number) > 0)
            .map((v: unknown[]) => ({
                period: v[0] as string,
                significantCount: v[2] as number,
            }))

        const relCountResult = db.exec('SELECT COUNT(*) FROM relationships')
        const relTypeResult = db.exec(`
            SELECT relationship_type, COUNT(*) as count
            FROM relationships
            WHERE relationship_type IN ('blocked_by', 'resolved', 'caused')
            GROUP BY relationship_type
        `)
        const totalRelationships = (relCountResult[0]?.values[0]?.[0] as number) ?? 0
        const avgPerEntry = totalEntries > 0 ? totalRelationships / totalEntries : 0

        const currentPeriod = entriesByPeriod[0]?.period ?? ''
        const previousPeriod = entriesByPeriod[1]?.period ?? ''
        const currentCount = entriesByPeriod[0]?.count ?? 0
        const previousCount = entriesByPeriod[1]?.count ?? 0
        const growthPercent =
            previousCount > 0
                ? Math.round(((currentCount - previousCount) / previousCount) * 100)
                : null

        const causalMetrics = { blocked_by: 0, resolved: 0, caused: 0 }
        for (const row of relTypeResult[0]?.values ?? []) {
            const relType = row[0] as 'blocked_by' | 'resolved' | 'caused'
            causalMetrics[relType] = row[1] as number
        }

        const result: ReturnType<EntriesManager['getStatistics']> = {
            totalEntries,
            entriesByType,
            entriesByPeriod,
            decisionDensity,
            relationshipComplexity: {
                totalRelationships,
                avgPerEntry: Math.round(avgPerEntry * 100) / 100,
            },
            activityTrend: {
                currentPeriod,
                previousPeriod,
                growthPercent,
            },
            causalMetrics,
        }

        if (startDate || endDate) {
            result.dateRange = {
                startDate: startDate ?? '',
                endDate: endDate ?? '',
            }
        }

        if (projectBreakdown) {
            const projResult = db.exec(
                `SELECT project_number, COUNT(*) as entry_count
                FROM memory_journal
                WHERE deleted_at IS NULL AND project_number IS NOT NULL${dateFilter}
                GROUP BY project_number
                ORDER BY entry_count DESC`,
                [...dateParams]
            )
            result.projectBreakdown = (projResult[0]?.values ?? []).map((v: unknown[]) => ({
                project_number: v[0] as number,
                entry_count: v[1] as number,
            }))
        }

        return result
    }

    private rowToObject(columns: string[], values: unknown[]): Record<string, unknown> {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
            obj[col] = values[i]
        })
        return obj
    }

    private rowToEntry(row: Record<string, unknown>): JournalEntry {
        const id = row['id'] as number
        return {
            id,
            entryType: row['entry_type'] as EntryType,
            content: row['content'] as string,
            timestamp: row['timestamp'] as string,
            isPersonal: row['is_personal'] === 1,
            significanceType: row['significance_type'] as SignificanceType,
            autoContext: row['auto_context'] as string | null,
            deletedAt: row['deleted_at'] as string | null,
            tags: this.tagsMgr.getTagsForEntry(id),
            projectNumber: (row['project_number'] as number | null) ?? null,
            projectOwner: (row['project_owner'] as string | null) ?? null,
            issueNumber: (row['issue_number'] as number | null) ?? null,
            issueUrl: (row['issue_url'] as string | null) ?? null,
            prNumber: (row['pr_number'] as number | null) ?? null,
            prUrl: (row['pr_url'] as string | null) ?? null,
            prStatus: (row['pr_status'] as string | null) ?? null,
            workflowRunId: (row['workflow_run_id'] as number | null) ?? null,
            workflowName: (row['workflow_name'] as string | null) ?? null,
            workflowStatus: (row['workflow_status'] as string | null) ?? null,
        }
    }

    private rowsToEntries(columns: string[], values: unknown[][]): JournalEntry[] {
        if (values.length === 0) return []

        const rows = values.map((v) => this.rowToObject(columns, v))
        const ids = rows.map((r) => r['id'] as number)

        const tagMap = this.tagsMgr.batchGetTagsForEntries(ids)

        return rows.map((row) => {
            const id = row['id'] as number
            return {
                id,
                entryType: row['entry_type'] as EntryType,
                content: row['content'] as string,
                timestamp: row['timestamp'] as string,
                isPersonal: row['is_personal'] === 1,
                significanceType: row['significance_type'] as SignificanceType,
                autoContext: row['auto_context'] as string | null,
                deletedAt: row['deleted_at'] as string | null,
                tags: tagMap.get(id) ?? [],
                projectNumber: (row['project_number'] as number | null) ?? null,
                projectOwner: (row['project_owner'] as string | null) ?? null,
                issueNumber: (row['issue_number'] as number | null) ?? null,
                issueUrl: (row['issue_url'] as string | null) ?? null,
                prNumber: (row['pr_number'] as number | null) ?? null,
                prUrl: (row['pr_url'] as string | null) ?? null,
                prStatus: (row['pr_status'] as string | null) ?? null,
                workflowRunId: (row['workflow_run_id'] as number | null) ?? null,
                workflowName: (row['workflow_name'] as string | null) ?? null,
                workflowStatus: (row['workflow_status'] as string | null) ?? null,
            }
        })
    }
}
