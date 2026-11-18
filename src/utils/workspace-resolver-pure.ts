import type { ToolHandlerConfig } from '../types/index.js'
import { ValidationError } from '../types/errors.js'
import {
    findCanonicalRegistryKey,
    findWorkspaceByProjectNumber,
    matchRegistryByTagsOrContent,
    findBestMatchingPathEntry,
    type RegistryEntry,
    type ResolutionInput,
    type ResolvedContext,
} from './workspace-registry-match.js'

/**
 * [BOUNDARY] Pure in-memory `resolveProjectContextWithRegistry` implementation.
 * Must remain free of `fs`, `yaml`, `request-context`, and `registry-config-file` imports so
 * Code Mode worker modules (`dist/worker-script.js`) bundle zero external packages or ALS bindings.
 */

export type WorkspaceResolverPureConfig = Omit<ToolHandlerConfig, 'runtime'> & {
    runtime?: ToolHandlerConfig['runtime'] | null
}

export interface SessionScope {
    workspaceId?: string
    projectNumber?: number
}

export type ActiveSessionReader = (
    runtime?: WorkspaceResolverPureConfig['runtime']
) => SessionScope

let activeSessionReader: ActiveSessionReader = () => ({})

/** Register the host session-project reader (`workspace-resolver-session.ts`). */
export function registerActiveSessionReader(reader: ActiveSessionReader): void {
    activeSessionReader = reader
}

type RegistryMap = Record<string, RegistryEntry> | undefined

function assertNotForeignProject(
    wsId: string,
    projectNumber: number,
    registry: Record<string, RegistryEntry> | undefined
): void {
    const owner = findWorkspaceByProjectNumber(projectNumber, registry)
    if (owner !== undefined && owner.toLowerCase() !== wsId.toLowerCase()) {
        throw new ValidationError(
            `project_number ${String(projectNumber)} belongs to workspace '${owner}', not '${wsId}'.`,
            { workspaceId: wsId, projectNumber }
        )
    }
}

export function unclaimedByOtherWorkspace(
    projectNumber: number | undefined,
    workspaceId: string,
    registry: Record<string, RegistryEntry> | undefined
): number | undefined {
    if (projectNumber === undefined) return undefined
    const owner = findWorkspaceByProjectNumber(projectNumber, registry)
    if (owner !== undefined && owner.toLowerCase() !== workspaceId.toLowerCase()) {
        return undefined
    }
    return projectNumber
}

function parseConfiguredDefaultWs(
    config: WorkspaceResolverPureConfig | undefined
): string | undefined {
    if (typeof config?.defaultWorkspaceId !== 'string') return undefined
    const trimmed = config.defaultWorkspaceId.trim()
    return trimmed !== '' && trimmed !== '*' ? trimmed : undefined
}

function resolveExplicitWorkspaceOrProject(
    sanitizedWorkspaceId: string | undefined,
    input: ResolutionInput,
    registeredCwd: ResolvedContext | undefined,
    config: WorkspaceResolverPureConfig | undefined,
    registry: RegistryMap
): ResolvedContext | undefined {
    if (sanitizedWorkspaceId !== undefined) {
        const wsId = findCanonicalRegistryKey(sanitizedWorkspaceId, registry) ?? sanitizedWorkspaceId
        const registryProject = registry?.[wsId]?.project_number
        if (input.project_number !== undefined && input.project_number !== null) {
            if (registryProject !== undefined && input.project_number !== registryProject) {
                throw new ValidationError(
                    `project_number ${String(input.project_number)} does not match workspace '${wsId}', which uses project_number ${String(registryProject)}.`,
                    { workspaceId: wsId, projectNumber: input.project_number }
                )
            }
            if (registryProject === undefined) {
                assertNotForeignProject(wsId, input.project_number, registry)
            }
        }
        return { workspaceId: wsId, projectNumber: registryProject ?? input.project_number ?? undefined }
    }

    if (input.project_number !== undefined && input.project_number !== null) {
        const wsId = findWorkspaceByProjectNumber(input.project_number, registry)
        if (wsId !== undefined) {
            return { workspaceId: wsId, projectNumber: input.project_number }
        }
        const sessionCtx = activeSessionReader(config?.runtime)
        const rawCandidateWs =
            registeredCwd?.workspaceId ?? config?.defaultWorkspaceId ?? sessionCtx.workspaceId ?? 'default'
        const candidateWs = findCanonicalRegistryKey(rawCandidateWs, registry) ?? rawCandidateWs
        const candidateProject = registry?.[candidateWs]?.project_number
        const fallbackWs =
            candidateProject !== undefined && candidateProject !== input.project_number
                ? 'default'
                : candidateWs
        return { workspaceId: fallbackWs, projectNumber: input.project_number }
    }

    return undefined
}

function resolveSessionScope(
    sessionCtx: SessionScope,
    configuredDefaultWs: string | undefined,
    config: WorkspaceResolverPureConfig | undefined,
    registry: RegistryMap
): ResolvedContext | undefined {
    if (
        sessionCtx.workspaceId !== undefined &&
        sessionCtx.workspaceId !== '' &&
        sessionCtx.workspaceId !== '*'
    ) {
        const canonicalSessionWs =
            findCanonicalRegistryKey(sessionCtx.workspaceId, registry) ?? sessionCtx.workspaceId
        if (canonicalSessionWs.toLowerCase() === 'default' && sessionCtx.projectNumber !== undefined) {
            const sessionWorkspace = findWorkspaceByProjectNumber(sessionCtx.projectNumber, registry)
            if (sessionWorkspace !== undefined) {
                return { workspaceId: sessionWorkspace, projectNumber: sessionCtx.projectNumber }
            }
        }
        const registryProject = registry?.[canonicalSessionWs]?.project_number
        const sessionProject =
            registryProject ??
            unclaimedByOtherWorkspace(sessionCtx.projectNumber, canonicalSessionWs, registry) ??
            (canonicalSessionWs.toLowerCase() === 'default'
                ? undefined
                : unclaimedByOtherWorkspace(config?.defaultProjectNumber, canonicalSessionWs, registry))
        return { workspaceId: canonicalSessionWs, projectNumber: sessionProject }
    }
    if (sessionCtx.projectNumber !== undefined) {
        const sessionWorkspace = findWorkspaceByProjectNumber(sessionCtx.projectNumber, registry)
        if (sessionWorkspace !== undefined) {
            return { workspaceId: sessionWorkspace, projectNumber: sessionCtx.projectNumber }
        }
        const rawDefaultWs = configuredDefaultWs ?? 'default'
        const canonicalDefaultWs = findCanonicalRegistryKey(rawDefaultWs, registry) ?? rawDefaultWs
        const defaultOwnerProj = registry?.[canonicalDefaultWs]?.project_number
        const fallbackWs =
            defaultOwnerProj !== undefined && defaultOwnerProj !== sessionCtx.projectNumber
                ? 'default'
                : canonicalDefaultWs
        return { workspaceId: fallbackWs, projectNumber: sessionCtx.projectNumber }
    }
    return undefined
}

function resolveFallbackContext(
    input: ResolutionInput,
    sessionCtx: SessionScope,
    configuredDefaultWs: string | undefined,
    config: WorkspaceResolverPureConfig | undefined,
    registry: RegistryMap
): ResolvedContext {
    const hasConcreteDefaultWs =
        configuredDefaultWs !== undefined && configuredDefaultWs.toLowerCase() !== 'default'
    if (!hasConcreteDefaultWs && registry !== undefined && input.preferCwdOverKeywords !== true) {
        const matched = matchRegistryByTagsOrContent(input, registry)
        if (matched !== undefined) return matched
    }
    const sessionWsFallback =
        sessionCtx.workspaceId !== undefined &&
        sessionCtx.workspaceId.trim() !== '' &&
        sessionCtx.workspaceId.trim() !== '*'
            ? sessionCtx.workspaceId.trim()
            : undefined
    const rawFallbackWs = configuredDefaultWs ?? sessionWsFallback ?? 'default'
    const fallbackWorkspace = findCanonicalRegistryKey(rawFallbackWs, registry) ?? rawFallbackWs
    const fallbackRegistryProj = registry?.[fallbackWorkspace]?.project_number
    return {
        workspaceId: fallbackWorkspace,
        projectNumber:
            fallbackRegistryProj ??
            unclaimedByOtherWorkspace(
                config?.defaultProjectNumber ?? sessionCtx.projectNumber,
                fallbackWorkspace,
                registry
            ),
    }
}

const CWD_REGISTRY_MATCH_CACHE = new WeakMap<
    Record<string, RegistryEntry>,
    Map<string, ReturnType<typeof findBestMatchingPathEntry> | null>
>()

function getCachedCwdMatch(
    cwd: string,
    registry: Record<string, RegistryEntry> | undefined
): ReturnType<typeof findBestMatchingPathEntry> {
    if (registry === undefined) return undefined
    let byCwd = CWD_REGISTRY_MATCH_CACHE.get(registry)
    if (byCwd === undefined) {
        byCwd = new Map()
        CWD_REGISTRY_MATCH_CACHE.set(registry, byCwd)
    }
    const cached = byCwd.get(cwd)
    if (cached !== undefined) {
        return cached ?? undefined
    }
    const computed = findBestMatchingPathEntry(cwd, registry)
    if (byCwd.size < 32) {
        byCwd.set(cwd, computed ?? null)
    }
    return computed
}

/**
 * Pure in-memory workspace/project context resolver taking an optional fallback registry
 * so worker threads do not pull host config-file readers or `yaml` dependencies.
 */
export function resolveProjectContextWithRegistry(
    input: ResolutionInput,
    config?: WorkspaceResolverPureConfig,
    fallbackRegistry?: Record<string, RegistryEntry>
): ResolvedContext {
    const registry = config?.projectRegistry ?? fallbackRegistry
    const trimmedWorkspaceId =
        typeof input.workspace_id === 'string' ? input.workspace_id.trim() : undefined
    const sanitizedWorkspaceId =
        trimmedWorkspaceId === undefined || trimmedWorkspaceId === '' || trimmedWorkspaceId === '*'
            ? undefined
            : trimmedWorkspaceId

    let resolvedCwdComputed = false
    let resolvedCwdCache: ResolvedContext | undefined
    const getRegisteredCwd = (): ResolvedContext | undefined => {
        if (!resolvedCwdComputed) {
            resolvedCwdComputed = true
            const cwdMatch = getCachedCwdMatch(process.cwd(), registry)
            resolvedCwdCache =
                cwdMatch !== undefined && cwdMatch.workspaceId.toLowerCase() !== 'test'
                    ? cwdMatch
                    : undefined
        }
        return resolvedCwdCache
    }

    if (sanitizedWorkspaceId !== undefined) {
        return (
            resolveExplicitWorkspaceOrProject(
                sanitizedWorkspaceId,
                input,
                undefined,
                config,
                registry
            ) ?? { workspaceId: sanitizedWorkspaceId, projectNumber: undefined }
        )
    }

    if (input.project_number !== undefined && input.project_number !== null) {
        const mappedWs =
            registry !== undefined ? undefined : getRegisteredCwd()?.workspaceId
        const explicitProj = resolveExplicitWorkspaceOrProject(
            undefined,
            input,
            mappedWs !== undefined ? { workspaceId: mappedWs, projectNumber: undefined } : getRegisteredCwd(),
            config,
            registry
        )
        if (explicitProj !== undefined) return explicitProj
    }

    const registeredCwd = getRegisteredCwd()
    if (registeredCwd !== undefined) {
        const cwdProject =
            registeredCwd.projectNumber ??
            (registeredCwd.workspaceId.toLowerCase() === 'default'
                ? undefined
                : unclaimedByOtherWorkspace(
                      config?.defaultProjectNumber,
                      registeredCwd.workspaceId,
                      registry
                  ))
        return { workspaceId: registeredCwd.workspaceId, projectNumber: cwdProject }
    }

    const sessionCtx = activeSessionReader(config?.runtime)
    const configuredDefaultWs = parseConfiguredDefaultWs(config)
    return (
        resolveSessionScope(sessionCtx, configuredDefaultWs, config, registry) ??
        resolveFallbackContext(input, sessionCtx, configuredDefaultWs, config, registry)
    )
}
