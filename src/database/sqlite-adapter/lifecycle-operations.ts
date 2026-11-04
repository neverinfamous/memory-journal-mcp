import type { NativeConnectionManager } from './native-connection.js'
import { buildImportanceCte, buildImportanceSqlExpression } from './entries/importance.js'

export class LifecycleOperations {
    constructor(private connection: NativeConnectionManager) {}

    executeDataLifecycle(options: {
        archiveOlderThanDays: number
        pruneOlderThanDays: number
        hardDeleteOlderThanDays: number
        importanceThreshold: number
        dryRun?: boolean
        excludeTags?: string[]
        workspaceId?: string
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
        const excludeTags = options.excludeTags ?? []

        if (excludeTags.length > 0) {
            const placeholders = excludeTags.map(() => '?').join(',')
            excludeTagsSql = `AND e.id NOT IN (
                SELECT entry_id FROM entry_tags
                JOIN tags ON tags.id = entry_tags.tag_id
                WHERE tags.name IN (${placeholders})
            )`
        }

        // --- Candidates Generation ---

        const hardDeleteExcludeSql =
            excludeTags.length > 0
                ? `AND id NOT IN (
                SELECT entry_id FROM entry_tags
                JOIN tags ON tags.id = entry_tags.tag_id
                WHERE tags.name IN (${excludeTags.map(() => '?').join(',')})
            )`
                : ''
        const scopedWorkspace =
            options.workspaceId !== undefined && options.workspaceId !== '*'
                ? options.workspaceId
                : undefined
        const hardDeleteWorkspaceSql =
            scopedWorkspace !== undefined ? 'AND workspace_id = ?' : ''
        const hardDeleteSelect = `
            SELECT id, CAST((julianday('now') - julianday(deleted_at)) AS INTEGER) as age_days
            FROM memory_journal
            WHERE deleted_at IS NOT NULL
              AND julianday('now') - julianday(deleted_at) > ?
              ${hardDeleteExcludeSql}
              ${hardDeleteWorkspaceSql}
        `
        const hardDeleteParams: unknown[] = [
            options.hardDeleteOlderThanDays,
            ...excludeTags,
            ...(scopedWorkspace !== undefined ? [scopedWorkspace] : []),
        ]

        const pruneSelect = `
            SELECT e.id, ${importanceExpr} as importance_score
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL
              AND julianday('now') - julianday(e.timestamp) > ?
              AND ${importanceExpr} < ?
              AND e.significance_type IS NULL
              AND COALESCE(e.impact_score, 0.0) < 0.5
              AND COALESCE(rs.rel_count, 0) = 0
              ${excludeTagsSql}
              ${scopedWorkspace !== undefined ? 'AND e.workspace_id = ?' : ''}
        `
        const pruneParams: unknown[] = [
            options.pruneOlderThanDays,
            options.importanceThreshold,
            ...excludeTags,
            ...(scopedWorkspace !== undefined ? [scopedWorkspace] : []),
        ]

        const archiveSelect = `
            SELECT e.id, ${importanceExpr} as importance_score
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL AND e.is_archived = 0
            AND julianday('now') - julianday(e.timestamp) > ?
            AND ${importanceExpr} < ?
            ${excludeTagsSql}
            ${scopedWorkspace !== undefined ? 'AND e.workspace_id = ?' : ''}
        `
        const archiveParams: unknown[] = [
            options.archiveOlderThanDays,
            options.importanceThreshold,
            ...excludeTags,
            ...(scopedWorkspace !== undefined ? [scopedWorkspace] : []),
        ]

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
                const rows = db.prepare(hardDeleteSelect).all(...hardDeleteParams) as { id: number | bigint, age_days: number }[]
                candidates.hardDeleted = rows.map(r => ({
                    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
                    age_days: r.age_days
                }))
            }
            if (options.pruneOlderThanDays > 0) {
                const sql = `WITH ${cte} ${pruneSelect}`
                const rows = db.prepare(sql).all(...pruneParams) as { id: number | bigint, importance_score: number }[]
                candidates.pruned = rows.map(r => ({
                    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
                    importance_score: r.importance_score
                }))
            }
            if (options.archiveOlderThanDays > 0) {
                const sql = `WITH ${cte} ${archiveSelect}`
                const rows = db.prepare(sql).all(...archiveParams) as { id: number | bigint, importance_score: number }[]
                candidates.archived = rows.map(r => ({
                    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
                    importance_score: r.importance_score
                }))
                const prunedIds = new Set(candidates.pruned.map(c => c.id))
                candidates.archived = candidates.archived.filter(c => !prunedIds.has(c.id))
            }

            return { archivedCount: 0, prunedCount: 0, hardDeletedCount: 0, candidates }
        }

        const runTx = db.transaction(() => {
            if (options.hardDeleteOlderThanDays > 0) {
                const rows = db.prepare(hardDeleteSelect).all(...hardDeleteParams) as { id: number | bigint }[]
                const ids = rows.map(r => typeof r.id === 'bigint' ? Number(r.id) : r.id)
                if (ids.length > 0) {
                    const placeholders = ids.map(() => '?').join(',')
                    const deleteSql = `DELETE FROM memory_journal WHERE id IN (${placeholders})`
                    const result = db.prepare(deleteSql).run(...ids)
                    hardDeletedCount = result.changes

                    try {
                        db.prepare(`DELETE FROM vec_embeddings WHERE entry_id IN (${placeholders})`).run(...ids)
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err)
                        if (!message.includes('no such table')) throw err
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
                const result = db.prepare(sql).run(deletedAt, ...pruneParams)
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
                const result = db.prepare(sql).run(...archiveParams)
                archivedCount = result.changes
            }
        })

        try {
            runTx()
        } catch (error: unknown) {
            const isCorrupt =
                (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CORRUPT_VTAB') ||
                (error instanceof Error && error.message.includes('malformed'))
            if (isCorrupt) {
                // FTS5 index is out of sync with external content table.
                // Rebuild it synchronously and retry the transaction.
                db.prepare("INSERT INTO fts_content(fts_content) VALUES ('rebuild')").run()

                // Reset counters before retry
                hardDeletedCount = 0
                prunedCount = 0
                archivedCount = 0

                runTx()
            } else {
                throw error
            }
        }

        return { archivedCount, prunedCount, hardDeletedCount }
    }
}
