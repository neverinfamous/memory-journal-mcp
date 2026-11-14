import type { ToolHandlerConfig } from '../types/index.js'
import { ValidationError } from '../types/errors.js'
import { getActiveSessionProject } from './workspace-resolver-session.js'
import {
    findCanonicalRegistryKey,
    findWorkspaceByProjectNumber,
    loadProjectRegistryFromConfig,
    matchRegistryByTagsOrContent,
    resolveWorkspaceFromFilePath,
    type RegistryEntry,
    type ResolutionInput,
    type ResolvedContext,
} from './workspace-resolver-registry.js'

export {
    setActiveSessionProject,
    getActiveSessionProject,
    clearActiveSessionProject,
} from './workspace-resolver-session.js'
export {
    loadProjectRegistryFromConfig,
    PROJECT_KEYWORD_ALIASES,
    findCanonicalRegistryKey,
    cwdMatchesRegistryPath,
    resolveProjectNumberFromPath,
    resolveWorkspaceFromFilePath,
} from './workspace-resolver-registry.js'
export type { ResolutionInput, ResolvedContext } from './workspace-resolver-registry.js'

/** Resolver config supporting `runtime: null` to opt out of session state (e.g. background jobs). */
export type WorkspaceResolverConfig = Omit<ToolHandlerConfig, 'runtime'> & {
    runtime?: ToolHandlerConfig['runtime'] | null
}

/**
 * [INVARIANT] A project number that belongs to another registered workspace can never be
 * paired with `wsId` (covers `'default'` and registered-but-unnumbered workspaces).
 */
function assertNotForeignProject(
    wsId: string,
    projectNumber: number,
    registry: Record<string, RegistryEntry> | undefined
): void {
    const owner = findWorkspaceByProjectNumber(projectNumber, registry)
    if (owner !== undefined && owner !== wsId) {
        throw new ValidationError(
            `project_number ${String(projectNumber)} belongs to workspace '${owner}', not '${wsId}'.`,
            { workspaceId: wsId, projectNumber }
        )
    }
}

function unclaimedByOtherWorkspace(
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

/**
 * Resolves one workspace and that workspace's project number.
 * Priority:
 * 1. Explicit workspace_id, paired with its registry project (never the cwd project)
 * 2. Explicit project_number, paired with its registry workspace
 * 3. Registered process.cwd()
 * 4. Active session workspace
 * 5. Content / tag keywords, only when 1–4 did not resolve a project
 * 6. Configured default
 *
 * [INVARIANT] `*` is omitted so an explicit wildcard stays an admin override.
 * A stored workspace of `default` is concrete. Only an omitted workspace falls through.
 * Write callers must reject `*` before they persist a row.
 */
export function resolveProjectContext(
    input: ResolutionInput,
    config?: WorkspaceResolverConfig
): ResolvedContext {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    const trimmedWorkspaceId =
        typeof input.workspace_id === 'string' ? input.workspace_id.trim() : undefined
    const sanitizedWorkspaceId =
        trimmedWorkspaceId === undefined ||
        trimmedWorkspaceId === '' ||
        trimmedWorkspaceId === '*'
            ? undefined
            : trimmedWorkspaceId

    const cwdMatch =
        registry !== undefined
            ? resolveWorkspaceFromFilePath(process.cwd(), { projectRegistry: registry })
            : undefined
    const registeredCwd =
        cwdMatch !== undefined && cwdMatch.workspaceId.toLowerCase() !== 'test'
            ? cwdMatch
            : undefined

    // 1. Explicit workspace, including `default`. A conflicting project_number is rejected.
    if (sanitizedWorkspaceId !== undefined) {
        let wsId = sanitizedWorkspaceId
        const canonicalKey = findCanonicalRegistryKey(wsId, registry)
        if (canonicalKey !== undefined) wsId = canonicalKey
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
        const projectNumber = registryProject ?? input.project_number ?? undefined
        return { workspaceId: wsId, projectNumber }
    }

    // 2. Explicit project_number. Keywords must not retarget an unregistered number.
    if (input.project_number !== undefined && input.project_number !== null) {
        const wsId = findWorkspaceByProjectNumber(input.project_number, registry)
        if (wsId !== undefined) {
            return { workspaceId: wsId, projectNumber: input.project_number }
        }
        const sessionCtx = getActiveSessionProject(config?.runtime)
        const rawCandidateWs =
            registeredCwd?.workspaceId ??
            config?.defaultWorkspaceId ??
            sessionCtx.workspaceId ??
            'default'
        const candidateWs = findCanonicalRegistryKey(rawCandidateWs, registry) ?? rawCandidateWs
        // [INVARIANT] Never pair an unregistered number with a workspace that already owns
        // a different registered number (cwd/session poisoning).
        const candidateProject = registry?.[candidateWs]?.project_number
        const fallbackWs =
            candidateProject !== undefined && candidateProject !== input.project_number
                ? 'default'
                : candidateWs
        return { workspaceId: fallbackWs, projectNumber: input.project_number }
    }

    // 3. Registered cwd, ahead of incidental words in the body.
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
        return {
            workspaceId: registeredCwd.workspaceId,
            projectNumber: cwdProject,
        }
    }

    // 4. Active session, when the host actually exposes one (tests suppress the global).
    const sessionCtx = getActiveSessionProject(config?.runtime)
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
            unclaimedByOtherWorkspace(sessionCtx.projectNumber, canonicalSessionWs, registry) ??
            registryProject ??
            (canonicalSessionWs.toLowerCase() === 'default'
                ? undefined
                : unclaimedByOtherWorkspace(
                      config?.defaultProjectNumber,
                      canonicalSessionWs,
                      registry
                  ))
        return { workspaceId: canonicalSessionWs, projectNumber: sessionProject }
    }
    if (sessionCtx.projectNumber !== undefined) {
        const sessionWorkspace = findWorkspaceByProjectNumber(sessionCtx.projectNumber, registry)
        if (sessionWorkspace !== undefined) {
            return { workspaceId: sessionWorkspace, projectNumber: sessionCtx.projectNumber }
        }
        const rawDefaultWs = config?.defaultWorkspaceId ?? 'default'
        const canonicalDefaultWs = findCanonicalRegistryKey(rawDefaultWs, registry) ?? rawDefaultWs
        const defaultOwnerProj = registry?.[canonicalDefaultWs]?.project_number
        const fallbackWs =
            defaultOwnerProj !== undefined && defaultOwnerProj !== sessionCtx.projectNumber
                ? 'default'
                : canonicalDefaultWs
        return {
            workspaceId: fallbackWs,
            projectNumber: sessionCtx.projectNumber,
        }
    }

    // 5. Keywords only when no explicit scope, cwd, or session was available.
    // preferCwdOverKeywords skips this step for CLI callers that already tried cwd.
    if (registry !== undefined && input.preferCwdOverKeywords !== true) {
        const matched = matchRegistryByTagsOrContent(input, registry)
        if (matched !== undefined) return matched
    }

    const rawFallbackWs = config?.defaultWorkspaceId ?? sessionCtx.workspaceId ?? 'default'
    const fallbackWorkspace = findCanonicalRegistryKey(rawFallbackWs, registry) ?? rawFallbackWs
    return {
        workspaceId: fallbackWorkspace,
        projectNumber: unclaimedByOtherWorkspace(
            config?.defaultProjectNumber ?? sessionCtx.projectNumber,
            fallbackWorkspace,
            registry
        ),
    }
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
