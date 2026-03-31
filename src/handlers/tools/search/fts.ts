/**
 * Search Group — FTS5 Full-Text Search
 *
 * Extracted from the monolithic search.ts.
 * Contains the FTS5-based search_entries handler logic.
 */

import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import { calcPerDbLimit, mergeAndDedup, type EntryWithSource } from './helpers.js'

/**
 * Execute an FTS5-based search across personal + optional team DB.
 */
export function ftsSearch(
    query: string | undefined,
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    options: {
        limit: number
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
        prStatus?: string
        workflowRunId?: number
    }
): { entries: EntryWithSource[]; count: number } {
    const hasFilters =
        options.projectNumber !== undefined ||
        options.issueNumber !== undefined ||
        options.prNumber !== undefined ||
        options.prStatus !== undefined ||
        options.workflowRunId !== undefined ||
        options.isPersonal !== undefined

    // When merging across DBs, fetch more per-DB so BM25 ranking
    // in one DB doesn't silently drop entries before the merge.
    const perDbLimit = calcPerDbLimit(options.limit, !!teamDb)

    let personalEntries
    if (!query && !hasFilters) {
        personalEntries = db.getRecentEntries(perDbLimit, options.isPersonal)
    } else {
        personalEntries = db.searchEntries(query || '', {
            limit: perDbLimit,
            isPersonal: options.isPersonal,
            projectNumber: options.projectNumber,
            issueNumber: options.issueNumber,
            prNumber: options.prNumber,
            prStatus: options.prStatus,
            workflowRunId: options.workflowRunId,
        })
    }

    // Cross-database merge when team DB is available
    // Skip team DB when is_personal is explicitly true (team entries are never personal)
    if (teamDb && options.isPersonal !== true) {
        let teamEntries
        if (!query && !hasFilters) {
            teamEntries = teamDb.getRecentEntries(perDbLimit)
        } else {
            teamEntries = teamDb.searchEntries(query || '', {
                limit: perDbLimit,
                projectNumber: options.projectNumber,
                issueNumber: options.issueNumber,
                prNumber: options.prNumber,
                prStatus: options.prStatus,
                workflowRunId: options.workflowRunId,
            })
        }
        const merged = mergeAndDedup(
            personalEntries.map((e) => ({ ...e, source: 'personal' as const })),
            teamEntries.map((e) => ({ ...e, source: 'team' as const })),
            options.limit
        )
        return { entries: merged, count: merged.length }
    }

    return {
        entries: personalEntries.map((e) => ({ ...e, source: 'personal' as const })),
        count: personalEntries.length,
    }
}
