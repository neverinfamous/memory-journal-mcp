/**
 * Briefing — Context Section Builders
 *
 * Builds the journal, team, rules-file, and skills-directory
 * context sections for the briefing resource.
 */

import { sliceUntrustedInline, type BriefingConfig, type ResourceContext } from '../../shared.js'
import type { JournalEntry } from '../../../../types/index.js'
import type { MirrorCandidate } from '../../../../utils/team-mirror.js'
import { extractPreview } from './preview-helpers.js'
import { logger } from '../../../../utils/logger.js'

export {
    buildGraphContext,
    buildTeamContext,
    type GraphSummary,
    type TeamContext,
} from './team-and-graph-context.js'

// ============================================================================
// Journal Context
// ============================================================================

/** Content preview length for briefing entry summaries */
const PREVIEW_LENGTH = 120

/** Unfenced multi-line preview (markers stripped, CMS-04 headings skipped, home paths redacted). */
export function cleanPreview(content: string | undefined | null, length: number): string {
    return extractPreview(content, length)
}

export interface JournalContext {
    totalEntries: number
    latestEntries: { id: number; timestamp: string; type: string; preview: string }[]
    latestSessionSummary?: { id: number; timestamp: string; type: string; preview: string }
    sessionSummaries?: { id: number; timestamp: string; type: string; preview: string }[]
    lastModified: string
    workspaceId?: string
    mirrorCandidates?: MirrorCandidate[]
}

export function extractEntries(result: JournalEntry[] | { entries: JournalEntry[] }): JournalEntry[] {
    if (Array.isArray(result)) return result
    return 'entries' in result ? result.entries : []
}



function fetchBriefingSummaries(
    context: ResourceContext,
    config: BriefingConfig,
    targetWs: string,
    projectNumber: number | null | undefined,
    filterImportant: (entries: JournalEntry[]) => JournalEntry[]
): JournalEntry[] {
    if ((config.summaryCount ?? 1) <= 0) return []
    const summaryFetchLimit = Math.max(20, (config.summaryCount ?? 1) * 5)
    const rawSummaryEntries = extractEntries(
        context.db.searchEntries('', {
            limit: summaryFetchLimit,
            ...(typeof projectNumber === 'number' ? { projectNumber } : {}),
            tags: ['session-summary'],
            workspaceId: targetWs,
            sortBy: 'timestamp',
        })
    )

    let summaryEntries = filterImportant(rawSummaryEntries)
    if (summaryEntries.length === 0 && rawSummaryEntries.length > 0) {
        summaryEntries = rawSummaryEntries
    }

    const rawRetroEntries =
        summaryEntries.length === 0
            ? extractEntries(
                  context.db.searchEntries('', {
                      limit: summaryFetchLimit,
                      ...(typeof projectNumber === 'number' ? { projectNumber } : {}),
                      entryType: 'retrospective',
                      workspaceId: targetWs,
                      sortBy: 'timestamp',
                  })
              )
            : []

    let retroEntries = filterImportant(rawRetroEntries)
    if (retroEntries.length === 0 && rawRetroEntries.length > 0) {
        retroEntries = rawRetroEntries
    }

    return (summaryEntries.length > 0 ? summaryEntries : retroEntries).slice(
        0,
        config.summaryCount ?? 1
    )
}

function createImportanceFilter(
    context: ResourceContext,
    targetWs: string,
    threshold: number
): (entries: JournalEntry[]) => JournalEntry[] {
    if (threshold <= 0) {
        return (entries: JournalEntry[]): JournalEntry[] => entries
    }
    const importanceScoreCache = new Map<number, number>()
    return (entries: JournalEntry[]): JournalEntry[] => {
        if (entries.length === 0) return []
        const missingIds: number[] = []
        for (const e of entries) {
            if (
                !e.tags?.includes('session-summary') &&
                e.importanceScore === undefined &&
                !importanceScoreCache.has(e.id)
            ) {
                missingIds.push(e.id)
            }
        }
        if (missingIds.length > 0) {
            if (typeof context.db.getImportanceScoresByIds === 'function') {
                const scoreMap = context.db.getImportanceScoresByIds(missingIds, targetWs)
                for (const [id, imp] of scoreMap) {
                    importanceScoreCache.set(id, imp.score)
                }
            } else if (typeof context.db.getEntriesByIdsWithImportance === 'function') {
                const hydratedMap = context.db.getEntriesByIdsWithImportance(missingIds, targetWs)
                for (const [id, hydrated] of hydratedMap) {
                    importanceScoreCache.set(id, hydrated.importance.score)
                }
            }
        }
        return entries.filter((e) => {
            if (e.tags?.includes('session-summary')) return true
            const score =
                e.importanceScore ??
                importanceScoreCache.get(e.id) ??
                context.db.calculateImportance(e.id, targetWs)?.score ??
                0
            return score >= threshold
        })
    }
}

function collectMirrorCandidates(
    includeTeam: boolean,
    finalSummaryEntries: readonly JournalEntry[],
    rawRecentEntries: readonly JournalEntry[]
): MirrorCandidate[] {
    if (!includeTeam) return []
    const seenMirrorIds = new Set<number>()
    const mirrorCandidates: MirrorCandidate[] = []
    for (const e of [...finalSummaryEntries, ...rawRecentEntries]) {
        if (seenMirrorIds.has(e.id)) continue
        seenMirrorIds.add(e.id)
        mirrorCandidates.push({
            id: e.id,
            content: e.content,
            timestamp: e.timestamp,
            ...(e.workspaceId !== undefined ? { workspaceId: e.workspaceId } : {}),
        })
    }
    return mirrorCandidates
}

function formatSummaryEntries(
    summaryEntries: JournalEntry[]
): { id: number; timestamp: string; type: string; preview: string }[] {
    return summaryEntries.map((entry: JournalEntry) => {
        // [INTENT] First meaningful line: an H1 title, else the first Accomplished bullet (never a bare CMS-04 heading).
        const titleLine = extractPreview(entry.content, PREVIEW_LENGTH, { firstLineOnly: true })
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: entry.entryType,
            preview: sliceUntrustedInline(titleLine, PREVIEW_LENGTH + 1),
        }
    })
}

/**
 * [BOUNDARY] SQLite failures degrade the Journal row instead of failing the whole briefing.
 */
export function safeBuildJournalContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null,
    activeWorkspaceId?: string
): JournalContext {
    try {
        return buildJournalContext(context, config, projectNumber, activeWorkspaceId)
    } catch (error) {
        logger.warning('Briefing journal context failed (degraded)', {
            module: 'BRIEFING',
            operation: 'journal-context',
            error: error instanceof Error ? error.message : String(error),
        })
        return {
            totalEntries: 0,
            latestEntries: [],
            lastModified: new Date().toISOString(),
            workspaceId: activeWorkspaceId || config.defaultWorkspaceId || 'default',
            mirrorCandidates: [],
        }
    }
}

export function buildJournalContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null,
    activeWorkspaceId?: string
): JournalContext {
    const targetWs = activeWorkspaceId || config.defaultWorkspaceId || 'default'
    const importanceThreshold = config.briefingImportanceThreshold ?? 0.3
    const filterImportant = createImportanceFilter(
        context,
        targetWs,
        importanceThreshold
    )

    const finalSummaryEntries = fetchBriefingSummaries(
        context,
        config,
        targetWs,
        projectNumber,
        filterImportant
    )
    const sessionSummaries =
        finalSummaryEntries.length > 0 ? formatSummaryEntries(finalSummaryEntries) : undefined
    const latestSessionSummary = sessionSummaries?.[0]

    // Fetch a larger buffer only when importance filtering needs candidates beyond the display cap
    const recentLimit =
        importanceThreshold > 0
            ? Math.max(100, config.entryCount * 10)
            : Math.max(config.entryCount + (config.summaryCount ?? 1), 10)
    const rawRecentEntries =
        config.entryCount > 0
            ? extractEntries(
                  context.db.searchEntries('', {
                      limit: recentLimit,
                      workspaceId: targetWs,
                      ...(typeof projectNumber === 'number' ? { projectNumber } : {}),
                      sortBy: 'timestamp',
                  })
              )
            : []

    let recentEntries = filterImportant(rawRecentEntries)
    if (recentEntries.length === 0 && rawRecentEntries.length > 0) {
        recentEntries = rawRecentEntries
    }

    // Exclude entries already shown in the Summary slot to diversify briefing content
    const summaryIds = new Set(finalSummaryEntries.map((e: JournalEntry) => e.id))
    const dedupedRecent = recentEntries
        .filter((e: JournalEntry) => !summaryIds.has(e.id))
        .slice(0, config.entryCount)

    const latestEntries = dedupedRecent.map((e: JournalEntry) => ({
        id: e.id,
        timestamp: e.timestamp,
        type: e.entryType,
        preview: sliceUntrustedInline(cleanPreview(e.content, PREVIEW_LENGTH), PREVIEW_LENGTH + 1),
    }))

    const totalEntries = context.db.getActiveEntryCount(targetWs)
    const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString()
    const mirrorCandidates = collectMirrorCandidates(
        config.includeTeam,
        finalSummaryEntries,
        rawRecentEntries
    )

    return {
        totalEntries,
        latestEntries,
        latestSessionSummary,
        sessionSummaries,
        lastModified,
        workspaceId: targetWs,
        mirrorCandidates,
    }
}
