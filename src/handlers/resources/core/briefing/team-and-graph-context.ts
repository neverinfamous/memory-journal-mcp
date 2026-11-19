/**
 * Briefing — Team and Graph Context Section Builders
 *
 * Extracted from `context-section.ts` (Appendix A & B) to keep file and
 * function line counts within project modularization budgets.
 */

import { sliceUntrustedInline, type BriefingConfig, type ResourceContext } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'
import { canAccessTeamSilently } from '../../../tools/search/helpers.js'
import type { JournalEntry } from '../../../../types/index.js'
import {
    buildPersonalMirrorIndex,
    isTeamMirrorOf,
    type MirrorCandidate,
} from '../../../../utils/team-mirror.js'
import { cleanPreview, extractEntries } from './context-section.js'
import { previewLabel } from './graph-pivots-section.js'

// ============================================================================
// Team Context
// ============================================================================

/** Team DB preview length */
const TEAM_PREVIEW_LENGTH = 60

export interface TeamContext {
    teamInfo: { totalEntries: number; latestPreview: string | null }
    teamLatestEntries?: { id: number; timestamp: string; type: string; preview: string }[]
}

function fetchDistinctTeamBriefingEntries(
    teamDb: NonNullable<ResourceContext['teamDb']>,
    teamWorkspace: string,
    fetchCap: number,
    projectNumber: number | null | undefined,
    personalCandidates: readonly MirrorCandidate[] | undefined
): JournalEntry[] {
    const teamCandidates =
        typeof projectNumber === 'number'
            ? extractEntries(
                  teamDb.searchEntries('', {
                      limit: fetchCap,
                      projectNumber,
                      workspaceId: teamWorkspace,
                  })
              )
            : extractEntries(
                  teamDb.getRecentEntries(
                      fetchCap,
                      undefined,
                      'timestamp',
                      undefined,
                      false,
                      teamWorkspace
                  )
              )
    const origins =
        teamCandidates.length > 0
            ? teamDb.getMirrorOrigins?.(teamCandidates.map((e) => e.id))
            : undefined
    const personalIdx =
        personalCandidates && personalCandidates.length > 0
            ? buildPersonalMirrorIndex(personalCandidates)
            : undefined
    if (!personalIdx) return teamCandidates

    return teamCandidates.filter((e) => {
        const explicitOrigin =
            'originPersonalId' in e && typeof e.originPersonalId === 'number'
                ? e.originPersonalId
                : undefined
        const originId = origins?.get(e.id) ?? explicitOrigin
        return !isTeamMirrorOf(
            {
                id: e.id,
                content: e.content,
                timestamp: e.timestamp,
                ...(e.workspaceId !== undefined ? { workspaceId: e.workspaceId } : {}),
                ...(originId !== undefined ? { originPersonalId: originId } : {}),
            },
            personalIdx
        )
    })
}

export function buildTeamContext(
    context: ResourceContext,
    config: BriefingConfig,
    projectNumber?: number | null,
    activeWorkspaceId?: string,
    personalCandidates?: readonly MirrorCandidate[]
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
        const fetchCap = Math.max((config.entryCount ?? 3) * 3, 10)
        const distinctTeam = fetchDistinctTeamBriefingEntries(
            context.teamDb,
            teamWorkspace,
            fetchCap,
            projectNumber,
            personalCandidates
        )

        const teamLatestEntry = distinctTeam[0]
        const teamLatest = teamLatestEntry
            ? `#${String(teamLatestEntry.id)}: ${sliceUntrustedInline(cleanPreview(teamLatestEntry.content, TEAM_PREVIEW_LENGTH), TEAM_PREVIEW_LENGTH + 1)}`
            : null
        const teamInfo = {
            totalEntries: teamTotalEntries,
            latestPreview: teamLatest,
        }

        const teamLatestEntries = config.includeTeam
            ? distinctTeam.slice(0, config.entryCount).map((e) => ({
                  id: e.id,
                  timestamp: e.timestamp,
                  type: e.entryType,
                  preview: sliceUntrustedInline(
                      cleanPreview(e.content, TEAM_PREVIEW_LENGTH),
                      TEAM_PREVIEW_LENGTH + 1
                  ),
              }))
            : undefined

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

export function buildGraphContext(
    context: ResourceContext,
    workspaceId?: string,
    precomputedActiveCount?: number
): GraphSummary | undefined {
    try {
        const targetWs = workspaceId ?? 'default'
        const stats = context.db.getStatistics('week', undefined, undefined, false, targetWs)
        const comp = stats['relationshipComplexity'] as
            | { totalRelationships: number; avgPerEntry: number }
            | undefined
        const causal = stats['causalMetrics'] as Record<string, number> | undefined

        if (!comp || !causal) return undefined

        const totalActiveEntries =
            precomputedActiveCount ?? context.db.getActiveEntryCount(targetWs)

        let topHubs: { id: number; preview: string; count: number }[] = []
        let orphanRatio: number | undefined
        let degraded = false

        try {
            const hubs = context.db.getRelationshipHubs(3, targetWs)
            topHubs = hubs.map((hub) => ({
                id: hub.entryId,
                count: hub.totalLinks,
                // [INTENT] Previews let agents judge whether a hub is worth expanding (bare IDs cannot).
                preview: previewLabel(hub.content),
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
