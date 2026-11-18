import type { NativeConnectionManager } from './native-connection.js'
import { buildImportanceCte, buildImportanceSqlExpression } from './entries/importance.js'
import { isMissingTableError } from './schema-errors.js'
import { expandTagFilterValues } from './tags.js'
import { bucketInParams, IN_PARAM_BUCKETS } from './row-helpers.js'

type NativeDb = ReturnType<NativeConnectionManager['getNativeDb']>

interface LifecycleOptions {
    archiveOlderThanDays: number
    pruneOlderThanDays: number
    hardDeleteOlderThanDays: number
    importanceThreshold: number
    dryRun?: boolean
    excludeTags?: string[]
    workspaceId?: string
    projectNumber?: number
}

interface LifecycleResult {
    archivedCount: number
    prunedCount: number
    hardDeletedCount: number
    candidates?: {
        archived: { id: number; importance_score: number }[]
        pruned: { id: number; importance_score: number }[]
        hardDeleted: { id: number; age_days: number }[]
    }
}

interface CandidateQuery {
    sql: string
    params: unknown[]
}

interface CandidateQueries {
    hardDelete: CandidateQuery
    prune: CandidateQuery
    archive: CandidateQuery
}

const toNumberId = (id: number | bigint): number => (typeof id === 'bigint' ? Number(id) : id)

/** Shared inputs for building the candidate queries. */
interface CandidateScope {
    excludeTags: string[]
    /** Undefined means database-wide (omitted workspaceId or '*'). */
    scopedWorkspace: string | undefined
    scopedProject: number | undefined
}

const tagExclusionSql = (
    idColumn: string,
    tags: string[]
): { sql: string; params: string[] } => {
    if (tags.length === 0) return { sql: '', params: [] }
    const parts: string[] = []
    const params: string[] = []
    for (const chunk of bucketInParams(tags, IN_PARAM_BUCKETS)) {
        parts.push(
            `AND ${idColumn} NOT IN (
                SELECT entry_id FROM entry_tags
                JOIN tags ON tags.id = entry_tags.tag_id
                WHERE LOWER(tags.name) IN (${chunk.placeholders})
            )`
        )
        params.push(...chunk.params)
    }
    return { sql: parts.join('\n'), params }
}

function ageRangeFilter(
    col: string,
    days: number
): { sql: string; params: unknown[] } {
    if (days > 1) {
        const upperIso = new Date(Date.now() - (days - 1) * 86_400_000).toISOString()
        return {
            sql: `AND ${col} < ? AND julianday('now') - julianday(${col}) > ?`,
            params: [upperIso, days],
        }
    }
    return {
        sql: `AND julianday('now') - julianday(${col}) > ?`,
        params: [days],
    }
}

function buildHardDeleteQuery(options: LifecycleOptions, scope: CandidateScope): CandidateQuery {
    const { excludeTags, scopedWorkspace, scopedProject } = scope
    const age = ageRangeFilter('deleted_at', options.hardDeleteOlderThanDays)
    const tagExclusion = tagExclusionSql('id', excludeTags)
    const sql = `
            SELECT id, CAST((julianday('now') - julianday(deleted_at)) AS INTEGER) as age_days
            FROM memory_journal
            WHERE deleted_at IS NOT NULL
              ${age.sql}
              ${tagExclusion.sql}
              ${scopedWorkspace !== undefined ? 'AND workspace_id = ?' : ''}
              ${scopedProject !== undefined ? 'AND project_number = ?' : ''}
        `
    const params: unknown[] = [
        ...age.params,
        ...tagExclusion.params,
        ...(scopedWorkspace !== undefined ? [scopedWorkspace] : []),
        ...(scopedProject !== undefined ? [scopedProject] : []),
    ]
    return { sql, params }
}

function buildPruneQuery(
    options: LifecycleOptions,
    scope: CandidateScope,
    importanceExpr: string
): CandidateQuery {
    const { excludeTags, scopedWorkspace, scopedProject } = scope
    const age = ageRangeFilter('e.timestamp', options.pruneOlderThanDays)
    const tagExclusion = tagExclusionSql('e.id', excludeTags)
    const sql = `
            SELECT e.id, ${importanceExpr} as importance_score
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL
              ${age.sql}
              AND ${importanceExpr} < ?
              AND e.significance_type IS NULL
              AND COALESCE(e.impact_score, 0.0) < 0.5
              AND COALESCE(rs.rel_count, 0) = 0
              ${tagExclusion.sql}
              ${scopedWorkspace !== undefined ? 'AND e.workspace_id = ?' : ''}
              ${scopedProject !== undefined ? 'AND e.project_number = ?' : ''}
        `
    const params: unknown[] = [
        ...age.params,
        options.importanceThreshold,
        ...tagExclusion.params,
        ...(scopedWorkspace !== undefined ? [scopedWorkspace] : []),
        ...(scopedProject !== undefined ? [scopedProject] : []),
    ]
    return { sql, params }
}

function buildArchiveQuery(
    options: LifecycleOptions,
    scope: CandidateScope,
    importanceExpr: string
): CandidateQuery {
    const { excludeTags, scopedWorkspace, scopedProject } = scope
    const age = ageRangeFilter('e.timestamp', options.archiveOlderThanDays)
    const tagExclusion = tagExclusionSql('e.id', excludeTags)
    const sql = `
            SELECT e.id, ${importanceExpr} as importance_score
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL AND e.is_archived = 0
            ${age.sql}
            AND ${importanceExpr} < ?
            ${tagExclusion.sql}
            ${scopedWorkspace !== undefined ? 'AND e.workspace_id = ?' : ''}
            ${scopedProject !== undefined ? 'AND e.project_number = ?' : ''}
        `
    const params: unknown[] = [
        ...age.params,
        options.importanceThreshold,
        ...tagExclusion.params,
        ...(scopedWorkspace !== undefined ? [scopedWorkspace] : []),
        ...(scopedProject !== undefined ? [scopedProject] : []),
    ]
    return { sql, params }
}

/** Build the hard-delete, prune and archive candidate SELECT statements with their params. */
function buildCandidateQueries(
    options: LifecycleOptions
): CandidateQueries & { cteParams: unknown[] } {
    const importanceExpr = buildImportanceSqlExpression()
    // Intentional: an omitted workspaceId (or '*') leaves lifecycle operations database-wide;
    // only an explicit workspace id scopes the candidates to that workspace.
    const rawWs = options.workspaceId?.trim()
    const scopedWorkspace =
        rawWs !== undefined && rawWs !== '' && rawWs !== '*' ? rawWs : undefined
    const scope: CandidateScope = {
        excludeTags: expandTagFilterValues(options.excludeTags ?? []),
        scopedWorkspace,
        scopedProject: options.projectNumber,
    }

    return {
        hardDelete: buildHardDeleteQuery(options, scope),
        prune: buildPruneQuery(options, scope, importanceExpr),
        archive: buildArchiveQuery(options, scope, importanceExpr),
        cteParams: scopedWorkspace !== undefined ? [scopedWorkspace] : [],
    }
}

/** Run the candidate SELECTs without mutating anything (dry-run mode). */
function collectDryRun(
    db: NativeDb,
    options: LifecycleOptions,
    queries: CandidateQueries & { cteParams: unknown[] },
    cte: string
): LifecycleResult {
    const candidates = {
        archived: [] as { id: number; importance_score: number }[],
        pruned: [] as { id: number; importance_score: number }[],
        hardDeleted: [] as { id: number; age_days: number }[],
    }

    if (options.hardDeleteOlderThanDays > 0) {
        const rows = db.prepare(queries.hardDelete.sql).all(...queries.hardDelete.params) as {
            id: number | bigint
            age_days: number
        }[]
        candidates.hardDeleted = rows.map((r) => ({
            id: toNumberId(r.id),
            age_days: r.age_days,
        }))
    }
    if (options.pruneOlderThanDays > 0) {
        const sql = `WITH ${cte} ${queries.prune.sql}`
        const rows = db
            .prepare(sql)
            .all(...queries.cteParams, ...queries.prune.params) as {
            id: number | bigint
            importance_score: number
        }[]
        candidates.pruned = rows.map((r) => ({
            id: toNumberId(r.id),
            importance_score: r.importance_score,
        }))
    }
    if (options.archiveOlderThanDays > 0) {
        const sql = `WITH ${cte} ${queries.archive.sql}`
        const rows = db
            .prepare(sql)
            .all(...queries.cteParams, ...queries.archive.params) as {
            id: number | bigint
            importance_score: number
        }[]
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
    const rows = db.prepare(query.sql).all(...query.params) as { id: number | bigint }[]
    const ids = rows.map((r) => toNumberId(r.id))
    let hardDeletedCount = 0
    for (const { placeholders, params } of bucketInParams(ids)) {
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
    const rows = db.prepare(selectSql).all(...cteParams, ...query.params) as {
        id: number | bigint
    }[]
    const ids = rows.map((r) => toNumberId(r.id))
    if (ids.length === 0) return 0

    let prunedCount = 0
    for (const { placeholders, params } of bucketInParams(ids)) {
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
    db.transaction(() => {
        db.exec("INSERT INTO fts_content(fts_content) VALUES ('delete-all')")
        db.exec(
            'INSERT INTO fts_content(rowid, content) SELECT id, content FROM memory_journal WHERE deleted_at IS NULL'
        )
    })()
}

/** Run the hard-delete / prune / archive mutations in a transaction, retrying once after an FTS rebuild. */
function runLifecycleTx(
    db: NativeDb,
    options: LifecycleOptions,
    queries: CandidateQueries & { cteParams: unknown[] },
    cte: string
): LifecycleResult {
    const deletedAt = new Date().toISOString()

    const runTx = db.transaction((): LifecycleResult => {
        const hardDeletedCount =
            options.hardDeleteOlderThanDays > 0
                ? executeHardDeleteStep(db, queries.hardDelete)
                : 0
        const prunedCount =
            options.pruneOlderThanDays > 0
                ? executePruneStep(db, queries.prune, cte, queries.cteParams, deletedAt)
                : 0
        const archivedCount =
            options.archiveOlderThanDays > 0
                ? executeArchiveStep(db, queries.archive, cte, queries.cteParams)
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
        const cte = buildImportanceCte(queries.cteParams.length > 0)

        if (options.dryRun) {
            return collectDryRun(db, options, queries, cte)
        }
        return runLifecycleTx(db, options, queries, cte)
    }
}
