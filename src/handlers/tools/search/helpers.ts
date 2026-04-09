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
