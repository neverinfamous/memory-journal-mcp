import type { EntryType } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import { ALIASED_ENTRY_COLUMNS, type EntriesSharedContext } from '../shared.js'
import {
    buildImportanceSqlExpression,
    buildImportanceCte,
    buildScopedFtsImportanceCte,
} from '../importance.js'
import { sanitizeSearchQuery } from '../../../../utils/security-utils.js'
import { decodeCursor, type SortBy } from './cursor.js'
import { sanitizeFtsQuery } from './fts-sanitizer.js'
import {
    effectiveWorkspace,
    normalizeDateRangeStart,
    normalizeDateRangeEnd,
} from '../../../workspace-scope.js'
import { chunkedInPredicate } from '../../row-helpers.js'
import { expandTagFilterValues } from '../../tags.js'
import {
    excludesCommitNarrative,
    legacyCommitExclusionSql,
} from '../../../../utils/legacy-commit-narrative.js'

export interface SearchQueryOptions {
    limit?: number
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
    sortBy?: SortBy
    includeArchived?: boolean
    includeHighlights?: boolean
    workspaceId?: string
}

export interface SearchPosition {
    offset: number
    hasKeyset: boolean
    keysetT: string
    keysetId: number
}

export function readSearchPosition(options?: { cursor?: string; offset?: number }): SearchPosition {
    let offset = options?.offset ?? 0
    let keysetT = ''
    let keysetId = 0
    let hasKeyset = false
    if (options?.cursor !== undefined && options.cursor !== '') {
        const decoded = decodeCursor(options.cursor)
        if (decoded === null) {
            throw new ValidationError('Invalid pagination cursor. Re-run the search without a cursor.')
        }
        if ('t' in decoded) {
            hasKeyset = true
            offset = 0
            keysetT = decoded.t
            keysetId = decoded.id
        } else {
            offset = decoded.offset
        }
    }
    return { offset, hasKeyset, keysetT, keysetId }
}

function buildBaseSelect(
    options: SearchQueryOptions | undefined,
    useFts: boolean,
    targetWs: string,
    hasQuery: boolean,
    useMaterializedFtsOuter: boolean
): string {
    const needsImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    const importanceCol = needsImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''

    let ctePrefix = ''
    if (needsImportance) {
        ctePrefix =
            useFts && hasQuery
                ? `WITH ${buildScopedFtsImportanceCte(targetWs !== '*')}`
                : `WITH ${buildImportanceCte(targetWs !== '*')}`
    }
    const joinClause = needsImportance
        ? `LEFT JOIN rel_stats rs ON e.id = rs.entry_id LEFT JOIN anchor_stats ans ON e.id = ans.entry_id`
        : ''

    const snippetCol =
        !useMaterializedFtsOuter && useFts && options?.includeHighlights === true
            ? ", snippet(fts_content, 0, '«', '»', '…', 64) AS highlight_snippet"
            : ''

    if (useMaterializedFtsOuter) {
        return `
            ${ctePrefix}
            SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol}
            FROM fts_hits fts
            CROSS JOIN memory_journal e ON e.id = fts.entry_id
            ${joinClause}
        `
    }

    if (useFts) {
        return `
            ${ctePrefix}
            SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol}${snippetCol}
            FROM fts_content fts
            CROSS JOIN memory_journal e ON e.id = fts.rowid
            ${joinClause}
        `
    }
    return `
            ${ctePrefix}
            SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol}
            FROM memory_journal e
            ${joinClause}
        `
}

function entryTagExistsSql(placeholders: string, negated: boolean): string {
    const exists = `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND LOWER(t.name) IN (${placeholders}))`
    return negated ? `NOT ${exists}` : exists
}

function appendTagMembership(
    conditions: string[],
    params: unknown[],
    tags: string[] | undefined,
    negated: boolean
): string[] {
    if (tags === undefined || tags.length === 0) return []
    const expanded = expandTagFilterValues(tags)
    if (expanded.length === 0) return []
    const membership = chunkedInPredicate(
        expanded,
        (placeholders) => entryTagExistsSql(placeholders, negated),
        negated ? 'AND' : 'OR'
    )
    conditions.push(membership.sql)
    params.push(...membership.params)
    return expanded
}

function appendFilterConditions(
    conditions: string[],
    params: unknown[],
    options: SearchQueryOptions | undefined
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
    appendTagMembership(conditions, params, options?.tags, false)
    const expandedExcludedTags = appendTagMembership(conditions, params, options?.excludeTags, true)
    // [INVARIANT] M1 read-side fallback: untagged legacy session-commits rows are also excluded.
    if (expandedExcludedTags.length > 0 && excludesCommitNarrative(expandedExcludedTags)) {
        conditions.push(legacyCommitExclusionSql('e'))
    }
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

export function buildSearchQuery(
    queryStr: string,
    options: SearchQueryOptions | undefined,
    useFts: boolean,
    offset: number,
    hasKeyset: boolean,
    keysetT: string,
    keysetId: number
): { sql: string; params: unknown[] } {
    const needsImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    const targetWs = effectiveWorkspace(options?.workspaceId)
    const hasQuery = queryStr.length > 0
    const sanitizedFts = useFts && hasQuery ? sanitizeFtsQuery(queryStr) : ''
    const useMaterializedFtsOuter = needsImportance && useFts && hasQuery
    let query = buildBaseSelect(options, useFts, targetWs, hasQuery, useMaterializedFtsOuter)

    const params: unknown[] = []
    if (needsImportance) {
        if (useFts && hasQuery) {
            params.push(sanitizedFts)
            if (targetWs !== '*') params.push(targetWs)
        } else if (targetWs !== '*') {
            params.push(targetWs)
        }
    }
    const conditions: string[] = ['e.deleted_at IS NULL']

    if (targetWs !== '*' && !useMaterializedFtsOuter) {
        conditions.push('e.workspace_id = ?')
        params.push(targetWs)
    }
    if (options?.includeArchived !== true) {
        conditions.push('e.is_archived = 0')
    }
    if (hasQuery) {
        if (useFts && !useMaterializedFtsOuter) {
            conditions.push(`fts_content MATCH ?`)
            params.push(sanitizedFts)
        } else if (!useFts) {
            conditions.push(`e.content LIKE '%' || ? || '%' ESCAPE '\\'`)
            params.push(sanitizeSearchQuery(queryStr))
        }
    }

    appendFilterConditions(conditions, params, options)

    if (hasKeyset) {
        if (useFts || needsImportance) {
            throw new ValidationError(
                'Timestamp keyset cursor cannot be used with FTS or importance-sorted queries; omit cursor or re-run from page 1.'
            )
        }
        conditions.push(`(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))`)
        params.push(keysetT, keysetT, keysetId)
    }

    if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`
    }

    if (options?.sortBy === 'blended' && useFts) {
        const rankExpr = useMaterializedFtsOuter ? 'fts.fts_rank' : 'rank'
        query += ` ORDER BY ((-${rankExpr}) * (1.0 + 0.35 * importanceScore)) DESC, e.timestamp DESC, e.id DESC`
    } else if (needsImportance) {
        query += ` ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC`
    } else if (useFts) {
        query += ` ORDER BY rank, e.timestamp DESC, e.id DESC`
    } else {
        query += ` ORDER BY e.timestamp DESC, e.id DESC`
    }

    query += ` LIMIT ? OFFSET ?`
    params.push(options?.limit ?? 10, offset)

    return { sql: query, params }
}

export type { EntriesSharedContext }
