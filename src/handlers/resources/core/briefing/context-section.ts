/**
 * Briefing — Context Section Builders
 *
 * Builds the journal, team, rules-file, and skills-directory
 * context sections for the briefing resource.
 */

import { sliceUntrustedInline, type BriefingConfig, type ResourceContext } from '../../shared.js'
import type { JournalEntry } from '../../../../types/index.js'
import type { MirrorCandidate } from '../../../../utils/team-mirror.js'

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

const PREVIEW_FENCE_WRAPPER_RE =
    /^<untrusted_remote_content>\r?\n?([\s\S]*?)\r?\n?<\/untrusted_remote_content>$/i

export function cleanPreview(content: string | undefined | null, length: number): string {
    if (!content) return ''
    const fencedMatch = PREVIEW_FENCE_WRAPPER_RE.exec(content.trim())
    const unwrapped =
        fencedMatch?.[1] !== undefined
            ? fencedMatch[1]
                  .replaceAll('&lt;', '<')
                  .replaceAll('&gt;', '>')
                  .replaceAll('&amp;', '&')
            : content

    // Path Truncation and Noise Reduction
    const cleaned = unwrapped
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

function formatSummaryEntries(
    summaryEntries: JournalEntry[]
): { id: number; timestamp: string; type: string; preview: string }[] {
    return summaryEntries.map((entry: JournalEntry) => {
        const titleLine =
            entry.content.split(/\r?\n/)[0]?.replace(/^#+\s*(?:Session Summary:\s*)?/, '') ?? ''
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: entry.entryType,
            preview: sliceUntrustedInline(cleanPreview(titleLine, PREVIEW_LENGTH), PREVIEW_LENGTH + 1),
        }
    })
}

export function buildJournalContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null,
    activeWorkspaceId?: string
): JournalContext {
    const targetWs = activeWorkspaceId || config.defaultWorkspaceId || 'default'
    const filterImportant = createImportanceFilter(
        context,
        targetWs,
        config.briefingImportanceThreshold ?? 0.3
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

    // Fetch a larger buffer to account for entries that might get deduplicated out or filtered by importance
    const rawRecentEntries =
        config.entryCount > 0
            ? extractEntries(
                  context.db.searchEntries('', {
                      limit: Math.max(100, config.entryCount * 10),
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
