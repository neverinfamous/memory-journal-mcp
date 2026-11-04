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
    entryType?: string
    startDate?: string
    endDate?: string
    includeTeam?: boolean
    includeArchived?: boolean
    workspaceId?: string
}

// ============================================================================
// Helpers
// ============================================================================

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
 * and sort by timestamp descending.
 */
export function mergeMultipleSources(
    sources: EntryWithSource[][],
    limit?: number,
    sortBy: 'timestamp' | 'importance' = 'timestamp'
): EntryWithSource[] {
    const seen = new Set<string>()
    const merged: EntryWithSource[] = []

    const all = sources.flat().sort((a, b) => {
        if (sortBy === 'importance') {
            const scoreA = Number(a['importanceScore']) || 0
            const scoreB = Number(b['importanceScore']) || 0
            if (scoreA !== scoreB) {
                return scoreB - scoreA
            }
        }
        return b.timestamp.localeCompare(a.timestamp)
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
 * and sort by timestamp descending.
 */
export function mergeAndDedup(
    personal: EntryWithSource[],
    team: EntryWithSource[],
    limit?: number,
    sortBy: 'timestamp' | 'importance' = 'timestamp'
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
    if (options.startDate) {
        const entryDate = entry.timestamp.split('T')[0] ?? ''
        if (entryDate < options.startDate) return false
    }
    if (options.endDate) {
        const entryDate = entry.timestamp.split('T')[0] ?? ''
        if (entryDate > options.endDate) return false
    }
    if (options.tags && options.tags.length > 0) {
        const entryTags: string[] = Array.isArray(entry.tags)
            ? entry.tags
            : db.getTagsForEntry(entry.id)
        if (!options.tags.some((t: string) => entryTags.includes(t))) return false
    }
    if (!options.includeArchived && entry.isArchived) return false
    return true
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
    const seen = new Set<number>()
    const ranked: EntryWithSource[] = []
    const limit = Math.min(Math.max(options.limit, 1), 500)

    const pushEntry = (entry: JournalEntry, similarity?: number): void => {
        if (seen.has(entry.id)) return
        if (!passMetadataFilters(entry, options, teamDb)) return
        seen.add(entry.id)
        ranked.push({
            ...entry,
            content: entry.content,
            timestamp: entry.timestamp,
            source: 'team',
            ...(similarity !== undefined ? { similarity } : {}),
        })
    }

    if (teamVectorManager !== undefined && query.trim() !== '') {
        try {
            const hits = await teamVectorManager.search(query, limit, 0.15, options.workspaceId)
            const ids = hits.map((hit) => hit.entryId)
            const hydrated = teamDb.getEntriesByIds(ids)
            for (const hit of hits) {
                const entry = hydrated.get(hit.entryId)
                if (entry !== undefined) pushEntry(entry, Math.round(hit.score * 100) / 100)
            }
        } catch {
            // Team vector search is best-effort. Full-text results still apply.
        }
    }

    const fts = teamDb.searchEntries(query, {
        limit,
        ...(options.projectNumber !== undefined ? { projectNumber: options.projectNumber } : {}),
        ...(options.issueNumber !== undefined ? { issueNumber: options.issueNumber } : {}),
        ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}),
        ...(options.prStatus !== undefined ? { prStatus: options.prStatus } : {}),
        ...(options.workflowRunId !== undefined ? { workflowRunId: options.workflowRunId } : {}),
        ...(options.tags !== undefined ? { tags: options.tags } : {}),
        ...(options.entryType !== undefined ? { entryType: options.entryType as JournalEntry['entryType'] } : {}),
        ...(options.startDate !== undefined ? { startDate: options.startDate } : {}),
        ...(options.endDate !== undefined ? { endDate: options.endDate } : {}),
        ...(options.includeArchived !== undefined ? { includeArchived: options.includeArchived } : {}),
        ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
    })
    for (const entry of fts.entries) pushEntry(entry)
    return ranked
}
