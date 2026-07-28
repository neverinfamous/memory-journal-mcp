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
}
