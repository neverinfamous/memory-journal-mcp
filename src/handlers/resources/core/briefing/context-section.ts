/**
 * Briefing — Context Section Builders
 *
 * Builds the journal, team, rules-file, and skills-directory
 * context sections for the briefing resource.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BriefingConfig, ResourceContext } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'
import { parseFlagContext } from '../../../../types/auto-context.js'
import {
    markUntrustedContentInline,
    assertSafeFilePath,
    assertSafeDirectoryPath,
} from '../../../../utils/security-utils.js'

// ============================================================================
// Journal Context
// ============================================================================

/** Content preview length for briefing entry summaries */
const PREVIEW_LENGTH = 120

function cleanPreview(content: string | undefined | null, length: number): string {
    if (!content) return ''
    const clean = content.trim().replace(/\s+/g, ' ')
    if (clean.length <= length) return clean

    // Truncate at a word boundary to avoid cutting mid-word
    const truncated = clean.slice(0, length)
    const lastSpace = truncated.lastIndexOf(' ')
    const boundary = lastSpace > length * 0.6 ? lastSpace : length
    return clean.slice(0, boundary) + '…'
}

export interface JournalContext {
    totalEntries: number
    latestEntries: { id: number; timestamp: string; type: string; preview: string }[]
    latestSessionSummary?: { id: number; timestamp: string; type: string; preview: string }
    sessionSummaries?: { id: number; timestamp: string; type: string; preview: string }[]
    lastModified: string
}

export function buildJournalContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null
): JournalContext {
    // ── Session summaries (computed first to enable deduplication) ──────
    const summaryEntries =
        typeof projectNumber === 'number'
            ? context.db.searchEntries('', {
                  limit: config.summaryCount,
                  projectNumber,
                  tags: ['session-summary'],
              })
            : context.db.searchEntries('', {
                  limit: config.summaryCount,
                  tags: ['session-summary'],
              })

    // Fallback to retrospective type if no tag matched
    const retroEntries =
        summaryEntries.length === 0
            ? typeof projectNumber === 'number'
                ? context.db.searchEntries('', {
                      limit: config.summaryCount,
                      projectNumber,
                      entryType: 'retrospective',
                  })
                : context.db.searchEntries('', {
                      limit: config.summaryCount,
                      entryType: 'retrospective',
                  })
            : []

    const finalSummaryEntries = summaryEntries.length > 0 ? summaryEntries : retroEntries

    let latestSessionSummary
    let sessionSummaries
    if (finalSummaryEntries.length > 0) {
        sessionSummaries = finalSummaryEntries.map((entry) => {
            return {
                id: entry.id,
                timestamp: entry.timestamp,
                type: entry.entryType,
                preview: markUntrustedContentInline(cleanPreview(entry.content, PREVIEW_LENGTH)),
            }
        })
        latestSessionSummary = sessionSummaries[0]
    }

    // ── Latest entries (deduplicated against summaries) ──────────────
    const recentEntries =
        typeof projectNumber === 'number'
            ? context.db.searchEntries('', { limit: config.entryCount, projectNumber })
            : context.db.getRecentEntries(config.entryCount)

    // Exclude entries already shown in the Summary slot to diversify briefing content
    const summaryIds = new Set(finalSummaryEntries.map((e) => e.id))
    const dedupedRecent = recentEntries.filter((e) => !summaryIds.has(e.id))

    const latestEntries = dedupedRecent.map((e) => {
        return {
            id: e.id,
            timestamp: e.timestamp,
            type: e.entryType,
            preview: markUntrustedContentInline(cleanPreview(e.content, PREVIEW_LENGTH)),
        }
    })

    const totalEntries = context.db.getActiveEntryCount()
    const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString()

    return { totalEntries, latestEntries, latestSessionSummary, sessionSummaries, lastModified }
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
    projectNumber?: number | null
): TeamContext | undefined {
    if (!context.teamDb) return undefined

    try {
        const teamTotalEntries = context.teamDb.getActiveEntryCount()
        const teamRecent =
            typeof projectNumber === 'number'
                ? context.teamDb.searchEntries('', { limit: 1, projectNumber })
                : context.teamDb.getRecentEntries(1)
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
                    ? context.teamDb.searchEntries('', { limit: config.entryCount, projectNumber })
                    : context.teamDb.getRecentEntries(config.entryCount)
            teamLatestEntries = teamEntries.map((e) => {
                return {
                    id: e.id,
                    timestamp: e.timestamp,
                    type: e.entryType,
                    preview: markUntrustedContentInline(cleanPreview(e.content, TEAM_PREVIEW_LENGTH)),
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

export interface RulesFile {
    path: string
    name: string
    sizeKB: number
    lastModified: string
}

export interface SkillsDir {
    path: string
    count: number
    names: string[]
}

/** Milliseconds per hour / per day for age formatting */
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

export function buildRulesFileInfo(
    rulesFilePath: string | undefined,
    allowedIoRoots: string[] = []
): RulesFile | undefined {
    if (!rulesFilePath) return undefined

    try {
        const expandedRoots = [...allowedIoRoots, path.dirname(rulesFilePath)]
        assertSafeFilePath(rulesFilePath, expandedRoots)
        const stat = fs.statSync(rulesFilePath)
        const ageMs = Date.now() - stat.mtimeMs
        const ageHours = Math.floor(ageMs / MS_PER_HOUR)
        const ageDays = Math.floor(ageMs / MS_PER_DAY)
        const agoStr =
            ageDays > 0
                ? `${String(ageDays)}d ago`
                : ageHours > 0
                  ? `${String(ageHours)}h ago`
                  : 'just now'

        return {
            path: path.basename(rulesFilePath),
            name: path.basename(rulesFilePath),
            sizeKB: Math.round(stat.size / 1024),
            lastModified: agoStr,
        }
    } catch (error) {
        logger.debug('Failed to read rules file', {
            module: 'BRIEFING',
            operation: 'rules-file',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

export function buildSkillsDirInfo(
    skillsDirPath: string | undefined,
    allowedIoRoots: string[] = []
): SkillsDir | undefined {
    if (!skillsDirPath) return undefined

    try {
        const expandedRoots = [...allowedIoRoots, skillsDirPath]
        assertSafeDirectoryPath(skillsDirPath, expandedRoots)
        const entries = fs.readdirSync(skillsDirPath, { withFileTypes: true })
        const skillDirs = entries.filter((e) => e.isDirectory())
        return {
            path: path.basename(skillsDirPath),
            count: skillDirs.length,
            names: skillDirs.map((d) => d.name),
        }
    } catch (error) {
        logger.debug('Failed to read skills directory', {
            module: 'BRIEFING',
            operation: 'skills-dir',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

// ============================================================================
// Flags Context (Hush Protocol)
// ============================================================================

export interface FlagSummary {
    count: number
    flags: {
        id: number
        flag_type: string
        target_user: string | null
        preview: string
        fullContent: string
        timestamp: string
    }[]
}

/**
 * Build active (unresolved) flag summary for the briefing.
 * Returns undefined if team DB is not configured or no active flags exist.
 */
export function buildFlagsContext(context: ResourceContext): FlagSummary | undefined {
    if (!context.teamDb) return undefined

    try {
        const flagEntries = context.teamDb.searchEntries('', {
            entryType: 'flag',
            limit: 20,
        })

        const activeFlags = flagEntries
            .map((entry) => {
                const ctx = parseFlagContext(entry.autoContext)
                if (!ctx || ctx.resolved) return null

                return {
                    id: entry.id,
                    flag_type: ctx.flag_type,
                    target_user: ctx.target_user ?? null,
                    preview: markUntrustedContentInline(cleanPreview(entry.content, 80)),
                    fullContent: markUntrustedContentInline(entry.content),
                    timestamp: entry.timestamp,
                }
            })
            .filter((f): f is NonNullable<typeof f> => f !== null)

        if (activeFlags.length === 0) return undefined

        return {
            count: activeFlags.length,
            flags: activeFlags,
        }
    } catch (error) {
        logger.debug('Failed to build flags context', {
            module: 'BRIEFING',
            operation: 'flags-context',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

// ============================================================================
// Graph Context
// ============================================================================

export interface GraphSummary {
    totalRelationships: number
    density: number
    causalMetrics: Record<string, number>
}

export function buildGraphContext(
    context: ResourceContext
): GraphSummary | undefined {
    try {
        const stats = context.db.getStatistics('week')
        const comp = stats['relationshipComplexity'] as { totalRelationships: number; avgPerEntry: number } | undefined
        const causal = stats['causalMetrics'] as Record<string, number> | undefined

        if (!comp || !causal) return undefined

        return {
            totalRelationships: comp.totalRelationships,
            density: comp.avgPerEntry,
            causalMetrics: causal,
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
