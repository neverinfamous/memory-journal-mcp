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
import type { JournalEntry } from '../../../types/index.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager/index.js'
import * as crypto from 'node:crypto'
import { logger } from '../../../utils/logger.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import type { AuditLogger } from '../../../audit/index.js'
import type { ToolHandlerConfig } from '../../../types/index.js'
import {
    canReadTeamEntriesRbac,
    enforceTeamRbac,
    getCallerIdentity,
} from '../team/rbac.js'

// ============================================================================
// Types
// ============================================================================

export interface EntryWithSource {
    content: string
    timestamp: string
    source: 'personal' | 'team'
    team_db?: string // Optional label for cross-team search
    [key: string]: unknown
}

export interface ISearchFilters {
    limit?: number
    isPersonal?: boolean
    projectNumber?: number
    issueNumber?: number
    prNumber?: number
    prStatus?: string
    workflowRunId?: number
    tags?: string[]
    excludeTags?: string[]
    entryType?: string
    startDate?: string
    endDate?: string
    includeTeam?: boolean
    includeArchived?: boolean
    workspaceId?: string
    similarityThreshold?: number
    config?: ToolHandlerConfig | undefined
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Return true when an optional team database adapter is defined and initialized.
 * Guards implicit personal+team search merges when `use_test_db=true` and `TEST_TEAM_DB_PATH` is unset.
 */
export function isTeamDbReady(teamDb: IDatabaseAdapter | undefined): teamDb is IDatabaseAdapter {
    if (teamDb === undefined) return false
    const candidate: {
        getEntriesByIds: IDatabaseAdapter['getEntriesByIds']
        isInitialized?: () => boolean
    } = teamDb
    return typeof candidate.isInitialized === 'function' ? candidate.isInitialized() : true
}

/** Return true if team boundary access passes without triggering denial audit logs. */
export function canAccessTeamSilently(
    toolName = 'search_entries',
    context?: {
        teamDb?: IDatabaseAdapter | undefined
        config?: ToolHandlerConfig | undefined
    },
    workspaceId?: string
): boolean {
    try {
        enforceAccessBoundary(toolName, 'tool', { requiresTeamScope: true })
        if (context?.teamDb !== undefined) {
            if (!isTeamDbReady(context.teamDb)) return false
            if (context.teamDb.isTeamRbacActive?.()) {
                return canReadTeamEntriesRbac(context.teamDb, context.config, workspaceId)
            }
        }
        return true
    } catch {
        return false
    }
}

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

/**
 * Filter an entry in-memory according to search options.
 * Used for post-filtering vector search results which don't support SQL metadata filtering.
 */
export function passMetadataFilters(
    entry: JournalEntry,
    options: ISearchFilters,
    db: IDatabaseAdapter
): boolean {
    if (
        options.workspaceId !== undefined &&
        options.workspaceId !== '*' &&
        entry.workspaceId !== options.workspaceId
    ) {
        return false
    }
    if (options.isPersonal !== undefined && entry.isPersonal !== options.isPersonal) return false
    if (options.projectNumber !== undefined && entry.projectNumber !== options.projectNumber)
        return false
    if (options.issueNumber !== undefined && entry.issueNumber !== options.issueNumber) return false
    if (options.prNumber !== undefined && entry.prNumber !== options.prNumber) return false
    if (options.prStatus !== undefined && entry.prStatus !== options.prStatus) return false
    if (options.workflowRunId !== undefined && entry.workflowRunId !== options.workflowRunId)
        return false
    if (options.entryType && entry.entryType !== options.entryType) return false
    if (options.startDate || options.endDate) {
        const tIdx = entry.timestamp.indexOf('T')
        const entryDate = tIdx === -1 ? entry.timestamp : entry.timestamp.slice(0, tIdx)
        if (options.startDate && entryDate < options.startDate) return false
        if (options.endDate && entryDate > options.endDate) return false
    }
    if (options.tags && options.tags.length > 0) {
        const entryTags: string[] = Array.isArray(entry.tags)
            ? entry.tags
            : db.getTagsForEntry(entry.id)
        if (!options.tags.some((t: string) => entryTags.includes(t))) return false
    }
    if (options.excludeTags && options.excludeTags.length > 0) {
        const entryTags: string[] = Array.isArray(entry.tags)
            ? entry.tags
            : db.getTagsForEntry(entry.id)
        if (options.excludeTags.some((t: string) => entryTags.includes(t))) return false
    }
    if (!options.includeArchived && entry.isArchived) return false
    return true
}

function readTeamHitScore(hit: { entryId: number; score?: number; similarity?: number }): number {
    if (typeof hit.score === 'number') return hit.score
    if (typeof hit.similarity === 'number') return hit.similarity
    return 0
}

function hydrateMissingTeamTags(
    teamDb: IDatabaseAdapter,
    resolvedEntries: JournalEntry[],
    options: ISearchFilters
): void {
    const hasTagFilters =
        (options.tags !== undefined && options.tags.length > 0) ||
        (options.excludeTags !== undefined && options.excludeTags.length > 0)
    if (!hasTagFilters) return

    const untaggedIds = resolvedEntries
        .filter((entry) => !Array.isArray(entry.tags))
        .map((entry) => entry.id)
    if (untaggedIds.length === 0) return

    const tagsMap = teamDb.getTagsForEntries(untaggedIds)
    for (const entry of resolvedEntries) {
        if (!Array.isArray(entry.tags)) {
            entry.tags = tagsMap.get(entry.id) ?? []
        }
    }
}

async function hydrateTeamVectorHits(
    query: string,
    teamDb: IDatabaseAdapter,
    teamVectorManager: VectorSearchManager,
    options: ISearchFilters & { limit: number },
    limit: number,
    pushEntry: (entry: JournalEntry, similarity?: number) => void
): Promise<boolean> {
    try {
        const hits = await teamVectorManager.search(
            query,
            limit,
            options.similarityThreshold ?? 0.15,
            options.workspaceId,
            options.projectNumber
        )
        const missingIds = hits.filter((hit) => hit.entry === undefined).map((hit) => hit.entryId)
        const hydrated =
            missingIds.length > 0
                ? teamDb.getEntriesByIds(missingIds, options.workspaceId ?? 'default')
                : new Map<number, JournalEntry>()
        const resolvedEntries: JournalEntry[] = []
        for (const hit of hits) {
            const entry = hit.entry ?? hydrated.get(hit.entryId)
            if (entry !== undefined) resolvedEntries.push(entry)
        }
        hydrateMissingTeamTags(teamDb, resolvedEntries, options)
        for (const hit of hits) {
            const entry = hit.entry ?? hydrated.get(hit.entryId)
            if (entry !== undefined) {
                pushEntry(entry, Math.round(readTeamHitScore(hit) * 100) / 100)
            }
        }
        return false
    } catch (err) {
        logger.debug('Team vector search failed; falling back to full-text results', {
            module: 'Search',
            error: err instanceof Error ? err.message : String(err),
        })
        return true
    }
}

function appendTeamFtsFallback(
    query: string,
    teamDb: IDatabaseAdapter,
    options: ISearchFilters & { limit: number },
    limit: number,
    pushEntry: (entry: JournalEntry, similarity?: number) => void
): void {
    const fts = teamDb.searchEntries(query, {
        limit,
        ...(options.projectNumber !== undefined ? { projectNumber: options.projectNumber } : {}),
        ...(options.issueNumber !== undefined ? { issueNumber: options.issueNumber } : {}),
        ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}),
        ...(options.prStatus !== undefined ? { prStatus: options.prStatus } : {}),
        ...(options.workflowRunId !== undefined ? { workflowRunId: options.workflowRunId } : {}),
        ...(options.tags !== undefined ? { tags: options.tags } : {}),
        ...(options.excludeTags !== undefined ? { excludeTags: options.excludeTags } : {}),
        ...(options.entryType !== undefined
            ? { entryType: options.entryType as JournalEntry['entryType'] }
            : {}),
        ...(options.startDate !== undefined ? { startDate: options.startDate } : {}),
        ...(options.endDate !== undefined ? { endDate: options.endDate } : {}),
        ...(options.includeArchived !== undefined ? { includeArchived: options.includeArchived } : {}),
        ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
    })
    const fallbackSimilarity = options.similarityThreshold !== undefined ? 0 : undefined
    for (const entry of fts.entries) pushEntry(entry, fallbackSimilarity)
}

/**
 * Team hits for hybrid and semantic search. Vector hits come first. Full-text
 * hits fill the rest so include_team is not a no-op when the team index is absent.
 */
export async function collectTeamSearchEntries(
    query: string,
    teamDb: IDatabaseAdapter,
    teamVectorManager: VectorSearchManager | undefined,
    options: ISearchFilters & { limit: number }
): Promise<EntryWithSource[]> {
    if (
        !isTeamDbReady(teamDb) ||
        !canAccessTeamSilently('search_entries') ||
        !canReadTeamEntriesRbac(teamDb, options.config, options.workspaceId)
    ) {
        return []
    }
    const seen = new Set<number>()
    const ranked: EntryWithSource[] = []
    const limit = Math.min(Math.max(options.limit, 1), 500)

    const pushEntry = (entry: JournalEntry, similarity?: number): void => {
        if (seen.has(entry.id) || !passMetadataFilters(entry, options, teamDb)) return
        seen.add(entry.id)
        ranked.push({
            ...entry,
            content: entry.content,
            timestamp: entry.timestamp,
            source: 'team',
            ...(similarity !== undefined ? { similarity } : {}),
        })
    }

    const teamVectorFailed =
        teamVectorManager !== undefined && query.trim() !== ''
            ? await hydrateTeamVectorHits(
                  query,
                  teamDb,
                  teamVectorManager,
                  options,
                  limit,
                  pushEntry
              )
            : false

    if (options.similarityThreshold === undefined || teamVectorManager === undefined || teamVectorFailed) {
        appendTeamFtsFallback(query, teamDb, options, limit, pushEntry)
    }
    return ranked
}
