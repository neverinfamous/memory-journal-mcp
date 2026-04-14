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
import * as crypto from 'node:crypto'


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
 * Merge personal and team results, deduplicate by content,
 * and sort by timestamp descending.
 */
export function mergeAndDedup(
    personal: EntryWithSource[],
    team: EntryWithSource[],
    limit?: number,
    sortBy: 'timestamp' | 'importance' = 'timestamp'
): EntryWithSource[] {
    const seen = new Set<string>()
    const merged: EntryWithSource[] = []

    // Concat and sort by requested metric, with timestamp as secondary/fallback (ISO 8601 sorts lexicographically)
    const all = [...personal, ...team].sort((a, b) => {
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
        // Deduplicate by content hash (same entry shared to team)
        const key = crypto.createHash('sha256').update(entry.content).digest('hex')
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
