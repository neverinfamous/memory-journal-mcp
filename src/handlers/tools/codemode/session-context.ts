import * as path from 'node:path'
import type { ToolContext } from '../../../types/index.js'
import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import {
    cwdMatchesRegistryPath,
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveProjectContext,
} from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import type { ExecuteCodeInput } from './payload-synthesizer.js'

type ProjectRegistry = NonNullable<ToolContext['config']>['projectRegistry']

export function lookupRegistryEntry(
    registry: ProjectRegistry,
    key: string
): { path?: string; project_number?: number } | undefined {
    if (!registry) return undefined
    const direct = registry[key]
    if (direct) return direct
    const canonical = findCanonicalRegistryKey(key, registry)
    if (canonical !== undefined && registry[canonical] !== undefined) return registry[canonical]
    if (key.includes('/')) {
        const repoName = key.split('/').pop()
        if (repoName !== undefined && repoName !== '') {
            if (registry[repoName] !== undefined) return registry[repoName]
            const repoCanonical = findCanonicalRegistryKey(repoName, registry)
            if (repoCanonical !== undefined) return registry[repoCanonical]
        }
    }
    return undefined
}

function comparablePath(filePath: string): string {
    const resolved = path.resolve(filePath)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function githubInjectError(error: string): { errorResponse: Record<string, unknown> } {
    return { errorResponse: { success: false, error, project_id: undefined, executionTimeMs: 0 } }
}

function resolveSessionProjectId(
    context: ToolContext,
    input: ExecuteCodeInput,
    effectiveRegistry: ProjectRegistry
): number | string | undefined {
    let projectId: number | string | undefined = input.project_number
    if (
        (projectId === undefined || projectId === null) &&
        input.workspace_id?.trim().toLowerCase() === 'default'
    ) {
        return lookupRegistryEntry(effectiveRegistry, input.workspace_id)?.project_number
    }
    if ((projectId === undefined || projectId === null) && input.workspace_id !== undefined && input.workspace_id !== '') {
        const wsEntry = lookupRegistryEntry(effectiveRegistry, input.workspace_id)
        if (wsEntry?.project_number !== undefined) projectId = wsEntry.project_number
    }
    if ((projectId === undefined || projectId === null) && input.repo !== undefined && input.repo !== '') {
        const repoEntry = lookupRegistryEntry(effectiveRegistry, input.repo)
        if (repoEntry?.project_number !== undefined) projectId = repoEntry.project_number
    }
    projectId ??= projectIdFromDefaults(context, effectiveRegistry)
    if (typeof projectId === 'string') {
        const entry = lookupRegistryEntry(effectiveRegistry, projectId)
        if (entry?.project_number !== undefined) projectId = entry.project_number
    }
    if (typeof projectId === 'string') {
        const parsed = Number(projectId)
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) projectId = parsed
    }
    return projectId
}

function projectIdFromDefaults(
    context: ToolContext,
    effectiveRegistry: ProjectRegistry
): number | undefined {
    if (context.config?.defaultProjectNumber !== undefined) {
        return context.config.defaultProjectNumber
    }
    if (effectiveRegistry === undefined) return undefined
    const cwd = process.cwd()
    for (const entry of Object.values(effectiveRegistry)) {
        if (
            entry.path !== undefined &&
            entry.path !== '' &&
            cwdMatchesRegistryPath(entry.path, cwd) &&
            entry.project_number !== undefined
        ) {
            return entry.project_number
        }
    }
    return undefined
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
        return { ...context, github: injectedGithub }
    } catch (error) {
        return githubInjectError(
            `Failed to initialize injected repository '${repo}': ${error instanceof Error ? error.message : String(error)}`
        )
    }
}

function injectProjectGithub(
    sessionContext: ToolContext,
    projectId: number | string | undefined,
    effectiveRegistry: ProjectRegistry,
    fullAccess: boolean
): ToolContext | { errorResponse: Record<string, unknown> } {
    if (projectId === undefined || effectiveRegistry === undefined) return sessionContext
    const registryEntry = Object.values(effectiveRegistry).find((entry) => entry.project_number === projectId)
    if (registryEntry?.path === undefined || registryEntry.path === '') return sessionContext
    const isSameAsCwd = comparablePath(registryEntry.path) === comparablePath(process.cwd())
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
        return { ...sessionContext, github: injectedGithub }
    } catch (error) {
        return githubInjectError(
            `Failed to initialize GitHub context for project ${String(projectId)}: ${error instanceof Error ? error.message : String(error)}`
        )
    }
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
      }
    | { errorResponse: Record<string, unknown> }
> {
    const effectiveRegistry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    let projectId = resolveSessionProjectId(context, input, effectiveRegistry)
    let numericProjectId = typeof projectId === 'number' ? projectId : undefined
    // [C3] Session scope is never guessed from keywords inside the submitted code.
    const resolvedContext = resolveProjectContext(
        {
            workspace_id: input.workspace_id,
            project_number: numericProjectId,
        },
        context.config
    )
    const workspaceId = resolvedContext.workspaceId
    if (numericProjectId !== undefined) {
        pairStoredScope(workspaceId, numericProjectId, activeProjectRegistry(context.config?.projectRegistry))
    } else if (resolvedContext.projectNumber !== undefined) {
        numericProjectId = resolvedContext.projectNumber
        projectId = resolvedContext.projectNumber
    }

    const repoContext = await injectRepoGithub(context, input.repo, effectiveRegistry)
    if ('errorResponse' in repoContext) return repoContext
    const sessionContext = injectProjectGithub(
        repoContext,
        projectId,
        effectiveRegistry,
        context.config?.codemodeInternalFullAccess === true
    )
    if ('errorResponse' in sessionContext) return sessionContext
    return { sessionContext, projectId, numericProjectId, workspaceId }
}
