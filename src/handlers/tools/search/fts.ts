/**
 * Search Group — FTS5 Full-Text Search
 *
 * Extracted from the monolithic search.ts.
 * Contains the FTS5-based search_entries handler logic.
 */

import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { EntryType, ToolHandlerConfig } from '../../../types/index.js'
import { canReadTeamEntriesRbac } from '../team/rbac.js'
import {
    calcPerDbLimit,
    canAccessTeamSilently,
    isTeamDbReady,
    mergeAndDedup,
    type EntryWithSource,
} from './helpers.js'
import { Buffer } from 'buffer'

// Helper for compound cursor encoding/decoding
export function encodeCompoundCursor(personalCursor?: string, teamCursor?: string): string {
    return Buffer.from(JSON.stringify({ p: personalCursor, t: teamCursor })).toString('base64')
}

interface FtsSearchOptions {
    limit: number
    cursor?: string
    isPersonal?: boolean
    projectNumber?: number
    issueNumber?: number
    prNumber?: number
    prStatus?: string
    workflowRunId?: number
    tags?: string[]
    excludeTags?: string[]
    entryType?: EntryType
    startDate?: string
    endDate?: string
    sortBy?: 'timestamp' | 'importance' | 'blended'
    includeTeam?: boolean
    includeArchived?: boolean
    includeHighlights?: boolean
    fuzzy_match?: boolean
    auto_correct?: boolean
    workspaceId?: string
    config?: ToolHandlerConfig | undefined
}

export interface FtsSearchResponse {
    entries: EntryWithSource[]
    count: number
    degraded?: boolean
    nextCursor?: string
    highlights?: { id: number; snippet: string }[]
    suggestions?: string[]
    correctedQuery?: string
}

export function decodeCompoundCursor(cursor: string): { p?: string; t?: string } | null {
    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8')
        const parsed: unknown = JSON.parse(decoded)
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed) ||
            (!('p' in parsed) && !('t' in parsed))
        ) {
            return null
        }
        const raw = parsed as { p?: unknown; t?: unknown }
        if (
            (raw.p !== undefined && typeof raw.p !== 'string') ||
            (raw.t !== undefined && typeof raw.t !== 'string')
        ) {
            return null
        }
        return {
            ...(raw.p !== undefined ? { p: raw.p } : {}),
            ...(raw.t !== undefined ? { t: raw.t } : {}),
        }
    } catch {
        return null
    }
}

function hasFtsSearchFilters(options: FtsSearchOptions): boolean {
    return (
        (options.workspaceId !== undefined &&
            options.workspaceId.trim() !== '' &&
            options.workspaceId.trim() !== 'default') ||
        options.projectNumber !== undefined ||
        options.issueNumber !== undefined ||
        options.prNumber !== undefined ||
        options.prStatus !== undefined ||
        options.workflowRunId !== undefined ||
        options.isPersonal !== undefined ||
        options.tags !== undefined ||
        (options.excludeTags !== undefined && options.excludeTags.length > 0) ||
        options.entryType !== undefined ||
        options.startDate !== undefined ||
        options.endDate !== undefined
    )
}

function resolveFtsCursors(
    cursor: string | undefined,
    canIncludeTeam: boolean
): {
    personalCursor?: string
    teamCursor?: string
    personalExhausted: boolean
    teamExhausted: boolean
} {
    if (!cursor) {
        return { personalExhausted: false, teamExhausted: false }
    }
    if (!canIncludeTeam) {
        return { personalCursor: cursor, personalExhausted: false, teamExhausted: false }
    }
    const compound = decodeCompoundCursor(cursor)
    if (!compound) {
        return { personalCursor: cursor, personalExhausted: false, teamExhausted: false }
    }
    return {
        ...(compound.p !== undefined ? { personalCursor: compound.p } : {}),
        ...(compound.t !== undefined ? { teamCursor: compound.t } : {}),
        personalExhausted: compound.p === undefined,
        teamExhausted: compound.t === undefined,
    }
}

function querySingleFtsStore(
    store: IDatabaseAdapter,
    query: string | undefined,
    perDbLimit: number,
    cursor: string | undefined,
    exhausted: boolean,
    isPersonalFilter: boolean | undefined,
    hasFilters: boolean,
    options: FtsSearchOptions
): ReturnType<IDatabaseAdapter['searchEntries']> {
    if (exhausted) {
        return { entries: [], nextCursor: undefined }
    }
    const recentSortBy = options.sortBy === 'blended' ? 'importance' : options.sortBy
    if (!query && !hasFilters) {
        return store.getRecentEntries(
            perDbLimit,
            isPersonalFilter,
            recentSortBy,
            cursor,
            options.includeArchived,
            options.workspaceId,
            options.projectNumber
        )
    }
    return store.searchEntries(query || '', {
        limit: perDbLimit,
        cursor,
        ...(isPersonalFilter !== undefined ? { isPersonal: isPersonalFilter } : {}),
        projectNumber: options.projectNumber,
        issueNumber: options.issueNumber,
        prNumber: options.prNumber,
        prStatus: options.prStatus,
        workflowRunId: options.workflowRunId,
        tags: options.tags,
        excludeTags: options.excludeTags,
        entryType: options.entryType,
        startDate: options.startDate,
        endDate: options.endDate,
        sortBy: options.sortBy,
        includeHighlights: options.includeHighlights,
        fuzzy_match: options.fuzzy_match,
        auto_correct: options.auto_correct,
        includeArchived: options.includeArchived,
        workspaceId: options.workspaceId,
    })
}

function mergeFtsStoreResults(
    personalResult: ReturnType<IDatabaseAdapter['searchEntries']>,
    teamResult: ReturnType<IDatabaseAdapter['searchEntries']>,
    options: FtsSearchOptions,
    teamDb?: IDatabaseAdapter
): FtsSearchResponse {
    const merged = mergeAndDedup(
        personalResult.entries.map((e) => ({ ...e, source: 'personal' as const })),
        teamResult.entries.map((e) => ({ ...e, source: 'team' as const })),
        options.limit,
        options.sortBy === 'blended' ? 'preserve' : options.sortBy,
        teamDb
    )
    const compoundNextCursor =
        personalResult.nextCursor || teamResult.nextCursor
            ? encodeCompoundCursor(personalResult.nextCursor, teamResult.nextCursor)
            : undefined
    const isTeamDegraded = 'degraded' in teamResult && teamResult.degraded === true
    const isPersonalDegraded = 'degraded' in personalResult && personalResult.degraded === true

    let mergedHighlights: { id: number; snippet: string }[] | undefined
    if (options.includeHighlights) {
        const pHighlights = personalResult.highlights ?? []
        const tHighlights = teamResult.highlights ?? []
        if (pHighlights.length > 0 || tHighlights.length > 0) {
            mergedHighlights = [...pHighlights, ...tHighlights]
        }
    }

    return {
        entries: merged,
        count: merged.length,
        degraded: isPersonalDegraded || isTeamDegraded,
        nextCursor: compoundNextCursor,
        highlights: mergedHighlights,
        suggestions: personalResult.suggestions ?? teamResult.suggestions,
        correctedQuery: personalResult.correctedQuery ?? teamResult.correctedQuery,
    }
}

/**
 * Execute an FTS5-based search across personal + optional team DB.
 */
export function ftsSearch(
    query: string | undefined,
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    options: FtsSearchOptions
): FtsSearchResponse {
    const hasFilters = hasFtsSearchFilters(options)
    const canIncludeTeam =
        isTeamDbReady(teamDb) &&
        options.includeTeam === true &&
        options.isPersonal !== true &&
        canAccessTeamSilently('search_entries') &&
        canReadTeamEntriesRbac(teamDb, options.config, options.workspaceId)
    const cursors = resolveFtsCursors(options.cursor, canIncludeTeam)
    const perDbLimit = calcPerDbLimit(options.limit, canIncludeTeam)

    const personalResult = querySingleFtsStore(
        db,
        query,
        perDbLimit,
        cursors.personalCursor,
        cursors.personalExhausted,
        options.isPersonal,
        hasFilters,
        options
    )

    if (canIncludeTeam && teamDb !== undefined) {
        const teamResult = querySingleFtsStore(
            teamDb,
            query,
            perDbLimit,
            cursors.teamCursor,
            cursors.teamExhausted,
            undefined,
            hasFilters,
            options
        )
        return mergeFtsStoreResults(personalResult, teamResult, options, teamDb)
    }

    const isPersonalDegraded = 'degraded' in personalResult && personalResult.degraded === true
    return {
        entries: personalResult.entries.map((e) => ({ ...e, source: 'personal' as const })),
        count: personalResult.entries.length,
        degraded: isPersonalDegraded,
        nextCursor: personalResult.nextCursor,
        highlights: personalResult.highlights,
        suggestions: personalResult.suggestions,
        correctedQuery: personalResult.correctedQuery,
    }
}
