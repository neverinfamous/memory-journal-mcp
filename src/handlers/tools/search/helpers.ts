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

export { MAX_QUERY_LIMIT }

/** Number of leading characters used as deduplication key */
const DEDUP_KEY_LENGTH = 200

// ============================================================================
// Types
// ============================================================================

export interface EntryWithSource {
    content: string
    timestamp: string
    source: 'personal' | 'team'
    [key: string]: unknown
}

export interface ISearchFilters {
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
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * When merging across personal + team DBs, fetch more per-DB so BM25
 * ranking in one DB doesn't silently drop entries before the merge.
 */
export function calcPerDbLimit(limit: number, hasTeamDb: boolean): number {
    return hasTeamDb ? Math.min(limit * 2, MAX_QUERY_LIMIT) : limit
}

/**
 * Merge personal and team results, deduplicate by content,
 * and sort by timestamp descending.
 */
export function mergeAndDedup(
    personal: EntryWithSource[],
    team: EntryWithSource[],
    limit?: number
): EntryWithSource[] {
    const seen = new Set<string>()
    const merged: EntryWithSource[] = []

    // Concat and sort by timestamp descending (ISO 8601 sorts lexicographically)
    const all = [...personal, ...team].sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    for (const entry of all) {
        // Deduplicate by content (same entry shared to team)
        const key = entry.content.slice(0, DEDUP_KEY_LENGTH)
        if (!seen.has(key)) {
            seen.add(key)
            merged.push(entry)
        }
    }

    return limit !== undefined ? merged.slice(0, limit) : merged
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
    return true
}
