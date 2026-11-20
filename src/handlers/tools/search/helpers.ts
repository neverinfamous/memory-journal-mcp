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
import { PermissionError, ValidationError } from '../../../types/errors.js'
import type { AuditLogger } from '../../../audit/index.js'
import type { ToolHandlerConfig } from '../../../types/index.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import {
    canReadTeamEntriesRbac,
    enforceTeamRbac,
    getCallerIdentity,
} from '../team/rbac.js'
import {
    canAccessTeamSilently,
    collectTeamSearchEntries,
    isTeamDbReady,
    isTeamFilterAllowed,
    passMetadataFilters,
    type EntryWithSource,
    type ISearchFilters,
} from './team-search-helpers.js'
import { collapseTeamMirrors } from '../../../utils/team-mirror.js'

export {
    canAccessTeamSilently,
    collectTeamSearchEntries,
    isTeamDbReady,
    isTeamFilterAllowed,
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
        !canAccessTeamSilently(toolName, { teamDb, config: context.config }, wsId) ||
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
 * - Explicit `include_team: true` enforces tool filter, scoped project_number, OAuth team scope, and Team RBAC.
 * - Defaulted `include_team` silently drops team results when unauthorized or unscoped so personal searches still work.
 */
export function resolveAuthorizedIncludeTeam(
    toolName: string,
    parsedIncludeTeam: boolean,
    rawParams: unknown,
    auditLogger?: AuditLogger | null,
    teamDb?: IDatabaseAdapter,
    config?: ToolHandlerConfig,
    workspaceId?: string,
    projectNumber?: number
): boolean {
    if (!parsedIncludeTeam) return false
    const explicit = hasExplicitIncludeTeam(rawParams)
    if (!isTeamFilterAllowed('team_search', config)) {
        if (explicit) {
            throw new PermissionError("Tool 'team_search' is disabled by active tool filter.")
        }
        return false
    }
    const registry = activeProjectRegistry(config?.projectRegistry)
    const hasActiveRegistry = registry !== undefined && Object.keys(registry).length > 0
    if (projectNumber === undefined && (workspaceId === '*' || hasActiveRegistry)) {
        if (explicit) {
            throw new ValidationError(
                'Missing project_number. Including team entries in wildcard or multi-project workspaces requires a resolved project_number.'
            )
        }
        return false
    }
    if (explicit) {
        enforceAccessBoundary(toolName, 'tool', { requiresTeamScope: true }, auditLogger)
    } else if (!canAccessTeamSilently(toolName, { config }, workspaceId)) {
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
 * Team DB: stamp `originPersonalId` (migration 020) onto same-store team hits so
 * `collapseTeamMirrors` can match them precisely. No-op without team support.
 */
export function attachTeamMirrorOrigins(
    teamDb: IDatabaseAdapter | undefined,
    entries: EntryWithSource[]
): EntryWithSource[] {
    if (teamDb === undefined || typeof teamDb.getMirrorOrigins !== 'function') return entries
    const teamIds: number[] = []
    for (const entry of entries) {
        const id = entry['id']
        if (entry.source === 'team' && entry.team_db === undefined && typeof id === 'number') {
            teamIds.push(id)
        }
    }
    if (teamIds.length === 0) return entries
    const origins = teamDb.getMirrorOrigins(teamIds)
    if (origins.size === 0) return entries
    return entries.map((entry) => {
        const id = entry['id']
        const origin =
            entry.source === 'team' && typeof id === 'number' ? origins.get(id) : undefined
        return origin !== undefined ? { ...entry, originPersonalId: origin } : entry
    })
}

/**
 * Merge multiple arrays of entries, deduplicate by `source[:team_db]:id`, collapse
 * personal/team mirror pairs (keeping the personal hit annotated with `alsoInTeam`),
 * and sort by timestamp, importance, similarity, or preserve existing rank order.
 * Pass `teamDb` to match mirrors precisely via `origin_personal_id`; without it,
 * mirrors are matched by normalized-content sha256 + workspace.
 */
export function mergeMultipleSources(
    sources: EntryWithSource[][],
    limit?: number,
    sortBy: 'timestamp' | 'importance' | 'similarity' | 'preserve' = 'timestamp',
    teamDb?: IDatabaseAdapter
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

    const collapsed = collapseTeamMirrors(attachTeamMirrorOrigins(teamDb, merged))
    return limit !== undefined ? collapsed.slice(0, limit) : collapsed
}

/**
 * Merge personal and team results (see `mergeMultipleSources` for dedupe and mirror collapse),
 * and sort by timestamp, importance, similarity, or preserve existing rank order.
 */
export function mergeAndDedup(
    personal: EntryWithSource[],
    team: EntryWithSource[],
    limit?: number,
    sortBy: 'timestamp' | 'importance' | 'similarity' | 'preserve' = 'timestamp',
    teamDb?: IDatabaseAdapter
): EntryWithSource[] {
    return mergeMultipleSources([personal, team], limit, sortBy, teamDb)
}
