/**
 * GitHub Tool Helpers - Shared owner/repo resolution
 */

import type { ToolContext } from '../../../types/index.js'
import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../../utils/workspace-resolver.js'
import { z } from 'zod'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'

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
    workspace_id: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(),
}

function parseRepoSlug(repo?: string): { owner?: string; repo?: string } {
    if (!repo) return {}
    if (/^[a-zA-Z]:[/\\]|^[/\\]/.test(repo) || repo.includes('\\')) {
        const leaf = repo.split(/[/\\]/).filter(Boolean).pop()?.replace(/\.git$/i, '')
        return leaf ? { repo: leaf } : { repo }
    }
    if (repo.includes('/')) {
        const parts = repo.split('/').filter(Boolean)
        if (parts.length === 2 && parts[0] && parts[1]) {
            return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') }
        }
        const leaf = parts.pop()?.replace(/\.git$/i, '')
        if (leaf) return { repo: leaf }
    }
    return { repo }
}

/**
 * Resolve project number explicitly or via ProjectRegistry mapping
 */
export function resolveProjectNumber(
    context: ToolContext,
    repo: string | undefined,
    explicitProjectNumber?: number | null,
    owner?: string,
    detectedOwner?: string | null
): number | undefined {
    if (explicitProjectNumber != null) return explicitProjectNumber
    const slug = repo !== undefined ? parseRepoSlug(repo) : undefined
    const effectiveOwner = owner ?? slug?.owner
    if (
        effectiveOwner !== undefined &&
        detectedOwner !== undefined &&
        detectedOwner !== null &&
        effectiveOwner.toLowerCase() !== detectedOwner.toLowerCase()
    ) {
        return undefined
    }
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (!registry || !repo) return undefined
    const repoName = slug?.repo ?? repo
    const canonicalKey = findCanonicalRegistryKey(repoName, registry) ?? repoName
    if (Object.prototype.hasOwnProperty.call(registry, canonicalKey)) {
        const entry = registry[canonicalKey]
        if (entry?.project_number != null) {
            return entry.project_number
        }
    }
    return undefined
}

type Registry = ReturnType<typeof loadProjectRegistryFromConfig>
type RegistryEntry = NonNullable<Registry>[string]

interface RegistryScopeResolution {
    matchedRegistryKey: string | undefined
    registryEntry: RegistryEntry | undefined
    hasRegistry: boolean
    registry: Registry | undefined
    effectiveWorkspaceScope: string | undefined
}

function githubScopeValidationError(error: string): {
    error: true
    response: Record<string, unknown>
} {
    return {
        error: true,
        response: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        },
    }
}

function resolveGitHubRegistryScope(
    context: ToolContext,
    effectiveRepo: string | undefined,
    inputWorkspaceId: string | undefined,
    inputProjectNumber: number | undefined
): RegistryScopeResolution | { error: true; response: Record<string, unknown> } {
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    const trimmedWs = inputWorkspaceId?.trim()
    const namedDefault = trimmedWs?.toLowerCase() === 'default'
    const concreteWs =
        trimmedWs !== undefined && trimmedWs !== '' && trimmedWs !== '*' && !namedDefault
            ? trimmedWs
            : undefined
    const defaultWsRaw = context.config?.defaultWorkspaceId?.trim()
    const configuredDefaultWs =
        defaultWsRaw !== undefined &&
        defaultWsRaw !== '' &&
        defaultWsRaw !== '*' &&
        defaultWsRaw.toLowerCase() !== 'default'
            ? defaultWsRaw
            : undefined
    const effectiveWorkspaceScope =
        concreteWs ??
        (!effectiveRepo &&
        inputProjectNumber === undefined &&
        trimmedWs !== '*' &&
        !namedDefault
            ? configuredDefaultWs
            : undefined)

    if (registry) {
        const wsKey =
            concreteWs !== undefined ? findCanonicalRegistryKey(concreteWs, registry) : undefined
        const repoKey = effectiveRepo
            ? findCanonicalRegistryKey(effectiveRepo, registry)
            : undefined
        if (
            concreteWs !== undefined &&
            effectiveRepo !== undefined &&
            effectiveRepo !== '' &&
            (wsKey ?? concreteWs).toLowerCase() !== (repoKey ?? effectiveRepo).toLowerCase()
        ) {
            return githubScopeValidationError(
                `workspace_id "${concreteWs}" does not match repository "${effectiveRepo}".`
            )
        }
        if (inputProjectNumber !== undefined) {
            const matches = Object.entries(registry).filter(
                ([, entry]) => entry.project_number === inputProjectNumber
            )
            if (matches.length > 1) {
                return githubScopeValidationError(
                    `project_number ${String(inputProjectNumber)} is registered to more than one workspace.`
                )
            }
            const projectOwner = matches[0]?.[0]
            if (projectOwner !== undefined) {
                if (
                    concreteWs !== undefined &&
                    (wsKey ?? concreteWs).toLowerCase() !== projectOwner.toLowerCase()
                ) {
                    return githubScopeValidationError(
                        `project_number ${String(inputProjectNumber)} belongs to workspace "${projectOwner}", not "${concreteWs}".`
                    )
                }
                if (
                    effectiveRepo !== undefined &&
                    effectiveRepo !== '' &&
                    (repoKey ?? effectiveRepo).toLowerCase() !== projectOwner.toLowerCase()
                ) {
                    return githubScopeValidationError(
                        `project_number ${String(inputProjectNumber)} belongs to workspace "${projectOwner}", not repository "${effectiveRepo}".`
                    )
                }
            }
            const targetKey = repoKey ?? wsKey
            const registeredProject =
                targetKey !== undefined ? registry[targetKey]?.project_number : undefined
            if (registeredProject !== undefined && registeredProject !== inputProjectNumber) {
                return githubScopeValidationError(
                    `project_number ${String(inputProjectNumber)} does not match registered project ${String(registeredProject)} for workspace "${targetKey ?? ''}".`
                )
            }
        }
    }

    let matchedRegistryKey: string | undefined
    if (!effectiveRepo && registry) {
        const lookupWs = concreteWs ?? effectiveWorkspaceScope
        if (lookupWs !== undefined) {
            matchedRegistryKey =
                findCanonicalRegistryKey(lookupWs, registry) ??
                (Object.prototype.hasOwnProperty.call(registry, lookupWs) ? lookupWs : undefined)
        }
        if (matchedRegistryKey === undefined && inputProjectNumber !== undefined && !namedDefault) {
            const matches = Object.entries(registry).filter(
                ([, entry]) => entry.project_number === inputProjectNumber
            )
            const matched = matches[0]
            if (matched !== undefined) matchedRegistryKey = matched[0]
        }
    }
    const registryKey = effectiveRepo
        ? (findCanonicalRegistryKey(effectiveRepo, registry) ??
          (registry && Object.prototype.hasOwnProperty.call(registry, effectiveRepo)
              ? effectiveRepo
              : undefined))
        : matchedRegistryKey
    const registryEntry = registryKey && registry ? registry[registryKey] : undefined
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    return {
        matchedRegistryKey,
        registryEntry,
        hasRegistry,
        registry,
        effectiveWorkspaceScope,
    }
}

async function resolveToolGitHubInstance(
    context: ToolContext,
    effectiveRepo: string | undefined,
    inputWorkspaceId: string | undefined,
    inputProjectNumber: number | undefined,
    scopeRes: RegistryScopeResolution,
    parsedOwner?: string
): Promise<
    | { github: GitHubIntegration; usedRegistryGithub: boolean }
    | { error: true; response: Record<string, unknown> }
> {
    const { matchedRegistryKey, registryEntry, hasRegistry, registry, effectiveWorkspaceScope } = scopeRes
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
    } else if (
        !effectiveRepo &&
        inputWorkspaceId?.trim().toLowerCase() === 'default'
    ) {
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
            const cachedRepo =
                typeof context.github.getCachedRepoInfo === 'function'
                    ? context.github.getCachedRepoInfo()?.repo
                    : undefined
            const detectedRepo =
                cachedRepo ??
                (await context.github.getRepoInfo().catch(() => ({ repo: null }))).repo
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
            toolGithub = context.github
        } else if (
            !effectiveRepo &&
            matchedRegistryKey === undefined &&
            inputProjectNumber !== undefined &&
            hasRegistry &&
            (parsedOwner === undefined || parsedOwner.trim() === '')
        ) {
            return githubScopeValidationError(
                `project_number ${String(inputProjectNumber)} is not registered in projectRegistry. Provide repo (owner/repo) or a registered workspace_id.`
            )
        } else {
            toolGithub = context.github
        }
    }

    if (!toolGithub?.isApiAvailable()) {
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

    return { github: toolGithub, usedRegistryGithub }
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
    const slug = parseRepoSlug(inputRepo)
    const effectiveRepo = slug.repo ?? inputRepo
    const parsedOwner = inputOwner ?? slug.owner

    const scopeRes = resolveGitHubRegistryScope(
        context,
        effectiveRepo,
        inputWorkspaceId,
        inputProjectNumber
    )
    if ('error' in scopeRes) return scopeRes

    const ghRes = await resolveToolGitHubInstance(
        context,
        effectiveRepo,
        inputWorkspaceId,
        inputProjectNumber,
        scopeRes,
        parsedOwner
    )
    if ('error' in ghRes) return ghRes
    const toolGithub = ghRes.github

    const repoInfo = await toolGithub.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const isForeignOwner =
        parsedOwner !== undefined &&
        detectedOwner !== null &&
        parsedOwner.toLowerCase() !== detectedOwner.toLowerCase()
    const owner = parsedOwner ?? detectedOwner ?? undefined
    const repo = effectiveRepo ?? (isForeignOwner ? undefined : (repoInfo.repo ?? undefined))

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

    return { owner, detectedOwner, repo, github: toolGithub }
}

/**
 * Resolve owner + repo (both required)
 */
export async function resolveOwnerRepo(
    context: ToolContext,
    input: { owner?: string; repo?: string; project_number?: number; workspace_id?: string },
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
    const slug = parseRepoSlug(input.repo)
    const effectiveRepo = slug.repo ?? input.repo
    const parsedOwner = input.owner ?? slug.owner

    const scopeRes = resolveGitHubRegistryScope(
        context,
        effectiveRepo,
        input.workspace_id,
        input.project_number
    )
    if ('error' in scopeRes) return scopeRes

    const ghRes = await resolveToolGitHubInstance(
        context,
        effectiveRepo,
        input.workspace_id,
        input.project_number,
        scopeRes,
        parsedOwner
    )
    if ('error' in ghRes) return ghRes
    const { github: toolGithub, usedRegistryGithub } = ghRes

    const repoInfo = await toolGithub.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo
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

    return { owner, repo, detectedOwner, detectedRepo, github: toolGithub }
}
