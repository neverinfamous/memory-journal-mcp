/**
 * Search Group — Shared Helpers
 *
 * Extracted from search.ts to support the search/ module split.
 * Contains merge/dedup logic and shared constants.
 */

// ============================================================================
// Constants
// ============================================================================

import { MAX_QUERY_LIMIT } from '../schemas.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import * as crypto from 'node:crypto'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import type { AuditLogger } from '../../../audit/index.js'
import type { ToolHandlerConfig } from '../../../types/index.js'
import {
    canReadTeamEntriesRbac,
    enforceTeamRbac,
    getCallerIdentity,
} from '../team/rbac.js'
import {
    canAccessTeamSilently,
    collectTeamSearchEntries,
    isTeamDbReady,
    passMetadataFilters,
    type EntryWithSource,
    type ISearchFilters,
} from './team-search-helpers.js'

export {
    canAccessTeamSilently,
    collectTeamSearchEntries,
    isTeamDbReady,
    passMetadataFilters,
    type EntryWithSource,
    type ISearchFilters,
}

// ============================================================================
// Helpers
// ============================================================================

function hasPlainIncludeTeam(record: Record<string, unknown>): boolean {
    return record['include_team'] === true || record['includeTeam'] === true
}

/** Return true if the caller explicitly passed `include_team: true` (top-level or nested filter). */
export function hasExplicitIncludeTeam(rawParams: unknown): boolean {
    if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
        return false
    }
    const rec = rawParams as Record<string, unknown>
    if (hasPlainIncludeTeam(rec)) return true
    for (const key of ['filter', 'filters'] as const) {
        const nested = rec[key]
        if (
            typeof nested === 'object' &&
            nested !== null &&
            !Array.isArray(nested) &&
            hasPlainIncludeTeam(nested as Record<string, unknown>)
        ) {
            return true
        }
    }
    return false
}

/** Probe whether a missing personal entry exists in the team database (respecting scope & RBAC). */
export function probeMatchingTeamEntry(
    context: {
        teamDb?: IDatabaseAdapter | undefined
        config?: ToolHandlerConfig | undefined
    },
    entryId: number,
    wsId: string,
    projectNumber?: number,
    toolName = 'team_get_entry_by_id'
): boolean {
    const teamDb = context.teamDb
    if (
        !isTeamDbReady(teamDb) ||
        !canAccessTeamSilently(toolName) ||
        !canReadTeamEntriesRbac(teamDb, context.config, wsId)
    ) {
        return false
    }
    const teamCandidate = teamDb.getEntryById(entryId, wsId)
    if (
        teamCandidate === null ||
        (teamCandidate.deletedAt !== undefined && teamCandidate.deletedAt !== null)
    ) {
        return false
    }
    return projectNumber === undefined || teamCandidate.projectNumber === projectNumber
}

/**
 * Authorize team-DB merging on personal search tools:
 * - Explicit `include_team: true` enforces OAuth team scope + Team RBAC (`AuthorizationError`/`PermissionError`).
 * - Defaulted `include_team` silently drops team results when unauthorized so personal searches still work.
 */
export function resolveAuthorizedIncludeTeam(
    toolName: string,
    parsedIncludeTeam: boolean,
    rawParams: unknown,
    auditLogger?: AuditLogger | null,
    teamDb?: IDatabaseAdapter,
    config?: ToolHandlerConfig,
    workspaceId?: string
): boolean {
    if (!parsedIncludeTeam) return false
    const explicit = hasExplicitIncludeTeam(rawParams)
    if (explicit) {
        enforceAccessBoundary(toolName, 'tool', { requiresTeamScope: true }, auditLogger)
    } else if (!canAccessTeamSilently(toolName)) {
        return false
    }
    if (teamDb !== undefined && !isTeamDbReady(teamDb)) {
        return false
    }
    if (teamDb?.isTeamRbacActive?.() === true) {
        if (explicit) {
            enforceTeamRbac(
                { db: teamDb, teamDb, ...(config !== undefined ? { config } : {}) },
                getCallerIdentity(),
                'viewer',
                workspaceId
            )
        } else if (!canReadTeamEntriesRbac(teamDb, config, workspaceId)) {
            return false
        }
    }
    return true
}

/**
 * When merging across personal + team DBs, fetch more per-DB so BM25
 * ranking in one DB doesn't silently drop entries before the merge.
 */
export function calcPerDbLimit(limit: number, hasTeamDb: boolean): number {
    // If team DB exists, request up to 2x from each to ensure enough results after merge,
    // bounded by MAX_QUERY_LIMIT
    return hasTeamDb ? Math.min(limit * 2, MAX_QUERY_LIMIT) : limit
}

/**
 * Merge multiple arrays of entries, deduplicate by content/source,
 * and sort by timestamp, importance, similarity, or preserve existing rank order.
 */
export function mergeMultipleSources(
    sources: EntryWithSource[][],
    limit?: number,
    sortBy: 'timestamp' | 'importance' | 'similarity' | 'preserve' = 'timestamp'
): EntryWithSource[] {
    const seen = new Set<string>()
    const merged: EntryWithSource[] = []

    const flattened = sources.flat()
    const all =
        sortBy === 'preserve'
            ? flattened
            : flattened.sort((a, b) => {
                  if (sortBy === 'importance') {
                      const scoreA = Number(a['importanceScore']) || 0
                      const scoreB = Number(b['importanceScore']) || 0
                      if (scoreA !== scoreB) {
                          return scoreB - scoreA
                      }
                  } else if (sortBy === 'similarity') {
                      const simA = Number(a['similarity']) || 0
                      const simB = Number(b['similarity']) || 0
                      if (simA !== simB) {
                          return simB - simA
                      }
                  }
                  return (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
              })

    for (const entry of all) {
        const entryId =
            typeof entry['id'] === 'number' || typeof entry['id'] === 'string'
                ? String(entry['id'])
                : ''
        // Use team_db label if available to prevent colliding IDs across team DBs
        const sourceKey = entry.team_db ? `${entry.source}:${entry.team_db}` : entry.source
        const key = entryId
            ? `${sourceKey}:${entryId}`
            : crypto.createHash('sha256').update(`${sourceKey}:${entry.content}`).digest('hex')
        if (!seen.has(key)) {
            seen.add(key)
            merged.push(entry)
        }
    }

    return limit !== undefined ? merged.slice(0, limit) : merged
}

/**
 * Merge personal and team results, deduplicate by content,
 * and sort by timestamp, importance, similarity, or preserve existing rank order.
 */
export function mergeAndDedup(
    personal: EntryWithSource[],
    team: EntryWithSource[],
    limit?: number,
    sortBy: 'timestamp' | 'importance' | 'similarity' | 'preserve' = 'timestamp'
): EntryWithSource[] {
    return mergeMultipleSources([personal, team], limit, sortBy)
}
