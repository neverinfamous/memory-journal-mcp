import type { ToolHandlerConfig } from '../types/index.js'
import { ValidationError } from '../types/errors.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    type ResolutionInput,
    type ResolvedContext,
} from './workspace-resolver-registry.js'
import {
    clearActiveSessionProject,
    getActiveSessionProject,
    setActiveSessionProject,
} from './workspace-resolver-session.js'
import {
    registerActiveSessionReader,
    resolveProjectContextWithRegistry,
    unclaimedByOtherWorkspace,
    type WorkspaceResolverPureConfig,
} from './workspace-resolver-pure.js'

registerActiveSessionReader(getActiveSessionProject)

export { setActiveSessionProject, getActiveSessionProject, clearActiveSessionProject }
export {
    loadProjectRegistryFromConfig,
    PROJECT_KEYWORD_ALIASES,
    findCanonicalRegistryKey,
    cwdMatchesRegistryPath,
    resolveProjectNumberFromPath,
    resolveWorkspaceFromFilePath,
} from './workspace-resolver-registry.js'
export type { ResolutionInput, ResolvedContext } from './workspace-resolver-registry.js'

export type WorkspaceResolverConfig = WorkspaceResolverPureConfig

export function resolveProjectContext(
    input: ResolutionInput,
    config?: WorkspaceResolverConfig
): ResolvedContext {
    const fallbackRegistry =
        config?.projectRegistry === undefined ? loadProjectRegistryFromConfig() : undefined
    return resolveProjectContextWithRegistry(input, config, fallbackRegistry)
}

/**
 * Resolves the effective workspace ID from available context.
 * Priority: explicit workspace_id > project_number lookup > content/tags lookup > config default > 'default'
 */
export function resolveWorkspaceId(
    explicitWorkspaceId: string | undefined,
    projectNumber: number | undefined,
    config?: WorkspaceResolverConfig,
    content?: string,
    tags?: string[]
): string {
    if (explicitWorkspaceId === '*') {
        return '*'
    }
    const res = resolveProjectContext(
        {
            ...(explicitWorkspaceId !== undefined ? { workspace_id: explicitWorkspaceId } : {}),
            ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
            ...(content !== undefined ? { content } : {}),
            ...(tags !== undefined ? { tags } : {}),
        },
        config
    )
    return res.workspaceId
}

/**
 * Resolve CLI query `(workspaceId, projectNumber)` while keeping `requestedProject` separated
 * from `config.defaultProjectNumber` during `resolveWorkspaceId` (H4), then propagating an
 * unclaimed `defaultProjectNumber` onto read queries when `workspaceId === 'default'`.
 */
export function resolveCliQueryScope(
    explicitWorkspaceId: string | undefined,
    requestedProject: number | undefined,
    config?: WorkspaceResolverConfig
): { workspaceId: string; projectNumber?: number } {
    const workspaceId = resolveWorkspaceId(explicitWorkspaceId, requestedProject, config)
    if (requestedProject !== undefined) {
        return { workspaceId, projectNumber: requestedProject }
    }
    if (workspaceId === 'default' && config?.defaultProjectNumber !== undefined) {
        const registry = config.projectRegistry ?? loadProjectRegistryFromConfig()
        const safeProject = unclaimedByOtherWorkspace(
            config.defaultProjectNumber,
            workspaceId,
            registry
        )
        if (safeProject !== undefined) {
            return { workspaceId, projectNumber: safeProject }
        }
    }
    return { workspaceId }
}

/**
 * Resolve `(workspaceId, projectNumber)` together for startup and scheduled auto-prune,
 * rejecting wildcard `'*'` config defaults and conflicting `(workspaceId, projectNumber)` pairs
 * while preserving explicit `'default'` and unregistered explicit/default project numbers.
 */
export function resolveAutoPruneScope(
    defaultWorkspaceId: string | undefined,
    defaultProjectNumber: number | undefined,
    projectRegistry: ToolHandlerConfig['projectRegistry'],
    options?: {
        runtime?: WorkspaceResolverConfig['runtime']
    }
): { workspaceId: string; projectNumber?: number } {
    const effectiveRegistry = projectRegistry ?? loadProjectRegistryFromConfig()
    const trimmedWs = defaultWorkspaceId?.trim()
    if (trimmedWs === '*') {
        throw new ValidationError("Auto-prune defaultWorkspaceId cannot be '*'")
    }
    const concreteDefaultWs =
        trimmedWs !== undefined && trimmedWs !== '' ? trimmedWs : undefined
    const scopeConfig: WorkspaceResolverConfig = {
        ...(concreteDefaultWs !== undefined ? { defaultWorkspaceId: concreteDefaultWs } : {}),
        ...(defaultProjectNumber !== undefined ? { defaultProjectNumber } : {}),
        ...(effectiveRegistry !== undefined ? { projectRegistry: effectiveRegistry } : {}),
        ...(options?.runtime !== undefined ? { runtime: options.runtime } : { runtime: null }),
    }
    const resolved = resolveProjectContext(
        {
            ...(concreteDefaultWs !== undefined ? { workspace_id: concreteDefaultWs } : {}),
            ...(defaultProjectNumber !== undefined ? { project_number: defaultProjectNumber } : {}),
        },
        scopeConfig
    )
    const canonicalWs =
        findCanonicalRegistryKey(resolved.workspaceId, effectiveRegistry) ?? resolved.workspaceId
    const regProj = effectiveRegistry?.[canonicalWs]?.project_number
    const projectNumber = resolved.projectNumber ?? regProj
    return {
        workspaceId: canonicalWs,
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    }
}
