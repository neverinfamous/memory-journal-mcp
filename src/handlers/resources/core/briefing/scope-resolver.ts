/**
 * Briefing — Workspace & Repository Scope Resolution
 *
 * Extracted from `briefing/index.ts` so the barrel stays well within the 500-line
 * file budget and every helper stays within the 80-line function budget.
 */

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { getGitHubIntegration } from '../../../../github/github-integration/index.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    setActiveSessionProject,
} from '../../../../utils/workspace-resolver.js'
import { parseCanonicalPositiveInt } from '../../../../utils/safe-positive-int.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../../../utils/write-scope.js'
import {
    type DEFAULT_BRIEFING_CONFIG,
    resourceWorkspace,
    type ResourceContext,
} from '../../shared.js'

export interface BriefingScopeResolution {
    registry: ReturnType<typeof loadProjectRegistryFromConfig>
    hasRegistry: boolean
    activeGithub: ResourceContext['github']
    activeRepoPath: string | undefined
    activeWorkspaceId: string | undefined
    activeProjectNumber: number | undefined
    unresolvedRepo?: string
}

function resolveDefaultBriefingScope(
    context: ResourceContext,
    config: typeof DEFAULT_BRIEFING_CONFIG,
    registry: ReturnType<typeof loadProjectRegistryFromConfig>,
    activeWorkspaceId: string | undefined,
    initialProjectNumber: number | undefined
): Pick<
    BriefingScopeResolution,
    'activeWorkspaceId' | 'activeProjectNumber' | 'activeRepoPath' | 'activeGithub'
> {
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    if (activeWorkspaceId && activeWorkspaceId !== 'default' && activeWorkspaceId !== '*') {
        const canonicalKey = findCanonicalRegistryKey(activeWorkspaceId, registry) ?? activeWorkspaceId
        const registryEntry = registry?.[canonicalKey]
        const repoPath = registryEntry?.path
        const hasRepoPath = repoPath !== undefined && repoPath.trim() !== ''
        const matchesDefaultWs =
            config.defaultWorkspaceId?.trim().toLowerCase() === canonicalKey.toLowerCase()
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
        const defaultWsIsDefault = config.defaultWorkspaceId?.trim().toLowerCase() === 'default'
        return {
            activeWorkspaceId: 'default',
            activeRepoPath: hasDefaultPath ? defaultPath : undefined,
            activeGithub: hasDefaultPath
                ? getGitHubIntegration(defaultPath, context.runtime)
                : hasRegistry || defaultWsIsDefault
                  ? undefined
                  : context.github,
            activeProjectNumber:
                defaultEntry?.project_number ??
                (defaultWsIsDefault ? config.defaultProjectNumber : undefined),
        }
    }

    return {
        activeWorkspaceId,
        activeProjectNumber: initialProjectNumber,
        activeRepoPath: undefined,
        activeGithub: context.github,
    }
}

function resolveRegisteredBriefingScope(
    context: ResourceContext,
    registry: ReturnType<typeof loadProjectRegistryFromConfig>,
    hasRegistry: boolean,
    resolvedRepo: string,
    pinSession: boolean
): BriefingScopeResolution {
    const registryEntry = registry?.[resolvedRepo]
    const repoPath = registryEntry?.path
    const hasRepoPath = repoPath !== undefined && repoPath.trim() !== ''
    const activeProjectNumber = registryEntry?.project_number
    if (registryEntry && pinSession) {
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

function resolveNamedDefaultBriefingScope(
    context: ResourceContext,
    config: typeof DEFAULT_BRIEFING_CONFIG,
    registry: ReturnType<typeof loadProjectRegistryFromConfig>,
    hasRegistry: boolean,
    pinSession: boolean
): BriefingScopeResolution {
    const defaultEntry = registry?.['default']
    const registeredDefault =
        defaultEntry?.project_number ??
        (config.defaultWorkspaceId?.trim().toLowerCase() === 'default'
            ? config.defaultProjectNumber
            : undefined)
    const defaultPath = defaultEntry?.path
    const hasDefaultPath = defaultPath !== undefined && defaultPath.trim() !== ''
    if (pinSession) {
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

function resolveExplicitBriefingTarget(
    context: ResourceContext,
    config: typeof DEFAULT_BRIEFING_CONFIG,
    registry: ReturnType<typeof loadProjectRegistryFromConfig>,
    hasRegistry: boolean,
    targetRepo: string,
    options?: { pinSession?: boolean }
): BriefingScopeResolution {
    const trimmed = targetRepo.trim()
    if (trimmed === '*') {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            "Wildcard '*' is not supported for memory://briefing/{+repo}. Specify a concrete repository name."
        )
    }
    const numericTarget = /^#?(\d+)$/.exec(trimmed)
    const parsedTarget =
        numericTarget?.[1] !== undefined ? parseCanonicalPositiveInt(numericTarget[1]) : undefined
    const numericWorkspace =
        parsedTarget !== undefined ? uniqueWorkspaceForProject(parsedTarget, registry) : undefined
    const resolvedRepo = exactRegistryKey(trimmed, registry) ?? numericWorkspace
    if (resolvedRepo !== undefined) {
        return resolveRegisteredBriefingScope(
            context,
            registry,
            hasRegistry,
            resolvedRepo,
            options?.pinSession !== false
        )
    }
    if (trimmed.toLowerCase() === 'default') {
        return resolveNamedDefaultBriefingScope(
            context,
            config,
            registry,
            hasRegistry,
            options?.pinSession !== false
        )
    }
    const configuredDefaultWs = config.defaultWorkspaceId?.trim()
    if (configuredDefaultWs?.toLowerCase() === trimmed.toLowerCase()) {
        return {
            registry,
            hasRegistry,
            activeWorkspaceId: configuredDefaultWs,
            activeProjectNumber: config.defaultProjectNumber,
            activeRepoPath: undefined,
            activeGithub: undefined,
        }
    }
    if (hasRegistry) {
        return {
            registry,
            hasRegistry,
            activeWorkspaceId: undefined,
            activeProjectNumber: undefined,
            activeRepoPath: undefined,
            activeGithub: undefined,
            unresolvedRepo: trimmed,
        }
    }
    return {
        registry,
        hasRegistry,
        activeWorkspaceId: trimmed,
        activeProjectNumber: undefined,
        activeRepoPath: undefined,
        activeGithub: undefined,
    }
}

export function resolveBriefingScope(
    context: ResourceContext,
    config: typeof DEFAULT_BRIEFING_CONFIG,
    targetRepo: string | undefined,
    options?: { pinSession?: boolean }
): BriefingScopeResolution {
    const registry = config.projectRegistry ?? loadProjectRegistryFromConfig()
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    if (targetRepo) {
        return resolveExplicitBriefingTarget(
            context,
            config,
            registry,
            hasRegistry,
            targetRepo,
            options
        )
    }
    const initialWorkspaceId = resourceWorkspace({
        briefingConfig: config,
        ...(context.runtime !== undefined ? { runtime: context.runtime } : {}),
    })
    const trimmedDefaultWs = config.defaultWorkspaceId?.trim()
    const initialProjectNumber =
        (trimmedDefaultWs === undefined && initialWorkspaceId !== 'default') ||
        (initialWorkspaceId !== undefined &&
            trimmedDefaultWs?.toLowerCase() === initialWorkspaceId.toLowerCase())
            ? config.defaultProjectNumber
            : undefined
    return {
        registry,
        hasRegistry,
        ...resolveDefaultBriefingScope(
            context,
            config,
            registry,
            initialWorkspaceId,
            initialProjectNumber
        ),
    }
}
