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
import { parseCanonicalPositiveInt } from '../../../../utils/safe-positive-int.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../../../utils/write-scope.js'
import {
    DEFAULT_BRIEFING_CONFIG,
    getBaseUri,
    resourceWorkspace,
    safeDecodeUriSegment,
} from '../../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { buildGitHubSection } from './github-section.js'
import {
    buildJournalContext,
    buildTeamContext,
    buildGraphContext,
} from './context-section.js'
import { formatUserMessage } from './user-message.js'
import { buildInsightsSection } from './insights-section.js'
import { buildBriefingSystemSummary } from './system-section.js'
import {
    buildGraphPivots,
    degreeSuffix,
    resolveBriefingToolNaming,
} from './graph-pivots-section.js'

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
        const match = /^memory:\/\/briefing\/(.+)$/.exec(getBaseUri(uri))
        const repoName = match?.[1] ? safeDecodeUriSegment(match[1]) : undefined
        return buildBriefingData(context, repoName, { pinSession })
    },
}

interface BriefingScopeResolution {
    registry: ReturnType<typeof loadProjectRegistryFromConfig>
    hasRegistry: boolean
    activeGithub: ResourceContext['github']
    activeRepoPath: string | undefined
    activeWorkspaceId: string | undefined
    activeProjectNumber: number | undefined
}

function resolveDefaultBriefingScope(
    context: ResourceContext,
    config: typeof DEFAULT_BRIEFING_CONFIG,
    registry: ReturnType<typeof loadProjectRegistryFromConfig>,
    activeWorkspaceId: string | undefined,
    initialProjectNumber: number | undefined
): Pick<BriefingScopeResolution, 'activeWorkspaceId' | 'activeProjectNumber' | 'activeRepoPath' | 'activeGithub'> {
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    if (activeWorkspaceId && activeWorkspaceId !== 'default' && activeWorkspaceId !== '*') {
        const canonicalKey = findCanonicalRegistryKey(activeWorkspaceId, registry) ?? activeWorkspaceId
        const registryEntry = registry?.[canonicalKey]
        const repoPath = registryEntry?.path
        const hasRepoPath = repoPath !== undefined && repoPath.trim() !== ''
        const matchesDefaultWs = config.defaultWorkspaceId?.toLowerCase() === canonicalKey.toLowerCase()
        const resolvedProj =
            registryEntry?.project_number ?? (matchesDefaultWs ? initialProjectNumber : undefined)
        return {
            activeWorkspaceId: canonicalKey,
            activeRepoPath: hasRepoPath ? repoPath : undefined,
            activeGithub: hasRepoPath ? getGitHubIntegration(repoPath, context.runtime) : undefined,
            activeProjectNumber: resolvedProj,
        }
    }

    if (activeWorkspaceId === 'default') {
        const defaultEntry = registry?.['default']
        const defaultPath = defaultEntry?.path
        const hasDefaultPath = defaultPath !== undefined && defaultPath.trim() !== ''
        return {
            activeWorkspaceId: 'default',
            activeRepoPath: hasDefaultPath ? defaultPath : undefined,
            activeGithub: hasDefaultPath
                ? getGitHubIntegration(defaultPath, context.runtime)
                : hasRegistry || config.defaultWorkspaceId?.toLowerCase() === 'default'
                  ? undefined
                  : context.github,
            activeProjectNumber:
                defaultEntry?.project_number ??
                (config.defaultWorkspaceId?.toLowerCase() === 'default'
                    ? config.defaultProjectNumber
                    : undefined),
        }
    }

    return {
        activeWorkspaceId,
        activeProjectNumber: initialProjectNumber,
        activeRepoPath: undefined,
        activeGithub: context.github,
    }
}

function resolveBriefingScope(
    context: ResourceContext,
    config: typeof DEFAULT_BRIEFING_CONFIG,
    targetRepo: string | undefined,
    options?: { pinSession?: boolean }
): BriefingScopeResolution {
    const registry = config.projectRegistry ?? loadProjectRegistryFromConfig()
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    const initialWorkspaceId = resourceWorkspace({
        briefingConfig: config,
        ...(context.runtime !== undefined ? { runtime: context.runtime } : {}),
    })
    const initialProjectNumber =
        (config.defaultWorkspaceId === undefined && initialWorkspaceId !== 'default') ||
        (initialWorkspaceId !== undefined &&
            config.defaultWorkspaceId?.toLowerCase() === initialWorkspaceId.toLowerCase())
            ? config.defaultProjectNumber
            : undefined

    if (!targetRepo) {
        return {
            registry,
            hasRegistry,
            ...resolveDefaultBriefingScope(context, config, registry, initialWorkspaceId, initialProjectNumber),
        }
    }

    const numericTarget = /^#?(\d+)$/.exec(targetRepo)
    const parsedTarget = numericTarget?.[1] !== undefined ? parseCanonicalPositiveInt(numericTarget[1]) : undefined
    const numericWorkspace =
        parsedTarget !== undefined ? uniqueWorkspaceForProject(parsedTarget, registry) : undefined
    const resolvedRepo = exactRegistryKey(targetRepo, registry) ?? numericWorkspace

    if (resolvedRepo !== undefined) {
        const registryEntry = registry?.[resolvedRepo]
        const repoPath = registryEntry?.path
        const hasRepoPath = repoPath !== undefined && repoPath.trim() !== ''
        const activeProjectNumber = registryEntry?.project_number
        if (registryEntry && options?.pinSession !== false) {
            setActiveSessionProject(resolvedRepo, activeProjectNumber ?? null, context.runtime)
        }
        return {
            registry,
            hasRegistry,
            activeWorkspaceId: resolvedRepo,
            activeRepoPath: hasRepoPath ? repoPath : undefined,
            activeGithub: hasRepoPath ? getGitHubIntegration(repoPath, context.runtime) : undefined,
            activeProjectNumber,
        }
    }

    if (targetRepo.trim().toLowerCase() === 'default') {
        const defaultEntry = registry?.['default']
        const registeredDefault =
            defaultEntry?.project_number ??
            (config.defaultWorkspaceId === 'default' ? config.defaultProjectNumber : undefined)
        const defaultPath = defaultEntry?.path
        const hasDefaultPath = defaultPath !== undefined && defaultPath.trim() !== ''
        if (options?.pinSession !== false) {
            setActiveSessionProject('default', registeredDefault ?? null, context.runtime)
        }
        return {
            registry,
            hasRegistry,
            activeWorkspaceId: 'default',
            activeProjectNumber: registeredDefault,
            activeRepoPath: hasDefaultPath ? defaultPath : undefined,
            activeGithub: hasDefaultPath ? getGitHubIntegration(defaultPath, context.runtime) : undefined,
        }
    }

    return {
        registry,
        hasRegistry,
        activeWorkspaceId: targetRepo,
        activeProjectNumber: undefined,
        activeRepoPath: undefined,
        activeGithub: undefined,
    }
}

export async function buildBriefingData(
    context: ResourceContext,
    targetRepo?: string,
    options?: { pinSession?: boolean }
): Promise<ResourceResult> {
    const config = { ...DEFAULT_BRIEFING_CONFIG, ...context.briefingConfig }
    const { hasRegistry, activeGithub, activeRepoPath, activeWorkspaceId, activeProjectNumber } =
        resolveBriefingScope(context, config, targetRepo, options)

    const journal = buildJournalContext(context, config, activeProjectNumber, activeWorkspaceId)
    const suppressSystemCwd =
        targetRepo !== undefined ||
        (activeWorkspaceId !== undefined &&
            activeWorkspaceId !== '*' &&
            activeRepoPath === undefined &&
            (activeWorkspaceId !== 'default' ||
                hasRegistry ||
                config.defaultWorkspaceId?.toLowerCase() === 'default'))
    const systemRepoPath = activeRepoPath ?? (suppressSystemCwd ? null : undefined)

    const [github, system] = await Promise.all([
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
            journal.workspaceId
        ),
    ])
    const team = buildTeamContext(
        context,
        config,
        activeProjectNumber,
        activeWorkspaceId,
        journal.mirrorCandidates
    )
    const insights = buildInsightsSection(context, activeWorkspaceId)
    const graphStats = buildGraphContext(context, journal.workspaceId, journal.totalEntries)
    const graphPivotsEnabled = config.graphPivots !== false
    const graphPivots = graphPivotsEnabled
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
    const toolNaming = resolveBriefingToolNaming(context.filterConfig)
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

    const userMessage = formatUserMessage({
        repoName: github?.repo ?? 'local',
        branchName: github?.branch ?? 'unknown',
        ciStatus: github?.ci ?? 'unknown',
        totalEntries: journal.totalEntries,
        latestPreviews,
        ...(teamLatestPreviews !== undefined ? { teamLatestPreviews } : {}),
        summaryPreviews,
        github,
        teamTotalEntries: team?.teamInfo.totalEntries,
        analyticsInsights: insights ?? undefined,
        graphSummary: graphStats,
        ...(graphPivots !== undefined ? { graphPivots } : {}),
        toolNaming,
        gitHistory: system.gitHistory ?? undefined,
        isReadonly: system.isReadonly,
        teamConfigured: !!context.teamDb,
        githubConfigured: !!activeGithub,
        ioRootCount: system.ioRootCount,
        workspaceId: journal.workspaceId ?? system.workspaceId,
        deprecationWarnings: context.runtime?.metrics?.getDeprecationWarnings() ?? [],
    })

    return {
        data: userMessage,
        annotations: { lastModified: journal.lastModified },
    }
}
