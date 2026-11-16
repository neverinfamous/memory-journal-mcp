/**
 * Briefing — Context Section Builders
 *
 * Builds the journal, team, rules-file, and skills-directory
 * context sections for the briefing resource.
 */

import type { BriefingConfig, ResourceContext } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'

import {
    markUntrustedContentInline,
} from '../../../../utils/security-utils.js'
import { canAccessTeamSilently } from '../../../tools/search/helpers.js'
import type { JournalEntry } from '../../../../types/index.js'

// ============================================================================
// Journal Context
// ============================================================================

/** Content preview length for briefing entry summaries */
const PREVIEW_LENGTH = 120

function cleanPreview(content: string | undefined | null, length: number): string {
    if (!content) return ''
    
    // Path Truncation and Noise Reduction
    const cleaned = content
        .replace(/## Accomplished - /g, '')
        .replace(/## Accomplished\n?/g, '')
        // Windows paths
        .replace(/C:\\Users\\[^\\]+\\.gemini\\antigravity(?:-ide)?\\brain/gi, '<appDataDir>\\brain')
        .replace(/C:\\Users\\[^\\]+\\Desktop/gi, '<desktop>')
        // Linux/Mac paths
        .replace(/\/home\/[^/]+\/\.gemini\/antigravity(?:-ide)?\/brain/g, '<appDataDir>/brain')
        .replace(/\/home\/[^/]+\/Desktop/g, '<desktop>')
        .replace(/\/Users\/[^/]+\/\.gemini\/antigravity(?:-ide)?\/brain/g, '<appDataDir>/brain')
        .replace(/\/Users\/[^/]+\/Desktop/g, '<desktop>')
        .replace(/\r?\n/g, ' ')
        .trim()
        
    if (cleaned.length <= length) return cleaned

    // First try to truncate at the last full sentence or bullet point within the length limit
    const truncated = cleaned.slice(0, length)
    const sentenceBoundaryMatch = /.*[.?!](?=\s|$)/.exec(truncated)
    if (sentenceBoundaryMatch && sentenceBoundaryMatch[0].length > length * 0.4) {
        return sentenceBoundaryMatch[0]
    }

    // Fallback: Truncate at a word boundary to avoid cutting mid-word
    const lastSpace = truncated.lastIndexOf(' ')
    const boundary = lastSpace > length * 0.6 ? lastSpace : length
    return cleaned.slice(0, boundary) + '…'
}

export interface JournalContext {
    totalEntries: number
    latestEntries: { id: number; timestamp: string; type: string; preview: string }[]
    latestSessionSummary?: { id: number; timestamp: string; type: string; preview: string }
    sessionSummaries?: { id: number; timestamp: string; type: string; preview: string }[]
    lastModified: string
    workspaceId?: string
}

function extractEntries(result: JournalEntry[] | { entries: JournalEntry[] }): JournalEntry[] {
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

export function buildJournalContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null,
    activeWorkspaceId?: string
): JournalContext {
    const targetWs = activeWorkspaceId || config.defaultWorkspaceId || 'default'
    const threshold = config.briefingImportanceThreshold ?? 0.3
    const importanceScoreCache = new Map<number, number>()
    const filterImportant = (entries: JournalEntry[]): JournalEntry[] => {
        if (entries.length === 0) return []
        const missingIds: number[] = []
        for (const e of entries) {
            if (!e.tags?.includes('session-summary') && e.importanceScore === undefined && !importanceScoreCache.has(e.id)) {
                missingIds.push(e.id)
            }
        }
        if (missingIds.length > 0 && typeof context.db.getEntriesByIdsWithImportance === 'function') {
            const hydratedMap = context.db.getEntriesByIdsWithImportance(missingIds, targetWs)
            for (const [id, hydrated] of hydratedMap) {
                importanceScoreCache.set(id, hydrated.importance.score)
            }
        }
        return entries.filter((e) => {
            if (e.tags?.includes('session-summary')) return true
            const score =
                e.importanceScore ??
                importanceScoreCache.get(e.id) ??
                context.db.calculateImportance(e.id, targetWs)?.score ?? 0
            return score >= threshold
        })
    }

    const finalSummaryEntries = fetchBriefingSummaries(
        context,
        config,
        targetWs,
        projectNumber,
        filterImportant
    )

    let latestSessionSummary
    let sessionSummaries
    if (finalSummaryEntries.length > 0) {
        sessionSummaries = finalSummaryEntries.map((entry: JournalEntry) => {
            const titleLine = entry.content.split(/\r?\n/)[0]?.replace(/^#+\s*(?:Session Summary:\s*)?/, '') ?? ''
            return {
                id: entry.id,
                timestamp: entry.timestamp,
                type: entry.entryType,
                preview: markUntrustedContentInline(cleanPreview(titleLine, PREVIEW_LENGTH)),
            }
        })
        
        latestSessionSummary = sessionSummaries[0]
    }

    // Fetch a larger buffer to account for entries that might get deduplicated out or filtered by importance
    const fetchLimit = Math.max(100, config.entryCount * 10)
    const rawRecentEntries = extractEntries(
        context.db.searchEntries('', { 
            limit: fetchLimit, 
            workspaceId: targetWs,
            ...(typeof projectNumber === 'number' ? { projectNumber } : {}),
            sortBy: 'timestamp'
        })
    )
            
    let recentEntries = filterImportant(rawRecentEntries)
    if (recentEntries.length === 0 && rawRecentEntries.length > 0) {
        recentEntries = rawRecentEntries
    }

    // Exclude entries already shown in the Summary slot to diversify briefing content
    const summaryIds = new Set(finalSummaryEntries.map((e: JournalEntry) => e.id))
    const dedupedRecent = recentEntries.filter((e: JournalEntry) => !summaryIds.has(e.id)).slice(0, config.entryCount)

    const latestEntries = dedupedRecent.map((e: JournalEntry) => {
        return {
            id: e.id,
            timestamp: e.timestamp,
            type: e.entryType,
            preview: markUntrustedContentInline(cleanPreview(e.content, PREVIEW_LENGTH)),
        }
    })

    const totalEntries = context.db.getActiveEntryCount(targetWs)
    const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString()

    return { totalEntries, latestEntries, latestSessionSummary, sessionSummaries, lastModified, workspaceId: targetWs }
}

// ============================================================================
// Team Context
// ============================================================================

/** Team DB preview length */
const TEAM_PREVIEW_LENGTH = 60

export interface TeamContext {
    teamInfo: { totalEntries: number; latestPreview: string | null }
    teamLatestEntries?: { id: number; timestamp: string; type: string; preview: string }[]
}

export function buildTeamContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null,
    activeWorkspaceId?: string
): TeamContext | undefined {
    if (!context.teamDb) return undefined

    try {
        const teamWorkspace = activeWorkspaceId ?? config.defaultWorkspaceId ?? 'default'
        const accessAllowed = canAccessTeamSilently(
            'search_entries',
            {
                teamDb: context.teamDb,
                config: {
                    ...(config.defaultWorkspaceId !== undefined
                        ? { defaultWorkspaceId: config.defaultWorkspaceId }
                        : {}),
                    ...(config.defaultProjectNumber !== undefined
                        ? { defaultProjectNumber: config.defaultProjectNumber }
                        : {}),
                    ...(config.projectRegistry !== undefined
                        ? { projectRegistry: config.projectRegistry }
                        : {}),
                    teamDefaultRole: context.runtime?.teamDefaultRole ?? 'denied',
                },
            },
            teamWorkspace
        )
        if (!accessAllowed) return undefined
        const teamTotalEntries = context.teamDb.getActiveEntryCount(teamWorkspace)
        const teamRecent =
            typeof projectNumber === 'number'
                ? extractEntries(context.teamDb.searchEntries('', { limit: 1, projectNumber, workspaceId: teamWorkspace }))
                : extractEntries(context.teamDb.getRecentEntries(1, undefined, 'timestamp', undefined, false, teamWorkspace))
        const teamLatestEntry = teamRecent[0] as Record<string, unknown> | undefined
        const teamContent = teamLatestEntry
            ? ((teamLatestEntry['content'] as string | undefined) ?? '')
            : ''
        const teamLatest = teamLatestEntry
            ? `#${String(teamLatestEntry['id'])}: ${markUntrustedContentInline(cleanPreview(teamContent, TEAM_PREVIEW_LENGTH))}`
            : null
        const teamInfo = {
            totalEntries: teamTotalEntries,
            latestPreview: teamLatest,
        }

        let teamLatestEntries:
            | { id: number; timestamp: string; type: string; preview: string }[]
            | undefined = undefined

        if (config.includeTeam) {
            const teamEntries =
                typeof projectNumber === 'number'
                    ? extractEntries(context.teamDb.searchEntries('', { limit: config.entryCount, projectNumber, workspaceId: teamWorkspace }))
                    : extractEntries(context.teamDb.getRecentEntries(config.entryCount, undefined, 'timestamp', undefined, false, teamWorkspace))
            teamLatestEntries = teamEntries.map((e) => {
                return {
                    id: e.id,
                    timestamp: e.timestamp,
                    type: e.entryType,
                    preview: markUntrustedContentInline(
                        cleanPreview(e.content, TEAM_PREVIEW_LENGTH)
                    ),
                }
            })
        }

        return { teamInfo, teamLatestEntries }
    } catch (error) {
        logger.debug('Failed to build team context', {
            module: 'BRIEFING',
            operation: 'team-context',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

// ============================================================================
// Rules & Skills Awareness
// ============================================================================





// ============================================================================
// Graph Context
// ============================================================================

export interface GraphSummary {
    totalRelationships: number
    density: number
    causalMetrics: Record<string, number>
    topHubs: { id: number; preview: string; count: number }[]
    orphanRatio?: number
    degraded?: boolean
}

export function buildGraphContext(context: ResourceContext, workspaceId?: string): GraphSummary | undefined {
    try {
        const targetWs = workspaceId ?? 'default'
        const stats = context.db.getStatistics('week', undefined, undefined, false, targetWs)
        const comp = stats['relationshipComplexity'] as
            | { totalRelationships: number; avgPerEntry: number }
            | undefined
        const causal = stats['causalMetrics'] as Record<string, number> | undefined

        if (!comp || !causal) return undefined


        const totalActiveEntries = context.db.getActiveEntryCount(targetWs)

        // Fetch top hubs and orphan ratio via purpose-built safe methods
        let topHubs: { id: number; preview: string; count: number }[] = []
        let orphanRatio: number | undefined
        let degraded = false

        try {
            const hubs = context.db.getRelationshipHubs(3, targetWs)
            topHubs = hubs.map(hub => ({
                id: hub.entryId,
                count: hub.totalLinks,
                preview: ''
            }))

            if (totalActiveEntries > 0) {
                const orphanCount = context.db.getOrphanCount(targetWs)
                orphanRatio = orphanCount / totalActiveEntries
            }
        } catch (error) {
            degraded = true
            logger.warning('Graph hub query failed', {
                module: 'BRIEFING',
                operation: 'graph-context',
                error: error instanceof Error ? error.message : String(error),
            })
        }

        return {
            totalRelationships: comp.totalRelationships,
            density: comp.avgPerEntry,
            causalMetrics: causal,
            topHubs,
            orphanRatio,
            ...(degraded ? { degraded: true } : {}),
        }
    } catch (error) {
        logger.debug('Failed to build graph context', {
            module: 'BRIEFING',
            operation: 'graph-context',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}
