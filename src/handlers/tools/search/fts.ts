/**
 * Search Group — FTS5 Full-Text Search
 *
 * Extracted from the monolithic search.ts.
 * Contains the FTS5-based search_entries handler logic.
 */

import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { EntryType } from '../../../types/index.js'
import { calcPerDbLimit, mergeAndDedup, type EntryWithSource } from './helpers.js'
import { Buffer } from 'buffer'

// Helper for compound cursor encoding/decoding
export function encodeCompoundCursor(personalCursor?: string, teamCursor?: string): string {
    return Buffer.from(JSON.stringify({ p: personalCursor, t: teamCursor })).toString('base64')
}

export function decodeCompoundCursor(cursor: string): { p?: string; t?: string } | null {
    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8')
        return JSON.parse(decoded)
    } catch {
        return null
    }
}

/**
 * Execute an FTS5-based search across personal + optional team DB.
 */
export function ftsSearch(
    query: string | undefined,
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    options: {
        limit: number
        cursor?: string
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
        prStatus?: string
        workflowRunId?: number
        tags?: string[]
        entryType?: EntryType
        startDate?: string
        endDate?: string
        sortBy?: 'timestamp' | 'importance'
        includeTeam?: boolean
    }
): { entries: EntryWithSource[]; count: number; degraded?: boolean; nextCursor?: string } {
    const hasFilters =
        options.projectNumber !== undefined ||
        options.issueNumber !== undefined ||
        options.prNumber !== undefined ||
        options.prStatus !== undefined ||
        options.workflowRunId !== undefined ||
        options.isPersonal !== undefined ||
        options.tags !== undefined ||
        options.entryType !== undefined ||
        options.startDate !== undefined ||
        options.endDate !== undefined

    // Decode compound cursor if it exists
    let personalCursor: string | undefined
    let teamCursor: string | undefined
    if (options.cursor) {
        if (teamDb && options.includeTeam === true && options.isPersonal !== true) {
            const compound = decodeCompoundCursor(options.cursor)
            if (compound) {
                personalCursor = compound.p
                teamCursor = compound.t
            } else {
                personalCursor = options.cursor
            }
        } else {
            personalCursor = options.cursor
        }
    }

    const perDbLimit = calcPerDbLimit(options.limit, !!teamDb)

    let personalResult
    if (!query && !hasFilters) {
        personalResult = db.getRecentEntries(perDbLimit, options.isPersonal, options.sortBy, personalCursor)
    } else {
        personalResult = db.searchEntries(query || '', {
            limit: perDbLimit,
            cursor: personalCursor,
            isPersonal: options.isPersonal,
            projectNumber: options.projectNumber,
            issueNumber: options.issueNumber,
            prNumber: options.prNumber,
            prStatus: options.prStatus,
            workflowRunId: options.workflowRunId,
            tags: options.tags,
            entryType: options.entryType,
            startDate: options.startDate,
            endDate: options.endDate,
            sortBy: options.sortBy,
        })
    }

    const personalEntries = personalResult.entries
    const personalNextCursor = personalResult.nextCursor

    if (teamDb && options.includeTeam === true && options.isPersonal !== true) {
        let teamResult
        if (!query && !hasFilters) {
            teamResult = teamDb.getRecentEntries(perDbLimit, undefined, options.sortBy, teamCursor)
        } else {
            teamResult = teamDb.searchEntries(query || '', {
                limit: perDbLimit,
                cursor: teamCursor,
                projectNumber: options.projectNumber,
                issueNumber: options.issueNumber,
                prNumber: options.prNumber,
                prStatus: options.prStatus,
                workflowRunId: options.workflowRunId,
                tags: options.tags,
                entryType: options.entryType,
                startDate: options.startDate,
                endDate: options.endDate,
                sortBy: options.sortBy,
            })
        }
        
        const teamEntries = teamResult.entries
        const teamNextCursor = teamResult.nextCursor

        const merged = mergeAndDedup(
            personalEntries.map((e) => ({ ...e, source: 'personal' as const })),
            teamEntries.map((e) => ({ ...e, source: 'team' as const })),
            options.limit,
            options.sortBy
        )
        
        let compoundNextCursor: string | undefined
        if (personalNextCursor || teamNextCursor) {
            compoundNextCursor = encodeCompoundCursor(personalNextCursor, teamNextCursor)
        }

        const isTeamDegraded = teamResult.degraded === true
        const isPersonalDegraded = personalResult.degraded === true
        return {
            entries: merged,
            count: merged.length,
            degraded: isPersonalDegraded || isTeamDegraded,
            nextCursor: compoundNextCursor
        }
    }

    const isPersonalDegraded = personalResult.degraded === true

    return {
        entries: personalEntries.map((e) => ({ ...e, source: 'personal' as const })),
        count: personalEntries.length,
        degraded: isPersonalDegraded,
        nextCursor: personalNextCursor
    }
}
