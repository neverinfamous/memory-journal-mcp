import type { EntryType } from '../../../../types/index.js'
import { type EntriesSharedContext } from '../shared.js'
import { isFts5QueryError, sanitizeFtsQuery } from './fts-sanitizer.js'
import {
    effectiveWorkspace,
    normalizeDateRangeStart,
    normalizeDateRangeEnd,
} from '../../../workspace-scope.js'
import { sanitizeSearchQuery } from '../../../../utils/security-utils.js'
import { chunkedInPredicate, DUAL_IN_PARAM_BUCKETS } from '../../row-helpers.js'
import { expandTagFilterValues } from '../../tags.js'
import {
    excludesCommitNarrative,
    legacyCommitExclusionSql,
} from '../../../../utils/legacy-commit-narrative.js'

export interface SearchFacetOptions {
    isPersonal?: boolean
    projectNumber?: number
    issueNumber?: number
    prNumber?: number
    prStatus?: string
    workflowRunId?: number
    tags?: string[]
    excludeTags?: string[]
    entryType?: EntryType
    startDate?: string
    endDate?: string
    includeArchived?: boolean
    workspaceId?: string
}

export function getSearchFacets(
    context: EntriesSharedContext,
    queryStr: string,
    options?: SearchFacetOptions
): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[]; degraded?: boolean } {
    const { db } = context
    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    const targetWs = effectiveWorkspace(options?.workspaceId)
    if (targetWs !== '*') {
        conditions.push('e.workspace_id = ?')
        params.push(targetWs)
    }

    if (options?.includeArchived !== true) {
        conditions.push('e.is_archived = 0')
    }

    const useFts = queryStr.length > 0
    const sanitizedQuery = useFts ? sanitizeFtsQuery(queryStr) : ''
    const escapedLikeQuery = useFts ? sanitizeSearchQuery(queryStr) : ''
    const fallbackToLike = useFts && sanitizedQuery === ''

    if (useFts && !fallbackToLike) {
        conditions.push(`fts_content MATCH ?`)
        params.push(sanitizedQuery)
    } else if (fallbackToLike) {
        conditions.push(`e.content LIKE '%' || ? || '%' ESCAPE '\\'`)
        params.push(escapedLikeQuery)
    }

    const expandedFilterTags =
        options?.tags !== undefined && options.tags.length > 0
            ? expandTagFilterValues(options.tags)
            : []
    const baseConditions = [...conditions]
    const baseParams = [...params]
    appendFacetFilterConditions(baseConditions, baseParams, {
        ...options,
        tags: undefined,
    })

    const entryTypeConditions = [...conditions]
    const entryTypeParams = [...params]
    if (expandedFilterTags.length > 0) {
        const membership = chunkedInPredicate(
            expandedFilterTags,
            (placeholders) =>
                `EXISTS (SELECT 1 FROM entry_tags et_f JOIN tags t_f ON et_f.tag_id = t_f.id WHERE et_f.entry_id = e.id AND LOWER(t_f.name) IN (${placeholders}))`,
            'OR'
        )
        entryTypeConditions.push(membership.sql)
        entryTypeParams.push(...membership.params)
    }

    appendFacetFilterConditions(conditions, params, options)
    appendFacetFilterConditions(entryTypeConditions, entryTypeParams, {
        ...options,
        tags: undefined,
    })

    const result = executeFacetCountQueries(
        db,
        useFts && !fallbackToLike,
        conditions,
        params,
        entryTypeConditions,
        entryTypeParams,
        escapedLikeQuery,
        baseConditions,
        baseParams,
        expandedFilterTags
    )
    return fallbackToLike ? { ...result, degraded: true } : result
}

function buildFtsFacetTagClauses(
    expandedFilterTags: string[],
    baseParamCount: number
): {
    filterTagsCte: string
    filterTagsParams: unknown[]
    tagFilterSql: string
    tagFilterParams: unknown[]
    typeFilterSql: string
    typeFilterParams: unknown[]
} {
    if (expandedFilterTags.length === 0) {
        return {
            filterTagsCte: '',
            filterTagsParams: [],
            tagFilterSql: '',
            tagFilterParams: [],
            typeFilterSql: '',
            typeFilterParams: [],
        }
    }
    // [INVARIANT] M3: Keep combined multi-CTE binds safely <= 500 when excludeTags + tags are large.
    const paddedTagBinds =
        DUAL_IN_PARAM_BUCKETS.find((b) => b >= expandedFilterTags.length) ?? 240
    if (expandedFilterTags.length > 240 || baseParamCount + paddedTagBinds * 2 > 480) {
        return {
            filterTagsCte: 'filter_tags AS MATERIALIZED (SELECT value AS name FROM json_each(?)),\n        ',
            filterTagsParams: [JSON.stringify(expandedFilterTags)],
            tagFilterSql: 'WHERE LOWER(t.name) IN (SELECT name FROM filter_tags)',
            tagFilterParams: [],
            typeFilterSql:
                'WHERE EXISTS (SELECT 1 FROM entry_tags et_f JOIN tags t_f ON et_f.tag_id = t_f.id WHERE et_f.entry_id = b.id AND LOWER(t_f.name) IN (SELECT name FROM filter_tags))',
            typeFilterParams: [],
        }
    }
    const tagPred = chunkedInPredicate(
        expandedFilterTags,
        (placeholders) => `LOWER(t.name) IN (${placeholders})`,
        'OR'
    )
    const typePred = chunkedInPredicate(
        expandedFilterTags,
        (placeholders) =>
            `EXISTS (SELECT 1 FROM entry_tags et_f JOIN tags t_f ON et_f.tag_id = t_f.id WHERE et_f.entry_id = b.id AND LOWER(t_f.name) IN (${placeholders}))`,
        'OR'
    )
    return {
        filterTagsCte: '',
        filterTagsParams: [],
        tagFilterSql: `WHERE ${tagPred.sql}`,
        tagFilterParams: tagPred.params,
        typeFilterSql: `WHERE ${typePred.sql}`,
        typeFilterParams: typePred.params,
    }
}

function executeMaterializedFtsFacetQuery(
    db: EntriesSharedContext['db'],
    baseConditions: string[],
    baseParams: unknown[],
    expandedFilterTags: string[]
): { tagsRows: { name: string; cnt: number }[]; entryTypesRows: { name: string; cnt: number }[] } {
    const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : ''
    const {
        filterTagsCte,
        filterTagsParams,
        tagFilterSql,
        tagFilterParams,
        typeFilterSql,
        typeFilterParams,
    } = buildFtsFacetTagClauses(expandedFilterTags, baseParams.length)
    const sql = `
        WITH ${filterTagsCte}fts_base AS MATERIALIZED (
            SELECT e.id, e.entry_type
            FROM fts_content fts
            CROSS JOIN memory_journal e ON e.id = fts.rowid
            ${baseWhere}
        ),
        tag_facets AS (
            SELECT 'tag' AS kind, t.name AS name, COUNT(*) AS cnt
            FROM fts_base b
            JOIN entry_tags et ON b.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
            ${tagFilterSql}
            GROUP BY t.name ORDER BY cnt DESC LIMIT 20
        ),
        type_facets AS (
            SELECT 'type' AS kind, b.entry_type AS name, COUNT(*) AS cnt
            FROM fts_base b
            ${typeFilterSql}
            GROUP BY b.entry_type ORDER BY cnt DESC
        )
        SELECT kind, name, cnt FROM tag_facets
        UNION ALL
        SELECT kind, name, cnt FROM type_facets
        ORDER BY kind ASC, cnt DESC
    `
    const rows = db
        .prepare(sql)
        .all(...filterTagsParams, ...baseParams, ...tagFilterParams, ...typeFilterParams) as {
        kind: string
        name: string
        cnt: number
    }[]
    const tagsRows: { name: string; cnt: number }[] = []
    const entryTypesRows: { name: string; cnt: number }[] = []
    for (const row of rows) {
        if (row.kind === 'tag') tagsRows.push({ name: row.name, cnt: row.cnt })
        else entryTypesRows.push({ name: row.name, cnt: row.cnt })
    }
    return { tagsRows, entryTypesRows }
}

function replaceFtsMatchWithLike(
    conditions: string[],
    params: unknown[],
    likeQuery: string
): { conditions: string[]; params: unknown[] } {
    const nextConditions: string[] = []
    const nextParams: unknown[] = []
    let paramIndex = 0
    for (const condition of conditions) {
        const marks = condition.match(/\?/g)?.length ?? 0
        if (condition.includes('fts_content MATCH')) {
            nextConditions.push(`e.content LIKE '%' || ? || '%' ESCAPE '\\'`)
            nextParams.push(likeQuery)
            paramIndex += marks
            continue
        }
        nextConditions.push(condition)
        for (let i = 0; i < marks; i++) {
            nextParams.push(params[paramIndex])
            paramIndex += 1
        }
    }
    return { conditions: nextConditions, params: nextParams }
}

function executeFacetCountQueries(
    db: EntriesSharedContext['db'],
    useFts: boolean,
    conditions: string[],
    params: unknown[],
    entryTypeConditions: string[],
    entryTypeParams: unknown[],
    likeFallbackQuery?: string,
    baseConditions: string[] = [],
    baseParams: unknown[] = [],
    expandedFilterTags: string[] = []
): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[]; degraded?: boolean } {
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const entryTypesWhere =
        entryTypeConditions.length > 0 ? `WHERE ${entryTypeConditions.join(' AND ')}` : ''

    let tagsRows: { name: string; cnt: number }[]
    let entryTypesRows: { name: string; cnt: number }[]
    try {
        if (useFts) {
            const combined = executeMaterializedFtsFacetQuery(
                db,
                baseConditions,
                baseParams,
                expandedFilterTags
            )
            tagsRows = combined.tagsRows
            entryTypesRows = combined.entryTypesRows
        } else {
            const tagsSql = `
                SELECT t.name, COUNT(*) AS cnt
                FROM memory_journal e
                JOIN entry_tags et ON e.id = et.entry_id
                JOIN tags t ON et.tag_id = t.id
                ${whereClause}
                GROUP BY t.name ORDER BY cnt DESC LIMIT 20
            `
            const entryTypesSql = `
                SELECT e.entry_type AS name, COUNT(*) AS cnt
                FROM memory_journal e
                ${entryTypesWhere}
                GROUP BY e.entry_type ORDER BY cnt DESC
            `
            tagsRows = db.prepare(tagsSql).all(params) as { name: string; cnt: number }[]
            entryTypesRows = db.prepare(entryTypesSql).all(entryTypeParams) as {
                name: string
                cnt: number
            }[]
        }
    } catch (err) {
        if (useFts && isFts5QueryError(err)) {
            const tags = replaceFtsMatchWithLike(conditions, params, likeFallbackQuery ?? '')
            const types = replaceFtsMatchWithLike(
                entryTypeConditions,
                entryTypeParams,
                likeFallbackQuery ?? ''
            )
            const retried = executeFacetCountQueries(
                db,
                false,
                tags.conditions,
                tags.params,
                types.conditions,
                types.params
            )
            return { ...retried, degraded: true }
        }
        throw err
    }

    return {
        tags: tagsRows.map((r) => ({ name: r.name, count: r.cnt })),
        entryTypes: entryTypesRows.map((r) => ({ name: r.name, count: r.cnt })),
    }
}

function appendFacetTagFilters(
    conditions: string[],
    params: unknown[],
    options: SearchFacetOptions | undefined
): void {
    if (options?.tags !== undefined && options.tags.length > 0) {
        const expandedTags = expandTagFilterValues(options.tags)
        if (expandedTags.length > 0) {
            const membership = chunkedInPredicate(
                expandedTags,
                (placeholders) => `LOWER(t.name) IN (${placeholders})`,
                'OR'
            )
            conditions.push(membership.sql)
            params.push(...membership.params)
        }
    }

    if (options?.excludeTags !== undefined && options.excludeTags.length > 0) {
        const expandedExcluded = expandTagFilterValues(options.excludeTags)
        if (expandedExcluded.length > 0) {
            const membership = chunkedInPredicate(
                expandedExcluded,
                (placeholders) =>
                    `NOT EXISTS (SELECT 1 FROM entry_tags et_ex JOIN tags t_ex ON et_ex.tag_id = t_ex.id WHERE et_ex.entry_id = e.id AND LOWER(t_ex.name) IN (${placeholders}))`,
                'AND'
            )
            conditions.push(membership.sql)
            params.push(...membership.params)
        }
        // [INVARIANT] M1 read-side fallback: untagged legacy session-commits rows are also excluded.
        if (excludesCommitNarrative(expandedExcluded)) {
            conditions.push(legacyCommitExclusionSql('e'))
        }
    }
}

/**
 * Appends the optional attribute/tag/date filter conditions for getSearchFacets.
 */
function appendFacetFilterConditions(
    conditions: string[],
    params: unknown[],
    options: SearchFacetOptions | undefined
): void {
    if (options?.isPersonal !== undefined) {
        conditions.push(`e.is_personal = ?`)
        params.push(options.isPersonal ? 1 : 0)
    }
    if (options?.projectNumber !== undefined) {
        conditions.push(`e.project_number = ?`)
        params.push(options.projectNumber)
    }
    if (options?.issueNumber !== undefined) {
        conditions.push(`e.issue_number = ?`)
        params.push(options.issueNumber)
    }
    if (options?.prNumber !== undefined) {
        conditions.push(`e.pr_number = ?`)
        params.push(options.prNumber)
    }
    if (options?.prStatus !== undefined) {
        conditions.push(`e.pr_status = ?`)
        params.push(options.prStatus)
    }
    if (options?.workflowRunId !== undefined) {
        conditions.push(`e.workflow_run_id = ?`)
        params.push(options.workflowRunId)
    }
    appendFacetTagFilters(conditions, params, options)
    if (options?.entryType !== undefined) {
        conditions.push(`e.entry_type = ?`)
        params.push(options.entryType)
    }
    if (options?.startDate !== undefined && options.startDate.length > 0) {
        conditions.push(`e.timestamp >= ?`)
        params.push(normalizeDateRangeStart(options.startDate))
    }
    if (options?.endDate !== undefined && options.endDate.length > 0) {
        conditions.push(`e.timestamp <= ?`)
        params.push(normalizeDateRangeEnd(options.endDate))
    }
}
