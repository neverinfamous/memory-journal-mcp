/**
 * Column assignment and record-bind helpers extracted from `sql-positional-binder.ts`.
 *
 * [BOUNDARY] Worker-thread safe: pure TypeScript/JS helpers with zero host imports.
 */

import type { SqlRecordBindIndex } from './sql-placeholder-helpers.js'
import { isSingleSqlStringLiteral } from './sql-literal-scope.js'
import { parsePositiveProjectNumber } from '../utils/safe-positive-int.js'

export const UNPARSEABLE = Symbol('unparseable')

export interface SqlLockedScope {
    workspaceId?: string | undefined
    projectNumber?: number | null | undefined
}

export function toPositiveInt(val: unknown): number | undefined {
    return parsePositiveProjectNumber(val)
}

export function toTags(val: unknown): string[] | undefined {
    if (Array.isArray(val)) return val.map(String)
    if (typeof val !== 'string') return undefined
    const trimmed = val.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed: unknown = JSON.parse(trimmed)
            if (Array.isArray(parsed)) return parsed.map(String)
        } catch {
            // Not JSON: fall through to comma-separated parsing.
        }
    }
    return trimmed === '' ? [] : trimmed.split(',').map((t) => t.trim()).filter((t) => t !== '')
}

export function parseLiteral(raw: string): unknown {
    const trimmed = raw.trim()
    if (/^null$/i.test(trimmed)) return null
    if (/^true$/i.test(trimmed)) return true
    if (/^false$/i.test(trimmed)) return false
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
    if (isSingleSqlStringLiteral(trimmed)) {
        const inner = trimmed.slice(1, -1)
        const doubled = trimmed.startsWith("'") ? inner.replace(/''/g, "'") : inner.replace(/""/g, '"')
        return doubled.replace(/\\(['"\\])/g, '$1')
    }
    return UNPARSEABLE
}

export function bindSetColumnNameCheck(column: string): boolean {
    return (
        column === 'project_number' ||
        column === 'project_id' ||
        column === 'workspace_id' ||
        column === 'significance_type' ||
        column === 'content' ||
        column === 'title' ||
        column === 'entry_type' ||
        column === 'type' ||
        column === 'tags' ||
        column === 'is_personal'
    )
}

/** Assigns a bound value to its canonical journal field; returns false when the column is unknown. */
export function assignColumn(payload: Record<string, unknown>, column: string, val: unknown): boolean {
    switch (column) {
        case 'id':
        case 'entry_id': {
            const id = toPositiveInt(val)
            if (id !== undefined) payload['entry_id'] = id
            return id !== undefined
        }
        case 'project_number':
        case 'project_id': {
            if (val === null) {
                payload['project_number'] = null
                return true
            }
            const pn = toPositiveInt(val)
            if (pn !== undefined) payload['project_number'] = pn
            return pn !== undefined
        }
        case 'workspace_id':
            if (typeof val === 'string' && val.trim() !== '') {
                payload['workspace_id'] = val.trim()
                return true
            }
            return false
        case 'significance_type':
            if (val === null || typeof val === 'string') {
                payload['significance_type'] = val
                return true
            }
            return false
        case 'content':
        case 'title':
            if (typeof val === 'string') {
                payload[column] = val
                return true
            }
            return false
        case 'entry_type':
        case 'type': {
            if (typeof val !== 'string') return false
            payload['entry_type'] = val
            return true
        }
        case 'tags': {
            const tags = toTags(val)
            if (tags === undefined) return false
            payload['tags'] = tags
            return true
        }
        case 'is_personal':
            payload['is_personal'] = val === true || val === 1 || val === '1' || val === 'true'
            return true
        default:
            return false
    }
}

function isConflictingScopeRecordEntry(
    snakeCol: string,
    value: unknown,
    lockedScope: SqlLockedScope
): boolean {
    if (snakeCol === 'target_workspace_id') {
        return true
    }
    if (snakeCol === 'workspace_id' && lockedScope.workspaceId !== undefined) {
        if (typeof value !== 'string' || value.trim() === '') return true
        return value.trim() !== lockedScope.workspaceId
    }
    if ((snakeCol === 'project_number' || snakeCol === 'project_id') && lockedScope.projectNumber !== undefined) {
        const normalizedProj = value === null ? null : toPositiveInt(value)
        if (normalizedProj === undefined) return true
        return normalizedProj !== lockedScope.projectNumber
    }
    return false
}

export function mergeUnusedRecordBinds(
    payload: Record<string, unknown>,
    bindIndex: SqlRecordBindIndex,
    consumedIds: ReadonlySet<number>,
    lockedScope: SqlLockedScope = {}
): boolean {
    for (const { snakeCol, value } of bindIndex.unconsumedEntries(consumedIds)) {
        if (isConflictingScopeRecordEntry(snakeCol, value, lockedScope)) {
            return false
        }
        if (!assignColumn(payload, snakeCol, value)) return false
    }
    return true
}
