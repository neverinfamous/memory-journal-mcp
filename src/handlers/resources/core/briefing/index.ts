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
import { getGitHubIntegration } from '../../../../github/github-integration/index.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    setActiveSessionProject,
} from '../../../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../../../utils/write-scope.js'
import { DEFAULT_BRIEFING_CONFIG, resourceWorkspace } from '../../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { buildGitHubSection } from './github-section.js'
import {
    buildJournalContext,
    buildTeamContext,
    buildGraphContext,
} from './context-section.js'
import { formatUserMessage } from './user-message.js'
import { buildInsightsSection } from './insights-section.js'
import { buildSystemContext } from './system-section.js'

export const briefingResource: InternalResourceDef = {
    uri: 'memory://briefing',
    name: 'Initial Briefing',
    title: 'Session Initialization Context',
    description:
        'AUTO-READ AT SESSION START: Returns the exact markdown string to display to the user for the briefing.',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: withAutoRead(withSessionInit(withPriority(1.0, ASSISTANT_FOCUSED))),
    handler: async (_uri: string, context: ResourceContext) => {
        return buildBriefingData(context)
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
        const match = /memory:\/\/briefing\/(.+)/.exec(uri)
        const repoName = match?.[1] ? decodeURIComponent(match[1]) : undefined
        return buildBriefingData(context, repoName)
    },
}

export async function buildBriefingData(
    context: ResourceContext,
    targetRepo?: string
): Promise<ResourceResult> {
    const config = { ...DEFAULT_BRIEFING_CONFIG, ...context.briefingConfig }

    let activeGithub = context.github
    let activeProjectNumber = config.defaultProjectNumber
    let activeRepoPath: string | undefined
    let activeWorkspaceId: string | undefined = resourceWorkspace({
        briefingConfig: config,
        ...(context.runtime !== undefined ? { runtime: context.runtime } : {}),
    })

    const registry = config.projectRegistry ?? loadProjectRegistryFromConfig()
    if (targetRepo) {
        const numericTarget = /^#?(\d+)$/.exec(targetRepo)
        const numericWorkspace =
            numericTarget !== null
                ? uniqueWorkspaceForProject(Number(numericTarget[1]), registry)
                : undefined
        const resolvedRepo = exactRegistryKey(targetRepo, registry) ?? numericWorkspace
        if (resolvedRepo !== undefined) {
            activeWorkspaceId = resolvedRepo

            const registryEntry = registry?.[resolvedRepo]
            if (registryEntry) {
                const repoPath = registryEntry.path
                activeRepoPath = repoPath
                activeGithub = getGitHubIntegration(repoPath, context.runtime)
                activeProjectNumber = registryEntry.project_number
                setActiveSessionProject(resolvedRepo, activeProjectNumber ?? null, context.runtime)
            }
        } else if (targetRepo.trim().toLowerCase() === 'default') {
            activeWorkspaceId = 'default'
            const registeredDefault = registry?.['default']?.project_number
            activeProjectNumber = registeredDefault
            setActiveSessionProject('default', registeredDefault ?? null, context.runtime)
        }
    } else if (activeWorkspaceId && activeWorkspaceId !== 'default' && activeWorkspaceId !== '*') {
        const canonicalKey = findCanonicalRegistryKey(activeWorkspaceId, registry) ?? activeWorkspaceId
        activeWorkspaceId = canonicalKey
        const registryEntry = registry?.[canonicalKey]
        if (registryEntry) {
            activeRepoPath = registryEntry.path
            activeGithub = getGitHubIntegration(registryEntry.path, context.runtime)
            if (registryEntry.project_number !== undefined) {
                activeProjectNumber = registryEntry.project_number
            }
        }
    }

    // Build all sections
    const journal = buildJournalContext(context, config, activeProjectNumber, activeWorkspaceId)
    const github = await buildGitHubSection(
        activeGithub,
        config,
        activeRepoPath !== undefined ? activeWorkspaceId : undefined
    )
    const team = buildTeamContext(context, config, activeProjectNumber, activeWorkspaceId)
    const insights = buildInsightsSection(context, activeWorkspaceId)
    const graphStats = buildGraphContext(context, journal.workspaceId)

    const latestPreviews = journal.latestEntries.map((e) => `#${e.id} (${e.type}): ${e.preview}`)

    const summaryPreviews = journal.sessionSummaries
        ? journal.sessionSummaries.map((s) => `#${s.id} (${s.type}): ${s.preview}`)
        : null

    const system = buildSystemContext(config, context.filterConfig, activeRepoPath, context.resourceCount)

    const userMessage = formatUserMessage({
        repoName: github?.repo ?? 'local',
        branchName: github?.branch ?? 'unknown',
        ciStatus: github?.ci ?? 'unknown',
        totalEntries: journal.totalEntries,
        latestPreviews,
        summaryPreviews,
        github,
        teamTotalEntries: team?.teamInfo.totalEntries,
        analyticsInsights: insights ?? undefined,
        graphSummary: graphStats,
        version: system.version,
        toolCount: system.toolCount,
        resourceCount: system.resourceCount,
        promptCount: system.promptCount,
        localTime: system.localTime,
        gitHistory: system.gitHistory ?? undefined,
        testHealth: system.testHealth ?? undefined,
        filterSummary: system.filterSummary,
        isReadonly: system.isReadonly,
        teamConfigured: !!context.teamDb,
        githubConfigured: !!activeGithub,
        ioRootCount: system.ioRootCount,
        hasCodeMap: system.hasCodeMap,
        lastReleaseDaysAgo: system.lastReleaseDaysAgo ?? undefined,
        localCheck: system.localCheck ?? undefined,
        workspaceId: journal.workspaceId ?? system.workspaceId,
        deprecationWarnings: context.runtime?.metrics?.getDeprecationWarnings() ?? [],
    })

    return {
        data: userMessage,
        annotations: { lastModified: journal.lastModified },
    }
}
