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
import {
    effectiveWorkspace,
    normalizeDateRangeStart,
    normalizeDateRangeEnd,
} from '../../../workspace-scope.js'
import { appendDateRangeFilters, decodeDateRangeCursor } from './date-range-filters.js'

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
    const hasProject = projectNumber !== undefined
    const cte = buildImportanceCte(scoped, {
        projectNumber: hasProject,
        includeArchived,
    })

    const params: unknown[] = []
    if (scoped) params.push(workspaceId)
    if (hasProject) params.push(projectNumber)
    if (scoped) params.push(workspaceId)
    if (hasProject) params.push(projectNumber)
    params.push(limit, actualOffset)

    const stmt = db.prepare(`
            WITH ${cte},
            top_ids AS MATERIALIZED (
                SELECT e.id, ${importanceExpr} AS importanceScore
                FROM memory_journal e
                LEFT JOIN rel_stats rs ON e.id = rs.entry_id
                LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
                WHERE e.deleted_at IS NULL ${!includeArchived ? 'AND e.is_archived = 0' : ''} ${scoped ? 'AND e.workspace_id = ?' : ''} ${hasProject ? 'AND e.project_number = ?' : ''}
                ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC
                LIMIT ? OFFSET ?
            )
            SELECT ${ALIASED_ENTRY_COLUMNS}, top.importanceScore
            FROM top_ids top
            JOIN memory_journal e ON e.id = top.id
            ORDER BY top.importanceScore DESC, e.timestamp DESC, e.id DESC
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
    excludeTags?: string[]
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
    const conditions = ['e.deleted_at IS NULL']
    const params: unknown[] = []

    if (startDate.length > 0) {
        conditions.push('e.timestamp >= ?')
        params.push(normalizeDateRangeStart(startDate))
    }

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
        params.push(normalizeDateRangeEnd(endDate))
    }

    const useImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    const { offset, hasKeyset, keysetT, keysetId } = decodeDateRangeCursor(options?.cursor)

    const scopedCte = targetWs !== '*'
    const hasProject = options?.projectNumber !== undefined
    const includeArchived = options?.includeArchived === true
    if (useImportance) {
        const cteParams: unknown[] = []
        if (scopedCte) cteParams.push(targetWs)
        if (hasProject) cteParams.push(options.projectNumber)
        params.unshift(...cteParams)
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

    const limit = options?.limit ?? 500
    params.push(limit, offset)
    const sql = formatDateRangeSql(conditions, useImportance, scopedCte, hasProject, includeArchived)
    return { sql, params, useImportance, offset, limit }
}

function formatDateRangeSql(
    conditions: string[],
    useImportance: boolean,
    scopedCte: boolean,
    hasProject: boolean,
    includeArchived: boolean
): string {
    if (!useImportance) {
        return `
            SELECT ${ALIASED_ENTRY_COLUMNS} FROM memory_journal e
            WHERE ${conditions.join(' AND ')} ORDER BY e.timestamp DESC, e.id DESC LIMIT ? OFFSET ?
        `
    }
    const cte = buildImportanceCte(scopedCte, { projectNumber: hasProject, includeArchived })
    return `
        WITH ${cte},
        top_ids AS MATERIALIZED (
            SELECT e.id, ${buildImportanceSqlExpression()} AS importanceScore
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC
            LIMIT ? OFFSET ?
        )
        SELECT ${ALIASED_ENTRY_COLUMNS}, top.importanceScore
        FROM top_ids top
        JOIN memory_journal e ON e.id = top.id
        ORDER BY top.importanceScore DESC, e.timestamp DESC, e.id DESC
    `
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
