import type { NativeConnectionManager } from './native-connection.js'
import { isMissingTableError } from './schema-errors.js'
import { bucketInParams, runImmediateWriteTx, SCOPED_IN_PARAM_BUCKETS } from './row-helpers.js'
import {
    buildCandidateQueries,
    type CandidateQueries,
    type CandidateQuery,
    type LifecycleOptions,
    type LifecycleResult,
} from './lifecycle-query-builders.js'

type NativeDb = ReturnType<NativeConnectionManager['getNativeDb']>

const toNumberId = (id: number | bigint): number => (typeof id === 'bigint' ? Number(id) : id)

/** Run the candidate SELECTs without mutating anything (dry-run mode). */
function collectDryRun(
    db: NativeDb,
    options: LifecycleOptions,
    queries: CandidateQueries
): LifecycleResult {
    const candidates = {
        archived: [] as { id: number; importance_score: number }[],
        pruned: [] as { id: number; importance_score: number }[],
        hardDeleted: [] as { id: number; age_days: number }[],
    }

    if (options.hardDeleteOlderThanDays > 0) {
        const rows = db
            .prepare<unknown[], { id: number | bigint; age_days: number }>(queries.hardDelete.sql)
            .all(...queries.hardDelete.params)
        candidates.hardDeleted = rows.map((r) => ({
            id: toNumberId(r.id),
            age_days: r.age_days,
        }))
    }
    if (options.pruneOlderThanDays > 0) {
        const sql = `WITH ${queries.cte} ${queries.prune.sql}`
        const rows = db
            .prepare<unknown[], { id: number | bigint; importance_score: number }>(sql)
            .all(...queries.cteParams, ...queries.prune.params)
        candidates.pruned = rows.map((r) => ({
            id: toNumberId(r.id),
            importance_score: r.importance_score,
        }))
    }
    if (options.archiveOlderThanDays > 0) {
        const sql = `WITH ${queries.cte} ${queries.archive.sql}`
        const rows = db
            .prepare<unknown[], { id: number | bigint; importance_score: number }>(sql)
            .all(...queries.cteParams, ...queries.archive.params)
        candidates.archived = rows.map((r) => ({
            id: toNumberId(r.id),
            importance_score: r.importance_score,
        }))
        const prunedIds = new Set(candidates.pruned.map((c) => c.id))
        candidates.archived = candidates.archived.filter((c) => !prunedIds.has(c.id))
    }

    return { archivedCount: 0, prunedCount: 0, hardDeletedCount: 0, candidates }
}

function deleteVecChunk(db: NativeDb, placeholders: string, chunk: number[]): void {
    try {
        const bigIds = chunk.map((id) => BigInt(Math.trunc(id)))
        db.prepare(`DELETE FROM vec_embeddings WHERE entry_id IN (${placeholders})`).run(...bigIds)
    } catch (err) {
        if (!isMissingTableError(err)) throw err
    }
}

function executeHardDeleteStep(db: NativeDb, query: CandidateQuery): number {
    const rows = db.prepare<unknown[], { id: number | bigint }>(query.sql).all(...query.params)
    const ids = rows.map((r) => toNumberId(r.id))
    let hardDeletedCount = 0
    for (const { placeholders, params } of bucketInParams(ids, SCOPED_IN_PARAM_BUCKETS)) {
        const deleteSql = `DELETE FROM memory_journal WHERE id IN (${placeholders})`
        hardDeletedCount += db.prepare(deleteSql).run(...params).changes
        deleteVecChunk(db, placeholders, params)
    }
    return hardDeletedCount
}

function executePruneStep(
    db: NativeDb,
    query: CandidateQuery,
    cte: string,
    cteParams: unknown[],
    deletedAt: string
): number {
    const selectSql = `WITH ${cte} ${query.sql}`
    const rows = db
        .prepare<unknown[], { id: number | bigint }>(selectSql)
        .all(...cteParams, ...query.params)
    const ids = rows.map((r) => toNumberId(r.id))
    if (ids.length === 0) return 0

    let prunedCount = 0
    for (const { placeholders, params } of bucketInParams(ids, SCOPED_IN_PARAM_BUCKETS)) {
        prunedCount += db
            .prepare(
                `UPDATE memory_journal SET deleted_at = ? WHERE id IN (${placeholders}) AND deleted_at IS NULL`
            )
            .run(deletedAt, ...params).changes
        deleteVecChunk(db, placeholders, params)
    }
    return prunedCount
}

function executeArchiveStep(
    db: NativeDb,
    query: CandidateQuery,
    cte: string,
    cteParams: unknown[]
): number {
    const sql = `
        WITH ${cte}
        UPDATE memory_journal
        SET is_archived = 1
        WHERE id IN (
            SELECT id FROM (${query.sql})
        )
    `
    return db.prepare(sql).run(...cteParams, ...query.params).changes
}

function isFtsCorruptError(error: unknown): boolean {
    return (
        (error !== null &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'SQLITE_CORRUPT_VTAB') ||
        (error instanceof Error && error.message.includes('malformed'))
    )
}

function rebuildFtsContentIndex(db: NativeDb): void {
    runImmediateWriteTx(db, () => {
        db.exec("INSERT INTO fts_content(fts_content) VALUES ('delete-all')")
        db.exec(
            'INSERT INTO fts_content(rowid, content) SELECT id, content FROM memory_journal WHERE deleted_at IS NULL'
        )
    })
}

/** Run the hard-delete / prune / archive mutations in a transaction, retrying once after an FTS rebuild. */
function runLifecycleTx(
    db: NativeDb,
    options: LifecycleOptions,
    queries: CandidateQueries
): LifecycleResult {
    const deletedAt = new Date().toISOString()

    const runTx = (): LifecycleResult =>
        runImmediateWriteTx(db, (): LifecycleResult => {
            const hardDeletedCount =
                options.hardDeleteOlderThanDays > 0
                    ? executeHardDeleteStep(db, queries.hardDelete)
                    : 0
            const prunedCount =
                options.pruneOlderThanDays > 0
                    ? executePruneStep(db, queries.prune, queries.cte, queries.cteParams, deletedAt)
                    : 0
            const archivedCount =
                options.archiveOlderThanDays > 0
                    ? executeArchiveStep(db, queries.archive, queries.cte, queries.cteParams)
                    : 0
            return { archivedCount, prunedCount, hardDeletedCount }
        })

    try {
        return runTx()
    } catch (error: unknown) {
        if (!isFtsCorruptError(error)) {
            throw error
        }
        // FTS5 index is out of sync with external content table.
        // Rebuild it atomically (live entries only) and retry the transaction.
        rebuildFtsContentIndex(db)
        return runTx()
    }
}

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
        projectNumber?: number
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
        const queries = buildCandidateQueries(options)

        if (options.dryRun) {
            return collectDryRun(db, options, queries)
        }
        return runLifecycleTx(db, options, queries)
    }
}
