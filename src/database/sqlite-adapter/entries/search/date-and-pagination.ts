import type { JournalEntry, EntryType } from '../../../../types/index.js'
import {
    ENTRY_COLUMNS,
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import { buildImportanceSqlExpression, buildImportanceCte } from '../importance.js'
import { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
import { effectiveWorkspace } from '../../../workspace-scope.js'

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
    if (cursor !== undefined) {
        const decoded = decodeCursor(cursor)
        if (decoded !== null && 'offset' in decoded) actualOffset = decoded.offset
    }
    const importanceExpr = buildImportanceSqlExpression()
    const cte = buildImportanceCte()

    const params: unknown[] = []
    if (workspaceId !== '*') params.push(workspaceId)
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

    let cursorCondition = ''
    const params: unknown[] = []

    if (scopeId !== '*') {
        params.push(scopeId)
    }

    let projectCondition = ''
    if (projectNumber !== undefined) {
        projectCondition = ' AND project_number = ?'
        params.push(projectNumber)
    }

    if (cursor !== undefined) {
        const decoded = decodeCursor(cursor)
        if (decoded !== null && 't' in decoded) {
            cursorCondition = ' AND (timestamp < ? OR (timestamp = ? AND id < ?))'
            params.push(decoded.t, decoded.t, decoded.id)
        }
    }

    let offsetClause = ''
    if (cursor === undefined && offset > 0) {
        offsetClause = ' OFFSET ?'
    }

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL ${!includeArchived ? 'AND is_archived = 0' : ''} ${scopeId !== '*' ? 'AND workspace_id = ?' : ''} ${projectCondition} ${cursorCondition}
        ORDER BY timestamp DESC, id DESC LIMIT ?${offsetClause}
    `)
    params.push(limit)
    if (offsetClause !== '') {
        params.push(offset)
    }
    const rows = stmt.all(params)
    const entries = rowsToEntries(tagsMgr, rows)

    if (entries.length === limit && limit > 0) {
        if (cursor === undefined && offset > 0) {
            return { entries, nextCursor: encodeCursor({ offset: offset + limit }) }
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

export function searchByDateRange(
    context: EntriesSharedContext,
    startDate: string,
    endDate: string,
    options?: {
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
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context

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

    const useImportance = options?.sortBy === 'importance'
    const importanceCol = useImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''

    const { offset, hasKeyset, keysetT, keysetId } = decodeDateRangeCursor(options?.cursor)

    let query = ''
    if (useImportance) {
        query += `WITH ${buildImportanceCte()} `
    }

    query += `
        SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol} FROM memory_journal e
    `
    if (useImportance) {
        query += `LEFT JOIN rel_stats rs ON e.id = rs.entry_id `
        query += `LEFT JOIN anchor_stats ans ON e.id = ans.entry_id `
    }

    appendDateRangeFilters(conditions, params, options)

    if (hasKeyset && !useImportance) {
        conditions.push(`(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))`)
        params.push(keysetT, keysetT, keysetId)
    }

    if (useImportance) {
        query += ` WHERE ${conditions.join(' AND ')} ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC`
    } else {
        query += ` WHERE ${conditions.join(' AND ')} ORDER BY e.timestamp DESC, e.id DESC`
    }

    query += ` LIMIT ? OFFSET ?`
    params.push(options?.limit ?? 500, offset)

    const stmt = db.prepare(query)
    const rows = stmt.all(params)

    const entries = rowsToEntries(tagsMgr, rows)
    const limit = options?.limit ?? 500
    if (entries.length === limit && limit > 0) {
        if (!useImportance && entries.length > 0) {
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
    if (cursor !== undefined) {
        const decoded = decodeCursor(cursor)
        if (decoded !== null) {
            if ('t' in decoded) {
                hasKeyset = true
                keysetT = decoded.t
                keysetId = decoded.id
            } else if ('offset' in decoded) {
                offset = decoded.offset
            }
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
        const placeholders = options.tags.map(() => '?').join(',')
        conditions.push(
            `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.name IN (${placeholders}))`
        )
        params.push(...options.tags)
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
