/**
 * Pre-compiled filter matching helpers for JSONL audit log searches.
 * Extracted from `audit-query-helpers.ts` to keep files <= 450 lines.
 */

import type { AuditEntry, AuditSearchFilters } from './types.js'

const AUDIT_DATE_ONLY_BOUND_RE = /^\d{4}-\d{2}-\d{2}$/

export interface CompiledAuditSearchFilters {
    filters: AuditSearchFilters
    startRaw: string | undefined
    startMs: number | null
    endRaw: string | undefined
    endMs: number | null
    workspaceIdLower: string | undefined
}

/** Parse a filter boundary (`YYYY-MM-DD` -> UTC day start/end, or ISO-8601) into epoch ms. */
export function parseAuditBoundaryTimestampMs(raw: string, bound: 'start' | 'end'): number | null {
    const trimmed = raw.trim()
    if (AUDIT_DATE_ONLY_BOUND_RE.test(trimmed)) {
        const ms = Date.parse(
            bound === 'end' ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`
        )
        return Number.isFinite(ms) ? ms : null
    }
    const ms = Date.parse(trimmed)
    return Number.isFinite(ms) ? ms : null
}

/** Pre-compile date boundaries and lowercased workspace ID once per audit search. */
export function compileAuditSearchFilters(filters: AuditSearchFilters): CompiledAuditSearchFilters {
    const startRaw = filters.date_range?.start
    const endRaw = filters.date_range?.end
    const startNonEmpty = startRaw !== undefined && startRaw !== '' ? startRaw : undefined
    const endNonEmpty = endRaw !== undefined && endRaw !== '' ? endRaw : undefined
    const ws =
        filters.workspace_id !== undefined && filters.workspace_id !== '*'
            ? filters.workspace_id.toLowerCase()
            : undefined
    return {
        filters,
        startRaw: startNonEmpty,
        startMs: startNonEmpty !== undefined ? parseAuditBoundaryTimestampMs(startNonEmpty, 'start') : null,
        endRaw: endNonEmpty,
        endMs: endNonEmpty !== undefined ? parseAuditBoundaryTimestampMs(endNonEmpty, 'end') : null,
        workspaceIdLower: ws,
    }
}

function matchesCompiledDateRange(
    entryTimestamp: string,
    compiled: CompiledAuditSearchFilters
): boolean {
    const { startRaw, startMs, endRaw, endMs } = compiled
    if (startRaw === undefined && endRaw === undefined) return true
    const entryMs = Date.parse(entryTimestamp)
    if (startRaw !== undefined) {
        if (startMs !== null && Number.isFinite(entryMs)) {
            if (entryMs < startMs) return false
        } else if (entryTimestamp < startRaw) {
            return false
        }
    }
    if (endRaw !== undefined) {
        if (endMs !== null && Number.isFinite(entryMs)) {
            if (entryMs > endMs) return false
        } else if (entryTimestamp > endRaw) {
            return false
        }
    }
    return true
}

/** Whether an audit entry satisfies every provided (raw or pre-compiled) search filter. */
export function matchesAuditFilters(
    entry: AuditEntry,
    filtersOrCompiled: AuditSearchFilters | CompiledAuditSearchFilters
): boolean {
    const compiled =
        'filters' in filtersOrCompiled && 'startRaw' in filtersOrCompiled
            ? filtersOrCompiled
            : compileAuditSearchFilters(filtersOrCompiled)
    const { filters, workspaceIdLower } = compiled
    if (filters.tool_name && entry.tool !== filters.tool_name) return false
    if (filters.user && entry.user !== filters.user) return false
    if (filters.status !== undefined && entry.success !== filters.status) return false
    if (filters.category && entry.category !== filters.category) return false
    if (!matchesCompiledDateRange(entry.timestamp, compiled)) return false
    if (workspaceIdLower !== undefined) {
        if (typeof entry.workspaceId !== 'string' || entry.workspaceId.toLowerCase() !== workspaceIdLower) {
            return false
        }
    }
    if (filters.project_number !== undefined && entry.projectNumber !== filters.project_number) {
        return false
    }
    return true
}
