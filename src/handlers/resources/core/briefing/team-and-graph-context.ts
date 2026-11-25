/**
 * Briefing — Team and Graph Context Section Builders
 *
 * Extracted from `context-section.ts` (Appendix A & B) to keep file and
 * function line counts within project modularization budgets.
 */

import { sliceUntrustedInline, type BriefingConfig, type ResourceContext } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'
import { isRecord } from '../../../../utils/type-guards.js'
import { activeProjectRegistry } from '../../../../utils/write-scope.js'
import { canAccessTeamSilently, isTeamFilterAllowed } from '../../../tools/search/helpers.js'
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
    teamLatestEntries?: { id: number; timestamp: string; type: string; preview: string }[] | undefined
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
    const personalIdx =
        personalCandidates && personalCandidates.length > 0
            ? buildPersonalMirrorIndex(personalCandidates)
            : undefined
    if (!personalIdx) return teamCandidates

    const origins =
        teamCandidates.length > 0
            ? teamDb.getMirrorOrigins?.(teamCandidates.map((e) => e.id))
            : undefined

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

function canBuildScopedTeamContext(
    teamDb: NonNullable<ResourceContext['teamDb']>,
    config: BriefingConfig,
    teamWorkspace: string,
    projectNumber: number | null | undefined,
    runtime: ResourceContext['runtime'],
    filterConfig: ResourceContext['filterConfig']
): boolean {
    if (!isTeamFilterAllowed('team_search', { filterConfig })) return false
    const accessAllowed = canAccessTeamSilently(
        'search_entries',
        {
            teamDb,
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
                teamDefaultRole: runtime?.teamDefaultRole ?? 'denied',
                ...(filterConfig !== undefined ? { filterConfig } : {}),
            },
        },
        teamWorkspace
    )
    if (!accessAllowed) return false

    const resolvedRegistry = activeProjectRegistry(config.projectRegistry)
    const hasActiveRegistry =
        resolvedRegistry !== undefined && Object.keys(resolvedRegistry).length > 0
    return !(typeof projectNumber !== 'number' && hasActiveRegistry)
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
        if (
            !canBuildScopedTeamContext(
                context.teamDb,
                config,
                teamWorkspace,
                projectNumber,
                context.runtime,
                context.filterConfig
            )
        ) {
            return undefined
        }

        const scopedProject = typeof projectNumber === 'number' ? projectNumber : undefined
        const teamTotalEntries =
            scopedProject !== undefined
                ? context.teamDb.getActiveEntryCount(teamWorkspace, scopedProject)
                : context.teamDb.getActiveEntryCount(teamWorkspace)
        // [INVARIANT] `briefingEntries: 0` hides team previews too, so skip the team entry query
        // entirely (only the cheap active-count above is still needed for the Team total).
        const fetchCap = Math.max((config.entryCount ?? 3) * 3, 10)
        const distinctTeam =
            (config.entryCount ?? 3) <= 0
                ? []
                : fetchDistinctTeamBriefingEntries(
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
    orphanRatio?: number | undefined
    degraded?: boolean | undefined
}

function parseRelationshipComplexity(
    val: unknown
): { totalRelationships: number; avgPerEntry: number } | undefined {
    if (!isRecord(val)) return undefined
    const total = val['totalRelationships']
    const avg = val['avgPerEntry']
    if (typeof total !== 'number' || typeof avg !== 'number') return undefined
    return { totalRelationships: total, avgPerEntry: avg }
}

function parseCausalMetrics(val: unknown): Record<string, number> | undefined {
    if (!isRecord(val)) return undefined
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(val)) {
        if (typeof v === 'number') {
            out[k] = v
        }
    }
    return out
}

export function buildGraphContext(
    context: ResourceContext,
    workspaceId?: string,
    precomputedActiveCount?: number,
    options?: { includeHubs?: boolean; includeOrphanRatio?: boolean }
): GraphSummary | undefined {
    try {
        const targetWs = workspaceId ?? 'default'
        const stats = context.db.getStatistics('week', undefined, undefined, false, targetWs)
        const comp = parseRelationshipComplexity(stats['relationshipComplexity'])
        const causal = parseCausalMetrics(stats['causalMetrics'])

        if (!comp || !causal) return undefined

        const totalActiveEntries =
            precomputedActiveCount ?? context.db.getActiveEntryCount(targetWs)

        let topHubs: { id: number; preview: string; count: number }[] = []
        let orphanRatio: number | undefined
        let degraded = false
        const includeHubs = options?.includeHubs ?? true
        const includeOrphanRatio = options?.includeOrphanRatio ?? true

        if (comp.totalRelationships === 0) {
            if (includeOrphanRatio && totalActiveEntries > 0) {
                orphanRatio = 1
            }
            return {
                totalRelationships: comp.totalRelationships,
                density: comp.avgPerEntry,
                causalMetrics: causal,
                topHubs,
                orphanRatio,
            }
        }

        try {
            if (includeHubs) {
                const hubs = context.db.getRelationshipHubs(3, targetWs)
                topHubs = hubs.map((hub) => ({
                    id: hub.entryId,
                    count: hub.totalLinks,
                    // [INTENT] Previews let agents judge whether a hub is worth expanding (bare IDs cannot).
                    preview: previewLabel(hub.content),
                }))
            }

            if (includeOrphanRatio && totalActiveEntries > 0) {
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
