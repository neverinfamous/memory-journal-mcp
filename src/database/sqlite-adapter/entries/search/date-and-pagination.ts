import type { JournalEntry, EntryType } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import {
    ENTRY_COLUMNS,
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import { buildImportanceSqlExpression, buildImportanceCte } from '../importance.js'
import { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
import { effectiveWorkspace } from '../../../workspace-scope.js'
import { expandTagFilterValues } from '../../tags.js'

/** Importance-ranked page of recent entries (offset-paginated). */
function getRecentEntriesByImportance(
    context: EntriesSharedContext,
    limit: number,
    cursor: string | undefined,
    includeArchived: boolean,
    workspaceId: string,
    projectNumber: number | undefined,
    offset: number
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context

    let actualOffset = offset
    if (cursor !== undefined && cursor !== '') {
        const decoded = decodeCursor(cursor)
        if (decoded === null) {
            throw new ValidationError('Invalid cursor format')
        }
        if ('offset' in decoded) {
            actualOffset = decoded.offset
        } else {
            throw new ValidationError(
                'Timestamp keyset cursor cannot be used with importance sorting; omit cursor or re-run from page 1.'
            )
        }
    }
    const importanceExpr = buildImportanceSqlExpression()
    const scoped = workspaceId !== '*'
    const cte = buildImportanceCte(scoped)

    const params: unknown[] = []
    if (scoped) params.push(workspaceId)
    if (scoped) params.push(workspaceId)
    if (projectNumber !== undefined) params.push(projectNumber)
    params.push(limit, actualOffset)

    const stmt = db.prepare(`
            WITH ${cte}
            SELECT ${ALIASED_ENTRY_COLUMNS}, ${importanceExpr} AS importanceScore
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL ${!includeArchived ? 'AND e.is_archived = 0' : ''} ${workspaceId !== '*' ? 'AND e.workspace_id = ?' : ''} ${projectNumber !== undefined ? 'AND e.project_number = ?' : ''}
            ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC LIMIT ? OFFSET ?
        `)
    const rows = stmt.all(params)
    const entries = rowsToEntries(tagsMgr, rows)

    if (entries.length === limit && limit > 0) {
        return { entries, nextCursor: encodeCursor({ offset: actualOffset + limit }) }
    }
    return { entries }
}

function decodeRecentTimestampCursor(
    cursor: string | undefined,
    offset: number
): { cursorCondition: string; cursorParams: unknown[]; effectiveOffset: number } {
    let cursorCondition = ''
    const cursorParams: unknown[] = []
    let effectiveOffset = offset
    if (cursor !== undefined && cursor !== '') {
        const decoded = decodeCursor(cursor)
        if (decoded === null) {
            throw new ValidationError('Invalid cursor format')
        }
        if ('t' in decoded) {
            cursorCondition = ' AND (timestamp < ? OR (timestamp = ? AND id < ?))'
            cursorParams.push(decoded.t, decoded.t, decoded.id)
        } else if ('offset' in decoded) {
            effectiveOffset = decoded.offset
        }
    }
    return { cursorCondition, cursorParams, effectiveOffset }
}

export function getRecentEntries(
    context: EntriesSharedContext,
    limit: number,
    sortBy: SortBy = 'timestamp',
    cursor?: string,
    includeArchived = false,
    workspaceId = 'default',
    projectNumber?: number,
    offset = 0
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)

    if (sortBy === 'importance') {
        return getRecentEntriesByImportance(
            context,
            limit,
            cursor,
            includeArchived,
            scopeId,
            projectNumber,
            offset
        )
    }

    const params: unknown[] = []
    if (scopeId !== '*') {
        params.push(scopeId)
    }

    let projectCondition = ''
    if (projectNumber !== undefined) {
        projectCondition = ' AND project_number = ?'
        params.push(projectNumber)
    }

    const { cursorCondition, cursorParams, effectiveOffset } = decodeRecentTimestampCursor(
        cursor,
        offset
    )
    params.push(...cursorParams)

    const offsetClause = cursorCondition === '' && effectiveOffset > 0 ? ' OFFSET ?' : ''
    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL ${!includeArchived ? 'AND is_archived = 0' : ''} ${scopeId !== '*' ? 'AND workspace_id = ?' : ''} ${projectCondition} ${cursorCondition}
        ORDER BY timestamp DESC, id DESC LIMIT ?${offsetClause}
    `)
    params.push(limit)
    if (offsetClause !== '') {
        params.push(effectiveOffset)
    }
    const rows = stmt.all(params)
    const entries = rowsToEntries(tagsMgr, rows)

    if (entries.length === limit && limit > 0) {
        if (cursorCondition === '' && effectiveOffset > 0) {
            return { entries, nextCursor: encodeCursor({ offset: effectiveOffset + limit }) }
        }
        const last = entries[entries.length - 1]
        if (last !== undefined) {
            return { entries, nextCursor: encodeCursor({ t: last.timestamp, id: last.id }) }
        }
    }

    return { entries }
}

export function getEntriesPage(
    context: EntriesSharedContext,
    offset: number,
    limit: number,
    order: 'asc' | 'desc' = 'desc',
    workspaceId = 'default',
    projectNumber?: number
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)

    const sortDir = order === 'asc' ? 'ASC' : 'DESC'
    const scoped = scopeId !== '*'
    const projectSql = projectNumber !== undefined ? ' AND project_number = ?' : ''

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL ${scoped ? 'AND workspace_id = ?' : ''}${projectSql}
        ORDER BY timestamp ${sortDir}, id ${sortDir} 
        LIMIT ? OFFSET ?
    `)
    const projectParam = projectNumber !== undefined ? [projectNumber] : []
    const rows = scoped
        ? stmt.all([scopeId, ...projectParam, limit, offset])
        : stmt.all([...projectParam, limit, offset])
    const entries = rowsToEntries(tagsMgr, rows)

    if (entries.length === limit && limit > 0) {
        return { entries, nextCursor: encodeCursor({ offset: offset + limit }) }
    }

    return { entries }
}

interface DateRangeQueryOptions {
    entryType?: EntryType
    tags?: string[]
    cursor?: string
    isPersonal?: boolean
    projectNumber?: number
    issueNumber?: number
    prNumber?: number
    workflowRunId?: number
    limit?: number
    sortBy?: SortBy
    includeArchived?: boolean
    workspaceId?: string
}

function buildDateRangeQuery(
    startDate: string,
    endDate: string,
    options: DateRangeQueryOptions | undefined
): { sql: string; params: unknown[]; useImportance: boolean; offset: number; limit: number } {
    let start = startDate
    if (!start.includes('T')) start += 'T00:00:00.000Z'

    const conditions = ['e.deleted_at IS NULL', 'e.timestamp >= ?']
    const params: unknown[] = [start]

    const targetWs = effectiveWorkspace(options?.workspaceId)
    if (targetWs !== '*') {
        conditions.push('e.workspace_id = ?')
        params.push(targetWs)
    }
    if (options?.includeArchived !== true) {
        conditions.push('e.is_archived = 0')
    }
    if (endDate.length > 0) {
        conditions.push('e.timestamp <= ?')
        let end = endDate
        if (!end.includes('T')) end += 'T23:59:59.999Z'
        params.push(end)
    }

    const useImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    const importanceCol = useImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''
    const { offset, hasKeyset, keysetT, keysetId } = decodeDateRangeCursor(options?.cursor)

    const scopedCte = targetWs !== '*'
    if (useImportance && scopedCte) {
        params.unshift(targetWs)
    }
    let query = useImportance ? `WITH ${buildImportanceCte(scopedCte)} ` : ''
    query += `
        SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol} FROM memory_journal e
    `
    if (useImportance) {
        query += `LEFT JOIN rel_stats rs ON e.id = rs.entry_id `
        query += `LEFT JOIN anchor_stats ans ON e.id = ans.entry_id `
    }

    appendDateRangeFilters(conditions, params, options)

    if (hasKeyset) {
        if (useImportance) {
            throw new ValidationError(
                'Timestamp keyset cursor cannot be used with importance sorting; omit cursor or re-run from page 1.'
            )
        }
        conditions.push(`(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))`)
        params.push(keysetT, keysetT, keysetId)
    }

    const orderBy = useImportance
        ? 'importanceScore DESC, e.timestamp DESC, e.id DESC'
        : 'e.timestamp DESC, e.id DESC'
    const limit = options?.limit ?? 500
    query += ` WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    params.push(limit, offset)

    return { sql: query, params, useImportance, offset, limit }
}

export function searchByDateRange(
    context: EntriesSharedContext,
    startDate: string,
    endDate: string,
    options?: DateRangeQueryOptions
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context
    const { sql, params, useImportance, offset, limit } = buildDateRangeQuery(
        startDate,
        endDate,
        options
    )
    const rows = db.prepare(sql).all(params)
    const entries = rowsToEntries(tagsMgr, rows)

    if (entries.length === limit && limit > 0) {
        if (!useImportance) {
            const last = entries[entries.length - 1]
            if (last !== undefined) {
                return { entries, nextCursor: encodeCursor({ t: last.timestamp, id: last.id }) }
            }
        } else {
            return { entries, nextCursor: encodeCursor({ offset: offset + limit }) }
        }
    }

    return { entries }
}

/**
 * Decodes a pagination cursor into keyset/offset state for searchByDateRange.
 */
function decodeDateRangeCursor(cursor: string | undefined): {
    offset: number
    hasKeyset: boolean
    keysetT: string
    keysetId: number
} {
    let offset = 0
    let hasKeyset = false
    let keysetT = ''
    let keysetId = 0
    if (cursor !== undefined && cursor !== '') {
        const decoded = decodeCursor(cursor)
        if (decoded === null) {
            throw new ValidationError('Invalid cursor format')
        }
        if ('t' in decoded) {
            hasKeyset = true
            keysetT = decoded.t
            keysetId = decoded.id
        } else if ('offset' in decoded) {
            offset = decoded.offset
        }
    }
    return { offset, hasKeyset, keysetT, keysetId }
}

/**
 * Appends the optional tag/type/attribute filter conditions for searchByDateRange.
 */
function appendDateRangeFilters(
    conditions: string[],
    params: unknown[],
    options:
        | {
              entryType?: EntryType
              tags?: string[]
              isPersonal?: boolean
              projectNumber?: number
              issueNumber?: number
              prNumber?: number
              workflowRunId?: number
          }
        | undefined
): void {
    if (options?.tags !== undefined && options.tags.length > 0) {
        const expandedTags = expandTagFilterValues(options.tags)
        if (expandedTags.length > 0) {
            const placeholders = expandedTags.map(() => '?').join(',')
            conditions.push(
                `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND LOWER(t.name) IN (${placeholders}))`
            )
            params.push(...expandedTags)
        }
    }

    if (options?.entryType !== undefined) {
        conditions.push(`e.entry_type = ?`)
        params.push(options.entryType)
    }

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

    if (options?.workflowRunId !== undefined) {
        conditions.push(`e.workflow_run_id = ?`)
        params.push(options.workflowRunId)
    }
}
