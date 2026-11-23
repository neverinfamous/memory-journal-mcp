/**
 * Briefing Resource — Barrel
 *
 * Composes the sub-modules (GitHub, context, user message) into the
 * single `briefingResource` definition exported for MCP registration.
 */

import { ICON_BRIEFING } from '../../../../constants/icons.js'
import {
    withPriority,
    withSessionInit,
    withAutoRead,
    ASSISTANT_FOCUSED,
} from '../../../../utils/resource-annotations.js'
import {
    DEFAULT_BRIEFING_CONFIG,
    getBaseUri,
    safeDecodeUriSegment,
} from '../../shared.js'
import { sanitizeDisplayIdentifier } from '../../fencing-helpers.js'
import { logger } from '../../../../utils/logger.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { buildGitHubSection } from './github-section.js'
import {
    safeBuildJournalContext,
    buildTeamContext,
    buildGraphContext,
    type JournalContext,
} from './context-section.js'
import { formatUserMessage } from './user-message.js'
import { buildInsightsSection } from './insights-section.js'
import { buildBriefingSystemSummary, type SystemContext } from './system-section.js'
import {
    buildGraphPivots,
    degreeSuffix,
    resolveBriefingToolNaming,
    resolveToolHintName,
} from './graph-pivots-section.js'
import { resolveBriefingScope } from './scope-resolver.js'

function parsePinSessionOption(uri: string): boolean {
    const queryIdx = uri.indexOf('?')
    if (queryIdx === -1) return true
    const hashIdx = uri.indexOf('#', queryIdx)
    const rawQuery = hashIdx === -1 ? uri.slice(queryIdx + 1) : uri.slice(queryIdx + 1, hashIdx)
    return new URLSearchParams(rawQuery).get('pin_session')?.trim().toLowerCase() !== 'false'
}

export const briefingResource: InternalResourceDef = {
    uri: 'memory://briefing',
    name: 'Initial Briefing',
    title: 'Session Initialization Context',
    description:
        'AUTO-READ AT SESSION START: Returns the exact markdown string to display to the user for the briefing.',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: withAutoRead(withSessionInit(withPriority(1.0, ASSISTANT_FOCUSED))),
    handler: async (uri: string, context: ResourceContext) => {
        return buildBriefingData(context, undefined, { pinSession: parsePinSessionOption(uri) })
    },
}

export const dynamicBriefingResource: InternalResourceDef = {
    uri: 'memory://briefing/{+repo}',
    name: 'Dynamic Briefing',
    title: 'Project-Specific Session Context',
    description:
        'Project-specific briefing context for AI agents. Same as memory://briefing but targets a specific repository name from the registered workspaces.',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: withPriority(0.9, ASSISTANT_FOCUSED),
    handler: async (uri: string, context: ResourceContext) => {
        const pinSession = parsePinSessionOption(uri)
        const match = /^memory:\/\/briefing\/(.+)$/.exec(getBaseUri(uri))
        const repoName = match?.[1] ? safeDecodeUriSegment(match[1]) : undefined
        return buildBriefingData(context, repoName, { pinSession })
    },
}

function buildFallbackSystemContext(
    config: typeof DEFAULT_BRIEFING_CONFIG,
    workspaceId: string
): SystemContext {
    return {
        version: '',
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        localTime: '',
        gitHistory: null,
        testHealth: null,
        filterSummary: null,
        isReadonly: false,
        ioRootCount: config.allowedIoRoots?.length ?? 0,
        hasCodeMap: false,
        lastReleaseDaysAgo: null,
        localCheck: null,
        workspaceId,
    }
}

function buildBriefingToolHints(filterConfig: ResourceContext['filterConfig']): {
    expand: string
    link: string
    summary: string
    team: string
} {
    return {
        expand: resolveToolHintName(
            filterConfig,
            'visualize_relationships',
            'mj.relationships.visualizeRelationships({ entry_id, depth: 2 })'
        ),
        link: resolveToolHintName(filterConfig, 'link_entries', 'mj.relationships.linkEntries'),
        summary: resolveToolHintName(filterConfig, 'get_entry_by_id', 'mj.core.getEntryById'),
        team: resolveToolHintName(filterConfig, 'team_get_entry_by_id', 'mj.team.teamGetEntryById'),
    }
}

function renderBriefingUserMessage(params: {
    context: ResourceContext
    config: typeof DEFAULT_BRIEFING_CONFIG
    activeGithub: ResourceContext['github']
    activeWorkspaceId: string | undefined
    journal: JournalContext
    github: Awaited<ReturnType<typeof buildGitHubSection>>
    system: SystemContext
    team: ReturnType<typeof buildTeamContext>
}): string {
    const { context, config, activeGithub, activeWorkspaceId, journal, github, system, team } = params
    const insights = config.insights !== false ? buildInsightsSection(context, activeWorkspaceId) : null
    const graphPivots =
        config.graphPivots !== false
            ? buildGraphPivots(
                  context,
                  journal.workspaceId,
                  [
                      ...journal.latestEntries.map((e) => e.id),
                      ...(journal.sessionSummaries ?? []).map((s) => s.id),
                  ],
                  system.gitHistory?.commits.map((c) => c.hash) ?? []
              )
            : undefined
    const graphStats = buildGraphContext(context, journal.workspaceId, journal.totalEntries, {
        includeHubs: graphPivots === undefined || graphPivots.activeThreads.length === 0,
        includeOrphanRatio: graphPivots === undefined,
    })
    const toolNaming = resolveBriefingToolNaming(context.filterConfig)
    const toolHints = buildBriefingToolHints(context.filterConfig)
    const latestPreviews = journal.latestEntries.map(
        (e) => `#${e.id} (${e.type})${degreeSuffix(graphPivots, e.id)}: ${e.preview}`
    )
    const teamLatestPreviews =
        config.includeTeam && team?.teamLatestEntries && team.teamLatestEntries.length > 0
            ? team.teamLatestEntries.map((e) => `#${e.id} (${e.type}): ${e.preview}`)
            : undefined
    const summaryPreviews = journal.sessionSummaries
        ? journal.sessionSummaries.map(
              (s) => `#${s.id} (${s.type})${degreeSuffix(graphPivots, s.id)}: ${s.preview}`
          )
        : null
    const ciSuppressed =
        github !== null
            ? github.ciSuppressed === true
            : config.workflowCount <= 0 && !config.workflowStatusBreakdown

    return formatUserMessage({
        repoName: github?.repo ?? 'local',
        branchName: github?.branch ?? 'unknown',
        ciStatus: github?.ci ?? 'unknown',
        ...(ciSuppressed ? { ciSuppressed: true } : {}),
        ...(config.entryCount <= 0 ? { entriesSuppressed: true } : {}),
        totalEntries: journal.totalEntries,
        latestPreviews,
        ...(teamLatestPreviews !== undefined ? { teamLatestPreviews } : {}),
        summaryPreviews,
        github,
        ...(config.includeTeam && team?.teamInfo.totalEntries !== undefined
            ? { teamTotalEntries: team.teamInfo.totalEntries }
            : {}),
        analyticsInsights: insights ?? undefined,
        graphSummary: graphStats,
        ...(graphPivots !== undefined ? { graphPivots } : {}),
        toolNaming,
        toolHints,
        gitHistory: system.gitHistory ?? undefined,
        isReadonly: system.isReadonly,
        teamConfigured: !!context.teamDb,
        githubConfigured: !!activeGithub,
        ioRootCount: system.ioRootCount,
        workspaceId: journal.workspaceId ?? system.workspaceId,
        deprecationWarnings: context.runtime?.metrics?.getDeprecationWarnings() ?? [],
    })
}

export async function buildBriefingData(
    context: ResourceContext,
    targetRepo?: string,
    options?: { pinSession?: boolean }
): Promise<ResourceResult> {
    const config = { ...DEFAULT_BRIEFING_CONFIG, ...context.briefingConfig }
    const { hasRegistry, activeGithub, activeRepoPath, activeWorkspaceId, activeProjectNumber, unresolvedRepo } =
        resolveBriefingScope(context, config, targetRepo, options)

    if (unresolvedRepo !== undefined) {
        const safeRepo = sanitizeDisplayIdentifier(unresolvedRepo)
        const listHint = resolveToolHintName(
            context.filterConfig,
            'list_projects',
            'mj.admin.listProjects'
        )
        return {
            data: `# Briefing · ${safeRepo}\n\nWorkspace \`${safeRepo}\` is not a registered project in \`projectRegistry\`. Use \`${listHint}\` (or the project registry) to find a registered repository name, or read \`memory://briefing/default\`.`,
        }
    }

    const journalWorkspaceId = activeWorkspaceId || config.defaultWorkspaceId?.trim() || 'default'
    const suppressSystemCwd =
        targetRepo !== undefined ||
        (activeWorkspaceId !== undefined &&
            activeWorkspaceId !== '*' &&
            activeRepoPath === undefined &&
            (activeWorkspaceId !== 'default' ||
                hasRegistry ||
                config.defaultWorkspaceId?.trim().toLowerCase() === 'default'))
    const systemRepoPath = activeRepoPath ?? (suppressSystemCwd ? null : undefined)

    // [INTENT] Start network/git work first so the synchronous SQLite journal queries overlap it.
    const settledPromise = Promise.allSettled([
        buildGitHubSection(
            activeGithub,
            config,
            activeRepoPath !== undefined ? activeWorkspaceId : undefined,
            ...(activeGithub !== undefined && context.runtime !== undefined ? [context.runtime] : [])
        ),
        buildBriefingSystemSummary(
            config,
            context.filterConfig,
            systemRepoPath,
            context.resourceCount,
            journalWorkspaceId,
            { lite: true }
        ),
    ])
    const journal = safeBuildJournalContext(context, config, activeProjectNumber, activeWorkspaceId)
    const [githubSettled, systemSettled] = await settledPromise
    const github = githubSettled.status === 'fulfilled' ? githubSettled.value : null
    let system: SystemContext
    if (systemSettled.status === 'fulfilled') {
        system = systemSettled.value
    } else {
        logger.warning('Briefing system section failed (degraded)', {
            module: 'BRIEFING',
            operation: 'system-section',
            error:
                systemSettled.reason instanceof Error
                    ? systemSettled.reason.message
                    : String(systemSettled.reason),
        })
        system = buildFallbackSystemContext(config, journalWorkspaceId)
    }
    const team = config.includeTeam
        ? buildTeamContext(
              context,
              config,
              activeProjectNumber,
              activeWorkspaceId,
              journal.mirrorCandidates
          )
        : undefined
    const userMessage = renderBriefingUserMessage({
        context,
        config,
        activeGithub,
        activeWorkspaceId,
        journal,
        github,
        system,
        team,
    })

    return {
        data: userMessage,
        annotations: { lastModified: journal.lastModified },
    }
}
