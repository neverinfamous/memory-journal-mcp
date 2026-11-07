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

function parseRepoSlug(repo?: string): { owner?: string; repo?: string } {
    if (!repo) return {}
    if (repo.includes('/')) {
        const parts = repo.split('/')
        if (parts.length >= 2 && parts[0] && parts[1]) {
            return { owner: parts[0], repo: parts[1] }
        }
    }
    return { repo }
}

/**
 * Resolve project number explicitly or via ProjectRegistry mapping
 */
export function resolveProjectNumber(
    context: ToolContext,
    repo: string | undefined,
    explicitProjectNumber?: number | null
): number | undefined {
    if (explicitProjectNumber != null) return explicitProjectNumber
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (!registry || !repo) return undefined
    const slug = parseRepoSlug(repo)
    const repoName = slug.repo ?? repo
    const canonicalKey = findCanonicalRegistryKey(repoName, registry) ?? repoName
    if (Object.prototype.hasOwnProperty.call(registry, canonicalKey)) {
        const entry = registry[canonicalKey]
        if (entry?.project_number != null) {
            return entry.project_number
        }
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
    const slug = parseRepoSlug(inputRepo)
    const effectiveRepo = slug.repo ?? inputRepo
    const parsedOwner = inputOwner ?? slug.owner

    let toolGithub: GitHubIntegration | undefined
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    let matchedRegistryKey: string | undefined
    if (!effectiveRepo && registry) {
        if (
            inputWorkspaceId !== undefined &&
            inputWorkspaceId !== 'default' &&
            inputWorkspaceId !== '*'
        ) {
            matchedRegistryKey =
                findCanonicalRegistryKey(inputWorkspaceId, registry) ??
                (Object.prototype.hasOwnProperty.call(registry, inputWorkspaceId)
                    ? inputWorkspaceId
                    : undefined)
        } else if (inputProjectNumber !== undefined) {
            const matched = Object.entries(registry).find(
                ([, entry]) => entry.project_number === inputProjectNumber
            )
            if (matched) matchedRegistryKey = matched[0]
        }
    }
    const registryKey = effectiveRepo
        ? (findCanonicalRegistryKey(effectiveRepo, registry) ??
          (registry && Object.prototype.hasOwnProperty.call(registry, effectiveRepo)
              ? effectiveRepo
              : undefined))
        : matchedRegistryKey
    const registryEntry = registryKey && registry ? registry[registryKey] : undefined

    if (registryEntry?.path) {
        toolGithub = getGitHubIntegration(registryEntry.path, context.config?.runtime)
    } else if (context.github) {
        toolGithub = context.github
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

    const repoInfo = await toolGithub.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const owner = parsedOwner ?? detectedOwner ?? undefined
    const repo = effectiveRepo ?? repoInfo.repo ?? undefined

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

    let toolGithub: GitHubIntegration | undefined
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    let matchedRegistryKey: string | undefined
    if (!effectiveRepo && registry) {
        if (
            input.workspace_id !== undefined &&
            input.workspace_id !== 'default' &&
            input.workspace_id !== '*'
        ) {
            matchedRegistryKey =
                findCanonicalRegistryKey(input.workspace_id, registry) ??
                (Object.prototype.hasOwnProperty.call(registry, input.workspace_id)
                    ? input.workspace_id
                    : undefined)
        } else if (input.project_number !== undefined) {
            const matched = Object.entries(registry).find(
                ([, entry]) => entry.project_number === input.project_number
            )
            if (matched) matchedRegistryKey = matched[0]
        }
    }
    const registryKey = effectiveRepo
        ? (findCanonicalRegistryKey(effectiveRepo, registry) ??
          (registry && Object.prototype.hasOwnProperty.call(registry, effectiveRepo)
              ? effectiveRepo
              : undefined))
        : matchedRegistryKey
    const registryEntry = registryKey && registry ? registry[registryKey] : undefined

    let usedRegistryGithub = false
    if (registryEntry?.path) {
        const candidate = getGitHubIntegration(registryEntry.path, context.config?.runtime)
        if (candidate.isApiAvailable()) {
            toolGithub = candidate
            usedRegistryGithub = true
        } else if (context.github) {
            toolGithub = context.github
        } else {
            toolGithub = candidate
        }
    } else if (context.github) {
        toolGithub = context.github
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

    let repoInfo = await toolGithub.getRepoInfo()
    if (
        usedRegistryGithub &&
        repoInfo.owner === null &&
        repoInfo.repo === null &&
        context.github &&
        context.github !== toolGithub &&
        context.github.isApiAvailable()
    ) {
        toolGithub = context.github
        repoInfo = await toolGithub.getRepoInfo()
        usedRegistryGithub = false
    }

    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo

    const owner = parsedOwner ?? detectedOwner ?? undefined
    const repo =
        effectiveRepo ??
        (usedRegistryGithub
            ? (detectedRepo ?? matchedRegistryKey)
            : (matchedRegistryKey ?? detectedRepo)) ??
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
