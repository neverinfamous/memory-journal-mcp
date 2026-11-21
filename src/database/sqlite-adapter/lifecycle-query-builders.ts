import {
    buildImportanceCte,
    buildImportanceSqlExpression,
    buildStatsCteBody,
} from './entries/importance.js'
import { expandTagFilterValues } from './tags.js'
import { bucketInParams, SCOPED_IN_PARAM_BUCKETS } from './row-helpers.js'

export interface LifecycleOptions {
    archiveOlderThanDays: number
    pruneOlderThanDays: number
    hardDeleteOlderThanDays: number
    importanceThreshold: number
    dryRun?: boolean
    excludeTags?: string[]
    workspaceId?: string
    projectNumber?: number
}

export interface LifecycleResult {
    archivedCount: number
    prunedCount: number
    hardDeletedCount: number
    candidates?: {
        archived: { id: number; importance_score: number }[]
        pruned: { id: number; importance_score: number }[]
        hardDeleted: { id: number; age_days: number }[]
    }
}

export interface CandidateQuery {
    sql: string
    params: unknown[]
}

export interface CandidateQueries {
    hardDelete: CandidateQuery
    prune: CandidateQuery
    archive: CandidateQuery
    cte: string
    cteParams: unknown[]
}

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
    if (tags.length > 240) {
        return {
            sql: `AND NOT EXISTS (
                SELECT 1 FROM entry_tags
                JOIN tags ON tags.id = entry_tags.tag_id
                WHERE entry_tags.entry_id = ${idColumn}
                  AND LOWER(tags.name) IN (SELECT value FROM json_each(?))
            )`,
            params: [JSON.stringify(tags)],
        }
    }
    const parts: string[] = []
    const params: string[] = []
    for (const chunk of bucketInParams(tags, SCOPED_IN_PARAM_BUCKETS)) {
        parts.push(
            `AND NOT EXISTS (
                SELECT 1 FROM entry_tags
                JOIN tags ON tags.id = entry_tags.tag_id
                WHERE entry_tags.entry_id = ${idColumn}
                  AND LOWER(tags.name) IN (${chunk.placeholders})
            )`
        )
        params.push(...chunk.params)
    }
    return { sql: parts.join('\n'), params }
}

function resolveLifecycleUpperIso(options: LifecycleOptions): string | undefined {
    const activeDays: number[] = []
    if (options.pruneOlderThanDays > 0) activeDays.push(options.pruneOlderThanDays)
    if (options.archiveOlderThanDays > 0) activeDays.push(options.archiveOlderThanDays)
    if (activeDays.length === 0 || activeDays.some((d) => d <= 1)) return undefined
    const minDays = Math.min(...activeDays)
    return new Date(Date.now() - (minDays - 1) * 86_400_000).toISOString()
}

function buildLifecycleImportanceCte(
    scopedWorkspace: string | undefined,
    upperIso: string | undefined
): { cte: string; cteParams: unknown[] } {
    if (scopedWorkspace === undefined && upperIso === undefined) {
        return { cte: buildImportanceCte(false), cteParams: [] }
    }
    const conditions = ['deleted_at IS NULL']
    const cteParams: unknown[] = []
    if (scopedWorkspace !== undefined) {
        conditions.push('workspace_id = ?')
        cteParams.push(scopedWorkspace)
    }
    if (upperIso !== undefined) {
        conditions.push('timestamp < ?')
        cteParams.push(upperIso)
    }
    const cte = `
        seed_entries AS MATERIALIZED (
            SELECT id, workspace_id FROM memory_journal WHERE ${conditions.join(' AND ')}
        ),${buildStatsCteBody({ name: 'seed_entries', col: 'id' }, scopedWorkspace !== undefined)}
    `
    return { cte, cteParams }
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
export function buildCandidateQueries(options: LifecycleOptions): CandidateQueries {
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
    const upperIso = resolveLifecycleUpperIso(options)
    const { cte, cteParams } = buildLifecycleImportanceCte(scopedWorkspace, upperIso)

    return {
        hardDelete: buildHardDeleteQuery(options, scope),
        prune: buildPruneQuery(options, scope, importanceExpr),
        archive: buildArchiveQuery(options, scope, importanceExpr),
        cte,
        cteParams,
    }
}
