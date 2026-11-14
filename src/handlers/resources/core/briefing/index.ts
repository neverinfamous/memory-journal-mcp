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
import { DEFAULT_BRIEFING_CONFIG, getBaseUri, resourceWorkspace } from '../../shared.js'
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

function parsePinSessionOption(uri: string): boolean {
    const queryIdx = uri.indexOf('?')
    if (queryIdx === -1) return true
    const hashIdx = uri.indexOf('#', queryIdx)
    const rawQuery = hashIdx === -1 ? uri.slice(queryIdx + 1) : uri.slice(queryIdx + 1, hashIdx)
    return new URLSearchParams(rawQuery).get('pin_session') !== 'false'
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
        const match = /memory:\/\/briefing\/(.+)/.exec(getBaseUri(uri))
        const repoName = match?.[1] ? decodeURIComponent(match[1]) : undefined
        return buildBriefingData(context, repoName, { pinSession })
    },
}

export async function buildBriefingData(
    context: ResourceContext,
    targetRepo?: string,
    options?: { pinSession?: boolean }
): Promise<ResourceResult> {
    const config = { ...DEFAULT_BRIEFING_CONFIG, ...context.briefingConfig }

    const registry = config.projectRegistry ?? loadProjectRegistryFromConfig()
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    let activeGithub = context.github
    let activeRepoPath: string | undefined
    let activeWorkspaceId: string | undefined = resourceWorkspace({
        briefingConfig: config,
        ...(context.runtime !== undefined ? { runtime: context.runtime } : {}),
    })
    let activeProjectNumber =
        (config.defaultWorkspaceId === undefined && activeWorkspaceId !== 'default') ||
        (activeWorkspaceId !== undefined &&
            config.defaultWorkspaceId?.toLowerCase() === activeWorkspaceId.toLowerCase())
            ? config.defaultProjectNumber
            : undefined

    if (targetRepo) {
        let matchedTargetRepo = false
        const numericTarget = /^#?(\d+)$/.exec(targetRepo)
        const numericWorkspace =
            numericTarget !== null
                ? uniqueWorkspaceForProject(Number(numericTarget[1]), registry)
                : undefined
        const resolvedRepo = exactRegistryKey(targetRepo, registry) ?? numericWorkspace
        if (resolvedRepo !== undefined) {
            matchedTargetRepo = true
            activeWorkspaceId = resolvedRepo

            const registryEntry = registry?.[resolvedRepo]
            if (registryEntry) {
                const repoPath: string | undefined = registryEntry.path
                const hasRepoPath = repoPath !== undefined && repoPath.trim() !== ''
                activeRepoPath = hasRepoPath ? repoPath : undefined
                activeGithub = hasRepoPath ? getGitHubIntegration(repoPath, context.runtime) : undefined
                activeProjectNumber = registryEntry.project_number
                if (options?.pinSession !== false) {
                    setActiveSessionProject(
                        resolvedRepo,
                        activeProjectNumber ?? null,
                        context.runtime
                    )
                }
            } else {
                activeRepoPath = undefined
                activeGithub = undefined
            }
        } else if (targetRepo.trim().toLowerCase() === 'default') {
            matchedTargetRepo = true
            activeWorkspaceId = 'default'
            const defaultEntry = registry?.['default']
            const registeredDefault =
                defaultEntry?.project_number ??
                (config.defaultWorkspaceId === 'default' ? config.defaultProjectNumber : undefined)
            const defaultPath: string | undefined = defaultEntry?.path
            const hasDefaultPath = defaultPath !== undefined && defaultPath.trim() !== ''
            activeProjectNumber = registeredDefault
            activeRepoPath = hasDefaultPath ? defaultPath : undefined
            activeGithub = hasDefaultPath ? getGitHubIntegration(defaultPath, context.runtime) : undefined
            if (options?.pinSession !== false) {
                setActiveSessionProject('default', registeredDefault ?? null, context.runtime)
            }
        }
        if (!matchedTargetRepo) {
            activeWorkspaceId = targetRepo
            activeProjectNumber = undefined
            activeRepoPath = undefined
            activeGithub = undefined
        }
    } else if (activeWorkspaceId && activeWorkspaceId !== 'default' && activeWorkspaceId !== '*') {
        const canonicalKey = findCanonicalRegistryKey(activeWorkspaceId, registry) ?? activeWorkspaceId
        activeWorkspaceId = canonicalKey
        const registryEntry = registry?.[canonicalKey]
        if (registryEntry) {
            const repoPath: string | undefined = registryEntry.path
            const hasRepoPath = repoPath !== undefined && repoPath.trim() !== ''
            activeRepoPath = hasRepoPath ? repoPath : undefined
            activeGithub = hasRepoPath ? getGitHubIntegration(repoPath, context.runtime) : undefined
            if (registryEntry.project_number !== undefined) {
                activeProjectNumber = registryEntry.project_number
            } else if (config.defaultWorkspaceId?.toLowerCase() !== canonicalKey.toLowerCase()) {
                activeProjectNumber = undefined
            }
        } else {
            activeRepoPath = undefined
            activeGithub = undefined
            if (config.defaultWorkspaceId?.toLowerCase() !== canonicalKey.toLowerCase()) {
                activeProjectNumber = undefined
            }
        }
    } else if (activeWorkspaceId === 'default') {
        const defaultEntry = registry?.['default']
        const defaultPath: string | undefined = defaultEntry?.path
        const hasDefaultPath = defaultPath !== undefined && defaultPath.trim() !== ''
        if (hasDefaultPath) {
            activeRepoPath = defaultPath
            activeGithub = getGitHubIntegration(defaultPath, context.runtime)
        } else if (hasRegistry || config.defaultWorkspaceId?.toLowerCase() === 'default') {
            activeRepoPath = undefined
            activeGithub = undefined
        }
        activeProjectNumber =
            defaultEntry?.project_number ??
            (config.defaultWorkspaceId?.toLowerCase() === 'default'
                ? config.defaultProjectNumber
                : undefined)
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

    const suppressSystemCwd =
        targetRepo !== undefined ||
        (activeWorkspaceId !== undefined &&
            activeWorkspaceId !== '*' &&
            activeRepoPath === undefined &&
            (activeWorkspaceId !== 'default' ||
                hasRegistry ||
                config.defaultWorkspaceId?.toLowerCase() === 'default'))
    const systemRepoPath = activeRepoPath ?? (suppressSystemCwd ? null : undefined)
    const system = buildSystemContext(
        config,
        context.filterConfig,
        systemRepoPath,
        context.resourceCount,
        journal.workspaceId
    )

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
