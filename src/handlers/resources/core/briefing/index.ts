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
    ASSISTANT_FOCUSED,
} from '../../../../utils/resource-annotations.js'
import { getGitHubIntegration } from '../../../../github/github-integration/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { buildGitHubSection } from './github-section.js'
import {
    buildJournalContext,
    buildTeamContext,
    buildFlagsContext,
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
    annotations: {
        ...withSessionInit(withPriority(1.0, ASSISTANT_FOCUSED)),
        autoRead: true,
    },
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
    annotations: {
        ...withPriority(0.9, ASSISTANT_FOCUSED),
    },
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

    if (targetRepo) {
        let resolvedRepo = targetRepo
        if (!config.projectRegistry?.[resolvedRepo]) {
            resolvedRepo = targetRepo.split('/').pop() || targetRepo
        }

        const registryEntry = config.projectRegistry?.[resolvedRepo]
        if (registryEntry) {
            const repoPath = registryEntry.path
            activeRepoPath = repoPath
            activeGithub = getGitHubIntegration(repoPath, context.runtime)
            activeProjectNumber = registryEntry.project_number ?? undefined
        }
    }

    // Build all sections
    const journal = buildJournalContext(context, config, activeProjectNumber)
    const github = await buildGitHubSection(activeGithub, config)
    const team = buildTeamContext(context, config, activeProjectNumber)
    const insights = buildInsightsSection(context)
    const flags = buildFlagsContext(context)
    const graphStats = buildGraphContext(context)

    const latestPreviews = journal.latestEntries.map((e) => `#${e.id} (${e.type}): ${e.preview}`)

    const summaryPreviews = journal.sessionSummaries
        ? journal.sessionSummaries.map((s) => `#${s.id} (${s.type}): ${s.preview}`)
        : null

    const system = buildSystemContext(config, context.filterConfig, activeRepoPath, context.resourceCount)

    // Build registry paths map for non-IDE agent context
    const registryPaths = config.projectRegistry
        ? Object.fromEntries(
              Object.entries(config.projectRegistry).map(([name, entry]) => [name, entry.path])
          )
        : undefined

    // Build registry project number map for briefing display
    const registryProjectNumbers = config.projectRegistry
        ? Object.fromEntries(
              Object.entries(config.projectRegistry)
                  .reduce<[string, number][]>((acc, [name, entry]) => {
                      if (entry.project_number !== undefined) {
                          acc.push([name, entry.project_number])
                      }
                      return acc
                  }, [])
          )
        : undefined

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
        flagSummary: flags,
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
        registryRepos: system.registryRepos,
        ioRootCount: system.ioRootCount,
        hasCodeMap: system.hasCodeMap,
        lastReleaseDaysAgo: system.lastReleaseDaysAgo ?? undefined,
        localCheck: system.localCheck ?? undefined,
        workspaceId: system.workspaceId ?? journal.workspaceId,
        deprecationWarnings: context.runtime?.metrics?.getDeprecationWarnings() ?? [],
        registryPaths,
        registryProjectNumbers,
    })

    return {
        data: userMessage,
        annotations: { lastModified: journal.lastModified },
    }
}
