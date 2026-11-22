import type { ToolContext } from '../../../types/index.js'
import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import {
    cwdMatchesRegistryPath,
    findCanonicalRegistryKey,
    getActiveSessionProject,
    loadProjectRegistryFromConfig,
    resolveProjectContext,
} from '../../../utils/workspace-resolver.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { sanitizeErrorForLogging } from '../../../utils/security-utils.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import type { ExecuteCodeInput } from './payload-synthesizer.js'

type ProjectRegistry = NonNullable<ToolContext['config']>['projectRegistry']

export function lookupRegistryEntry(
    registry: ProjectRegistry,
    key: string
): { path?: string; project_number?: number } | undefined {
    if (!registry) return undefined
    const direct = Object.hasOwn(registry, key) ? registry[key] : undefined
    if (direct !== undefined) return direct
    const canonical = findCanonicalRegistryKey(key, registry)
    if (canonical !== undefined && Object.hasOwn(registry, canonical)) return registry[canonical]
    if (/[/\\]/.test(key)) {
        const repoName = key.split(/[/\\]/).filter(Boolean).pop()
        if (repoName !== undefined && repoName !== '') {
            if (Object.hasOwn(registry, repoName)) return registry[repoName]
            const repoCanonical = findCanonicalRegistryKey(repoName, registry)
            if (repoCanonical !== undefined && Object.hasOwn(registry, repoCanonical)) {
                return registry[repoCanonical]
            }
        }
    }
    return undefined
}

function githubInjectError(error: string): { errorResponse: Record<string, unknown> } {
    return { errorResponse: { success: false, error, project_id: undefined, executionTimeMs: 0 } }
}

function resolveSessionProjectId(
    context: ToolContext,
    input: ExecuteCodeInput,
    effectiveRegistry: ProjectRegistry
): number | string | undefined {
    const rawWorkspace = input.workspace_id ?? input.workspaceId
    const rawProjInput = input.project_number ?? input.projectNumber
    let projectId: number | string | undefined = rawProjInput
    if ((projectId === undefined || projectId === null) && rawWorkspace !== undefined && rawWorkspace !== '') {
        const wsEntry = lookupRegistryEntry(effectiveRegistry, rawWorkspace)
        if (wsEntry?.project_number !== undefined) projectId = wsEntry.project_number
    }
    const rawRepo = (input.repo ?? input.repo_name ?? input.repoName ?? input.repository)?.trim()
    if ((projectId === undefined || projectId === null) && rawRepo !== undefined && rawRepo !== '') {
        const repoEntry = lookupRegistryEntry(effectiveRegistry, rawRepo)
        if (repoEntry?.project_number !== undefined) projectId = repoEntry.project_number
    }
    const callerExplicitWorkspaceOrRepo =
        (rawWorkspace !== undefined && rawWorkspace.trim() !== '') ||
        (rawRepo !== undefined && rawRepo !== '')
    if (!callerExplicitWorkspaceOrRepo) {
        projectId ??= projectIdFromDefaults(context, effectiveRegistry)
    }
    if (typeof projectId === 'string') {
        const entry = lookupRegistryEntry(effectiveRegistry, projectId)
        if (entry?.project_number !== undefined) projectId = entry.project_number
    }
    if (typeof projectId === 'string') {
        const parsed = parseCanonicalPositiveInt(projectId)
        if (parsed !== undefined) projectId = parsed
    }
    return projectId
}

function projectIdFromDefaults(
    context: ToolContext,
    effectiveRegistry: ProjectRegistry
): number | undefined {
    const rawDefaultWs = context.config?.defaultWorkspaceId?.trim()
    if (rawDefaultWs !== undefined && rawDefaultWs !== '' && rawDefaultWs !== '*') {
        if (rawDefaultWs.toLowerCase() === 'default') {
            return lookupRegistryEntry(effectiveRegistry, 'default')?.project_number
        }
        return (
            lookupRegistryEntry(effectiveRegistry, rawDefaultWs)?.project_number ??
            context.config?.defaultProjectNumber
        )
    }
    if (context.config?.defaultProjectNumber !== undefined) {
        return context.config.defaultProjectNumber
    }
    if (effectiveRegistry === undefined) return undefined
    const cwd = process.cwd()
    const sortedEntries = Object.values(effectiveRegistry)
        .filter(
            (entry): entry is { path: string; project_number: number } =>
                entry.path !== undefined &&
                entry.path !== '' &&
                entry.project_number !== undefined
        )
        .sort(
            (a, b) =>
                b.path.replace(/\\/g, '/').replace(/\/+$/, '').length -
                a.path.replace(/\\/g, '/').replace(/\/+$/, '').length
        )
    for (const entry of sortedEntries) {
        if (cwdMatchesRegistryPath(entry.path, cwd)) {
            return entry.project_number
        }
    }
    return undefined
}

const DERIVED_GITHUB_CONTEXTS = new WeakMap<ToolContext, WeakMap<object, ToolContext>>()

function withInjectedGithubContext(context: ToolContext, injectedGithub: NonNullable<ToolContext['github']>): ToolContext {
    if (context.github === injectedGithub) return context
    let byGithub = DERIVED_GITHUB_CONTEXTS.get(context)
    if (byGithub === undefined) {
        byGithub = new WeakMap<object, ToolContext>()
        DERIVED_GITHUB_CONTEXTS.set(context, byGithub)
    }
    let derived = byGithub.get(injectedGithub)
    if (derived === undefined) {
        derived = { ...context, github: injectedGithub }
        byGithub.set(injectedGithub, derived)
    }
    return derived
}

async function injectRepoGithub(
    context: ToolContext,
    repo: string | undefined,
    effectiveRegistry: ProjectRegistry
): Promise<ToolContext | { errorResponse: Record<string, unknown> }> {
    if (repo === undefined || repo === '') return context
    if (context.config?.codemodeInternalFullAccess !== true) {
        return githubInjectError('Repo switching is restricted to internal administrative access.')
    }
    const registryEntry = lookupRegistryEntry(effectiveRegistry, repo)
    if (registryEntry?.path === undefined || registryEntry.path === '') return context
    try {
        const injectedGithub = getGitHubIntegration(
            registryEntry.path,
            context.config?.runtime,
            process.env['GITHUB_TOKEN']
        )
        await injectedGithub.getRepoInfo()
        return withInjectedGithubContext(context, injectedGithub)
    } catch (error) {
        return githubInjectError(
            sanitizeErrorForLogging(
                `Failed to initialize injected repository '${repo}': ${error instanceof Error ? error.message : String(error)}`
            )
        )
    }
}

function injectProjectGithub(
    sessionContext: ToolContext,
    projectId: number | string | undefined,
    effectiveRegistry: ProjectRegistry,
    fullAccess: boolean,
    workspaceId?: string
): ToolContext | { errorResponse: Record<string, unknown> } {
    if (effectiveRegistry === undefined) return sessionContext
    const concreteWs =
        workspaceId !== undefined &&
        workspaceId !== '' &&
        workspaceId !== '*' &&
        workspaceId.toLowerCase() !== 'default'
            ? workspaceId
            : undefined
    let registryEntry =
        concreteWs !== undefined ? lookupRegistryEntry(effectiveRegistry, concreteWs) : undefined
    if (registryEntry === undefined && projectId !== undefined && concreteWs === undefined) {
        const matches = Object.values(effectiveRegistry).filter(
            (entry) => entry.project_number === projectId
        )
        if (matches.length === 1) {
            registryEntry = matches[0]
        }
    }
    if (registryEntry?.path === undefined || registryEntry.path === '') return sessionContext
    const isSameAsCwd = cwdMatchesRegistryPath(registryEntry.path, process.cwd())
    if (!fullAccess && !isSameAsCwd) return sessionContext
    // [M11] Keep the context identity when the CWD GitHub integration already applies, so the
    // per-context tool cache in singleton-state is not thrashed on every execution.
    if (isSameAsCwd && sessionContext.github !== undefined) return sessionContext
    try {
        const injectedGithub = getGitHubIntegration(
            registryEntry.path,
            sessionContext.config?.runtime,
            process.env['GITHUB_TOKEN']
        )
        return withInjectedGithubContext(sessionContext, injectedGithub)
    } catch (error) {
        return githubInjectError(
            sanitizeErrorForLogging(
                `Failed to initialize GitHub context for project ${String(projectId)}: ${error instanceof Error ? error.message : String(error)}`
            )
        )
    }
}

interface ValidatedSessionInput {
    rawWsTrimmed: string | undefined
    rawRepoTrimmed: string | undefined
    hasExplicitRepo: boolean
    hasExplicitConcreteWs: boolean
    explicitWorkspace: boolean
    repoLeaf: string | undefined
    repoRegistryKey: string | undefined
}

function validateExplicitRepoAndWorkspaceInput(
    input: ExecuteCodeInput,
    effectiveRegistry: ProjectRegistry
): ValidatedSessionInput | { errorResponse: Record<string, unknown> } {
    const rawWsTrimmed = (input.workspace_id ?? input.workspaceId)?.trim()
    const rawRepoTrimmed = (input.repo ?? input.repo_name ?? input.repoName ?? input.repository)?.trim()
    const hasExplicitRepo = rawRepoTrimmed !== undefined && rawRepoTrimmed !== ''
    const hasExplicitConcreteWs =
        rawWsTrimmed !== undefined && rawWsTrimmed !== '' && rawWsTrimmed !== '*'
    const explicitWorkspace = hasExplicitConcreteWs || hasExplicitRepo

    let repoRegistryKey: string | undefined
    const repoLeaf =
        hasExplicitRepo && /[/\\]/.test(rawRepoTrimmed)
            ? (rawRepoTrimmed.split(/[/\\]/).filter(Boolean).pop()?.trim() ?? rawRepoTrimmed)
            : rawRepoTrimmed
    if (hasExplicitRepo && effectiveRegistry !== undefined) {
        repoRegistryKey =
            (repoLeaf !== undefined && repoLeaf !== ''
                ? findCanonicalRegistryKey(repoLeaf, effectiveRegistry)
                : undefined) ?? findCanonicalRegistryKey(rawRepoTrimmed, effectiveRegistry)
    }

    if (hasExplicitConcreteWs && hasExplicitRepo) {
        if (repoRegistryKey !== undefined && effectiveRegistry !== undefined) {
            const wsKey = findCanonicalRegistryKey(rawWsTrimmed, effectiveRegistry)
            if (
                rawWsTrimmed.toLowerCase() === 'default' ||
                (wsKey ?? rawWsTrimmed).toLowerCase() !== repoRegistryKey.toLowerCase()
            ) {
                return githubInjectError(
                    `workspace_id '${rawWsTrimmed}' conflicts with repo '${rawRepoTrimmed}' (registered workspace '${repoRegistryKey}').`
                )
            }
        } else if (
            rawWsTrimmed.toLowerCase() === 'default' ||
            (repoLeaf !== undefined &&
                repoLeaf !== '' &&
                rawWsTrimmed.toLowerCase() !== repoLeaf.toLowerCase())
        ) {
            return githubInjectError(
                `workspace_id '${rawWsTrimmed}' conflicts with repo '${rawRepoTrimmed}'.`
            )
        }
    }

    if (
        hasExplicitRepo &&
        effectiveRegistry !== undefined &&
        Object.keys(effectiveRegistry).length > 0 &&
        repoRegistryKey === undefined
    ) {
        return githubInjectError(
            `Repository '${rawRepoTrimmed}' is not registered in projectRegistry.`
        )
    }

    return {
        rawWsTrimmed,
        rawRepoTrimmed,
        hasExplicitRepo,
        hasExplicitConcreteWs,
        explicitWorkspace,
        repoLeaf,
        repoRegistryKey,
    }
}

function resolveConfiguredOrSessionFallback(
    context: ToolContext,
    rawProjectInput: unknown,
    explicitWorkspace: boolean,
    isWildcardWorkspace: boolean,
    numericProjectId: number | undefined,
    effectiveRegistry: ProjectRegistry
): { fallbackConfiguredWs: string | undefined; effectiveProjectInput: number | undefined } {
    const configuredDefaultWsRaw = context.config?.defaultWorkspaceId?.trim()
    const configuredDefaultWs =
        configuredDefaultWsRaw !== undefined && configuredDefaultWsRaw !== '' && configuredDefaultWsRaw !== '*'
            ? configuredDefaultWsRaw
            : undefined
    const sessionCtx = getActiveSessionProject(context.config?.runtime)
    const sessionWs =
        sessionCtx.workspaceId !== undefined &&
        sessionCtx.workspaceId.trim() !== '' &&
        sessionCtx.workspaceId.trim() !== '*'
            ? sessionCtx.workspaceId.trim()
            : undefined
    const hasActiveSessionScope = sessionWs !== undefined || sessionCtx.projectNumber !== undefined
    const isSessionDefaultOrOmitted = sessionWs === undefined || sessionWs.toLowerCase() === 'default'
    const claimedByRegisteredWs =
        sessionCtx.projectNumber !== undefined &&
        effectiveRegistry !== undefined &&
        Object.entries(effectiveRegistry).some(
            ([k, v]) => k.toLowerCase() !== 'default' && v.project_number === sessionCtx.projectNumber
        )
    const useSessionDefaultScope =
        rawProjectInput === undefined &&
        !explicitWorkspace &&
        !isWildcardWorkspace &&
        configuredDefaultWs?.toLowerCase() === 'default' &&
        isSessionDefaultOrOmitted &&
        sessionCtx.projectNumber !== undefined
    let fallbackConfiguredWs: string | undefined
    if (rawProjectInput === undefined && configuredDefaultWs !== undefined) {
        if (useSessionDefaultScope && claimedByRegisteredWs) {
            fallbackConfiguredWs = undefined
        } else if (configuredDefaultWs.toLowerCase() === 'default' && hasActiveSessionScope) {
            fallbackConfiguredWs = sessionWs
        } else {
            fallbackConfiguredWs = configuredDefaultWs
        }
    }
    const effectiveProjectInput =
        numericProjectId ??
        (rawProjectInput === undefined &&
        !explicitWorkspace &&
        !isWildcardWorkspace &&
        configuredDefaultWs?.toLowerCase() === 'default' &&
        isSessionDefaultOrOmitted
            ? sessionCtx.projectNumber
            : undefined)
    return { fallbackConfiguredWs, effectiveProjectInput }
}

function resolveSessionWorkspaceAndProjectPair(
    context: ToolContext,
    input: ExecuteCodeInput,
    effectiveRegistry: ProjectRegistry,
    validated: ValidatedSessionInput
):
    | { projectId: number | string | undefined; numericProjectId: number | undefined; workspaceId: string }
    | { errorResponse: Record<string, unknown> } {
    const rawWorkspaceInputRaw = input.workspace_id ?? input.workspaceId
    const rawWorkspaceInput =
        typeof rawWorkspaceInputRaw === 'string' && rawWorkspaceInputRaw.trim() !== ''
            ? rawWorkspaceInputRaw.trim()
            : undefined
    const rawProjectInput = input.project_number ?? input.projectNumber
    const explicitDefaultWithoutProject =
        validated.rawWsTrimmed?.toLowerCase() === 'default' && rawProjectInput === undefined
    let projectId = explicitDefaultWithoutProject
        ? undefined
        : resolveSessionProjectId(context, input, effectiveRegistry)
    if (
        rawProjectInput !== undefined &&
        (typeof projectId !== 'number' || !Number.isSafeInteger(projectId) || projectId <= 0)
    ) {
        return githubInjectError(
            `Invalid project_number '${String(rawProjectInput)}'. Expected a positive integer or registered project name.`
        )
    }

    const isWildcardWorkspace = validated.rawWsTrimmed === '*'
    let numericProjectId = typeof projectId === 'number' ? projectId : undefined
    // [C3] Session scope is never guessed from keywords inside the submitted code.
    const fallbackRepoWs =
        validated.repoRegistryKey ??
        (validated.repoLeaf !== undefined && validated.repoLeaf !== '' ? validated.repoLeaf : undefined)
    const { fallbackConfiguredWs, effectiveProjectInput } = resolveConfiguredOrSessionFallback(
        context,
        rawProjectInput,
        validated.explicitWorkspace,
        isWildcardWorkspace,
        numericProjectId,
        effectiveRegistry
    )

    const resolvedContext = resolveProjectContext(
        {
            workspace_id:
                rawWorkspaceInput ??
                (!validated.hasExplicitConcreteWs ? (fallbackRepoWs ?? fallbackConfiguredWs) : undefined),
            project_number: effectiveProjectInput,
        },
        context.config
    )
    const workspaceId = isWildcardWorkspace ? '*' : resolvedContext.workspaceId
    if (numericProjectId !== undefined && workspaceId !== '*') {
        pairStoredScope(workspaceId, numericProjectId, activeProjectRegistry(effectiveRegistry))
    } else if (!isWildcardWorkspace && !explicitDefaultWithoutProject && resolvedContext.projectNumber !== undefined) {
        numericProjectId = resolvedContext.projectNumber
        projectId = resolvedContext.projectNumber
    }
    return { projectId, numericProjectId, workspaceId }
}

export async function resolveCodeModeSessionContext(
    context: ToolContext,
    input: ExecuteCodeInput
): Promise<
    | {
          sessionContext: ToolContext
          projectId: number | string | undefined
          numericProjectId: number | undefined
          workspaceId: string | undefined
          explicitWorkspace: boolean
      }
    | { errorResponse: Record<string, unknown> }
> {
    const effectiveRegistry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    const validated = validateExplicitRepoAndWorkspaceInput(input, effectiveRegistry)
    if ('errorResponse' in validated) return validated

    const scoped = resolveSessionWorkspaceAndProjectPair(context, input, effectiveRegistry, validated)
    if ('errorResponse' in scoped) return scoped

    const repoContext = await injectRepoGithub(
        context,
        input.repo ?? input.repo_name ?? input.repoName ?? input.repository,
        effectiveRegistry
    )
    if ('errorResponse' in repoContext) return repoContext
    const sessionContext = validated.hasExplicitRepo
        ? repoContext
        : injectProjectGithub(
              repoContext,
              scoped.projectId,
              effectiveRegistry,
              context.config?.codemodeInternalFullAccess === true,
              scoped.workspaceId
          )
    if ('errorResponse' in sessionContext) return sessionContext
    return {
        sessionContext,
        projectId: scoped.projectId,
        numericProjectId: scoped.numericProjectId,
        workspaceId: scoped.workspaceId,
        explicitWorkspace: validated.explicitWorkspace,
    }
}
