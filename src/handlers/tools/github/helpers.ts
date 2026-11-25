/**
 * GitHub Tool Helpers - Shared owner/repo resolution
 */

import type { ToolContext } from '../../../types/index.js'
import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-resolver.js'
import { markUntrustedContentInline } from '../../../utils/security-utils.js'
import { getRpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { z } from 'zod'
import { coerceIntString, relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import {
    githubScopeValidationError,
    isValidGitHubRepoSlug,
    isValidGitHubSlugPart,
    parseRepoSlug,
    resolveGitHubRegistryScope,
    resolveProjectNumber,
    type RegistryScopeResolution,
} from './repo-scope-helpers.js'

export { resolveProjectNumber }

/**
 * [INTENT] Registry scope selectors shared by GitHub tools so `resolveOwnerRepo` can target the
 * registered repository instead of the server CWD. Spread first so tool-specific fields win.
 */
export const githubScopeInputFields = {
    workspace_id: z
        .string()
        .optional()
        .describe('Registered workspace (repo name) used to resolve owner/repo when repo is omitted'),
    project_number: relaxedNumber()
        .optional()
        .describe('Registered project number used to resolve owner/repo when repo is omitted'),
}

export const githubScopeParseFields = {
    workspace_id: z.string().max(255).optional(),
    project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
}

function githubUnavailableResponse(): { error: true; response: Record<string, unknown> } {
    return {
        error: true,
        response: {
            success: false,
            error: 'GitHub integration not available',
            code: 'CONFIGURATION_ERROR',
            category: 'configuration',
            suggestion: 'Set GITHUB_TOKEN environment variable to enable GitHub integration.',
            recoverable: true,
            requiresUserInput: true,
        },
    }
}

async function validateCwdMatchesTargetScope(
    contextGithub: GitHubIntegration,
    targetScope: string,
    matchedRegistryKey: string | undefined,
    registry: RegistryScopeResolution['registry']
): Promise<{ error: true; response: Record<string, unknown> } | undefined> {
    const cachedRepo =
        typeof contextGithub.getCachedRepoInfo === 'function'
            ? contextGithub.getCachedRepoInfo()?.repo
            : undefined
    const detectedRepo =
        cachedRepo ?? (await contextGithub.getRepoInfo().catch(() => ({ repo: null }))).repo
    const detectedCanonical =
        detectedRepo !== null && detectedRepo !== undefined && detectedRepo !== ''
            ? (findCanonicalRegistryKey(detectedRepo, registry) ?? detectedRepo).toLowerCase()
            : undefined
    if (
        detectedCanonical !== targetScope.toLowerCase() &&
        detectedRepo?.toLowerCase() !== targetScope.toLowerCase()
    ) {
        return githubScopeValidationError(
            matchedRegistryKey !== undefined
                ? `workspace "${matchedRegistryKey}" is registered without a repository path and does not match the current repository (${detectedRepo ?? 'unknown'}).`
                : `workspace_id "${targetScope}" is not registered and does not match the current repository.`
        )
    }
    return undefined
}

async function resolveToolGitHubInstance(
    context: ToolContext,
    effectiveRepo: string | undefined,
    inputWorkspaceId: string | undefined,
    inputProjectNumber: number | undefined,
    scopeRes: RegistryScopeResolution,
    parsedOwner?: string,
    requireRepo = false
): Promise<
    | { github: GitHubIntegration; usedRegistryGithub: boolean }
    | { error: true; response: Record<string, unknown> }
> {
    const { matchedRegistryKey, registryEntry, hasRegistry, registry, effectiveWorkspaceScope } =
        scopeRes
    let toolGithub: GitHubIntegration | undefined
    let usedRegistryGithub = false

    if (registryEntry?.path) {
        toolGithub = getGitHubIntegration(registryEntry.path, context.config?.runtime)
        usedRegistryGithub = true
    } else if (inputWorkspaceId?.trim() === '*' && matchedRegistryKey === undefined) {
        // [BOUNDARY] The read wildcard never silently binds to the server CWD repository.
        return githubScopeValidationError(
            "workspace_id '*' cannot identify a GitHub repository. Provide repo (owner/repo), a concrete workspace_id, or a registered project_number."
        )
    } else if (!effectiveRepo && inputWorkspaceId?.trim().toLowerCase() === 'default') {
        return githubScopeValidationError(
            "workspace_id 'default' cannot identify a GitHub repository. Provide repo (owner/repo) or a registered workspace_id."
        )
    } else if (
        context.github &&
        ((effectiveRepo !== undefined && effectiveRepo !== '') ||
            inputWorkspaceId?.trim().toLowerCase() !== 'default')
    ) {
        const targetScope = !effectiveRepo
            ? (matchedRegistryKey ?? effectiveWorkspaceScope)
            : undefined
        if (targetScope !== undefined) {
            const mismatch = await validateCwdMatchesTargetScope(
                context.github,
                targetScope,
                matchedRegistryKey,
                registry
            )
            if (mismatch !== undefined) return mismatch
        } else if (
            !effectiveRepo &&
            matchedRegistryKey === undefined &&
            inputProjectNumber !== undefined &&
            hasRegistry &&
            (requireRepo || parsedOwner === undefined || parsedOwner.trim() === '')
        ) {
            return githubScopeValidationError(
                `project_number ${String(inputProjectNumber)} is not registered in projectRegistry. Provide repo (owner/repo) or a registered workspace_id.`
            )
        }
        toolGithub = context.github
    }

    if (!toolGithub?.isApiAvailable()) {
        return githubUnavailableResponse()
    }

    return { github: toolGithub, usedRegistryGithub }
}

async function resolveScopeAndGithub(
    context: ToolContext,
    inputOwner: string | undefined,
    inputRepo: string | undefined,
    inputWorkspaceId: string | undefined,
    inputProjectNumber: number | undefined,
    requireRepo = false
): Promise<
    | {
          parsedOwner: string | undefined
          effectiveRepo: string | undefined
          scopeRes: RegistryScopeResolution
          github: GitHubIntegration
          usedRegistryGithub: boolean
      }
    | { error: true; response: Record<string, unknown> }
> {
    const slug = parseRepoSlug(inputRepo)
    const initialRepo = slug.repo ?? inputRepo
    const parsedOwner = inputOwner ?? slug.owner

    const scopeRes = resolveGitHubRegistryScope(
        context,
        initialRepo,
        inputWorkspaceId,
        inputProjectNumber,
        slug
    )
    if ('error' in scopeRes) return scopeRes
    const effectiveRepo =
        slug.isFilesystemPath === true && scopeRes.matchedRegistryKey !== undefined
            ? scopeRes.matchedRegistryKey
            : initialRepo

    const ghRes = await resolveToolGitHubInstance(
        context,
        effectiveRepo,
        inputWorkspaceId,
        inputProjectNumber,
        scopeRes,
        parsedOwner,
        requireRepo
    )
    if ('error' in ghRes) return ghRes
    return {
        parsedOwner,
        effectiveRepo,
        scopeRes,
        github: ghRes.github,
        usedRegistryGithub: ghRes.usedRegistryGithub,
    }
}

function checkNestedRpcOwnerConflict(
    parsedOwner: string | undefined,
    detectedOwner: string | null,
    matchedRegistryKey: string | undefined
): { error: true; response: Record<string, unknown> } | undefined {
    const rpc = getRpcExecutionOverrides()
    const hasPinned =
        rpc !== undefined &&
        (rpc.projectNumber !== undefined ||
            (typeof rpc.workspaceId === 'string' &&
                rpc.workspaceId.trim() !== '' &&
                rpc.workspaceId.trim() !== '*'))
    if (!hasPinned || parsedOwner === undefined) return undefined
    const isForeign =
        detectedOwner !== null && parsedOwner.toLowerCase() !== detectedOwner.toLowerCase()
    const matchesRegistryPrefix =
        matchedRegistryKey?.toLowerCase().startsWith(`${parsedOwner.toLowerCase()}/`) === true
    if (isForeign || (detectedOwner === null && !matchesRegistryPrefix)) {
        return githubScopeValidationError(
            `GitHub owner '${parsedOwner}' conflicts with nested executeCode scope.`
        )
    }
    return undefined
}

/**
 * Resolve owner (owner-only, no repo required)
 */
export async function resolveOwner(
    context: ToolContext,
    inputOwner?: string,
    inputRepo?: string,
    entityLabel?: string,
    inputProjectNumber?: number,
    inputWorkspaceId?: string
): Promise<
    | {
          owner: string
          detectedOwner: string | null
          repo: string | undefined
          github: GitHubIntegration
      }
    | { error: true; response: Record<string, unknown> }
> {
    const resolvedScope = await resolveScopeAndGithub(
        context,
        inputOwner,
        inputRepo,
        inputWorkspaceId,
        inputProjectNumber,
        false
    )
    if ('error' in resolvedScope) return resolvedScope
    const { parsedOwner, effectiveRepo, scopeRes, github: toolGithub } = resolvedScope

    const repoInfo = await toolGithub.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const nestedOwnerErr = checkNestedRpcOwnerConflict(
        parsedOwner,
        detectedOwner,
        scopeRes.matchedRegistryKey
    )
    if (nestedOwnerErr !== undefined) return nestedOwnerErr
    const isForeignOwner =
        parsedOwner !== undefined &&
        detectedOwner !== null &&
        parsedOwner.toLowerCase() !== detectedOwner.toLowerCase()
    const owner = parsedOwner ?? detectedOwner ?? undefined
    const repo =
        effectiveRepo ??
        (isForeignOwner ? undefined : (scopeRes.matchedRegistryKey ?? repoInfo.repo ?? undefined))

    if (!owner) {
        return {
            error: true,
            response: {
                success: false,
                error: 'STOP: Could not auto-detect repository owner. DO NOT GUESS. You MUST ask the user to provide the GitHub owner.',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                recoverable: true,
                requiresUserInput: true,
                detectedOwner,
                instruction: entityLabel
                    ? `Ask the user: "${entityLabel}"`
                    : 'Ask the user: "What GitHub username or organization owns this project?"',
            },
        }
    }

    if (!isValidGitHubSlugPart(owner) || (repo !== undefined && !isValidGitHubRepoSlug(repo))) {
        return githubScopeValidationError('Invalid GitHub owner or repository slug.')
    }

    return { owner, detectedOwner, repo, github: toolGithub }
}

/**
 * Resolve owner + repo (both required)
 */
export async function resolveOwnerRepo(
    context: ToolContext,
    input: {
        owner?: string | undefined
        repo?: string | undefined
        project_number?: number | undefined
        workspace_id?: string | undefined
    },
    entityLabel?: string
): Promise<
    | {
          owner: string
          repo: string
          detectedOwner: string | null
          detectedRepo: string | null
          github: GitHubIntegration
      }
    | { error: true; response: Record<string, unknown> }
> {
    const resolvedScope = await resolveScopeAndGithub(
        context,
        input.owner,
        input.repo,
        input.workspace_id,
        input.project_number,
        true
    )
    if ('error' in resolvedScope) return resolvedScope
    const { parsedOwner, effectiveRepo, scopeRes, github: toolGithub, usedRegistryGithub } = resolvedScope

    const repoInfo = await toolGithub.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo
    const nestedOwnerErr = checkNestedRpcOwnerConflict(
        parsedOwner,
        detectedOwner,
        scopeRes.matchedRegistryKey
    )
    if (nestedOwnerErr !== undefined) return nestedOwnerErr
    const isForeignOwner =
        parsedOwner !== undefined &&
        detectedOwner !== null &&
        parsedOwner.toLowerCase() !== detectedOwner.toLowerCase()

    const owner = parsedOwner ?? detectedOwner ?? undefined
    const safeDetectedRepo = isForeignOwner ? null : detectedRepo
    const repo =
        effectiveRepo ??
        (usedRegistryGithub
            ? (safeDetectedRepo ?? scopeRes.matchedRegistryKey)
            : (scopeRes.matchedRegistryKey ?? safeDetectedRepo)) ??
        undefined

    if (!owner || !repo) {
        return {
            error: true,
            response: {
                success: false,
                error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                recoverable: true,
                requiresUserInput: true,
                detectedOwner,
                detectedRepo,
                ...(entityLabel
                    ? {
                          instruction: `Ask the user: "What GitHub repository ${entityLabel}? Please provide the owner and repo name (e.g., owner/repo)."`,
                      }
                    : {}),
            },
        }
    }

    if (!isValidGitHubSlugPart(owner) || !isValidGitHubSlugPart(repo)) {
        return githubScopeValidationError('Invalid GitHub owner or repository slug.')
    }

    return { owner, repo, detectedOwner, detectedRepo, github: toolGithub }
}

/**
 * Shallow-clones a GitHub issue and fences `milestone.title` at MCP tool egress without
 * mutating cached GitHub integration objects.
 */
export function fenceIssueMilestone<
    T extends { milestone?: { number: number; title: string } | null | undefined },
>(issue: T): T {
    if (issue.milestone === undefined || issue.milestone === null) {
        return { ...issue }
    }
    return {
        ...issue,
        milestone: {
            ...issue.milestone,
            title: markUntrustedContentInline(issue.milestone.title),
        },
    }
}
