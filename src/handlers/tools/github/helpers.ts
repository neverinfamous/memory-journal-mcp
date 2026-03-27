/**
 * GitHub Tool Helpers - Shared owner/repo resolution
 */

import type { ToolContext } from '../../../types/index.js'
import { GitHubIntegration } from '../../../github/github-integration/index.js'

/**
 * Resolve project number explicitly or via ProjectRegistry mapping
 */
export function resolveProjectNumber(
    context: ToolContext,
    repo: string | undefined,
    explicitProjectNumber?: number
): number | undefined {
    if (explicitProjectNumber !== undefined) return explicitProjectNumber
    if (repo && context.config?.projectRegistry?.[repo]?.project_number !== undefined) {
        return context.config.projectRegistry[repo].project_number
    }
    return context.config?.defaultProjectNumber
}

/**
 * Resolve owner (owner-only, no repo required)
 */
export async function resolveOwner(
    context: ToolContext,
    inputOwner?: string,
    entityLabel?: string
): Promise<
    | {
          owner: string
          detectedOwner: string | null
          repo: string | undefined
          github: GitHubIntegration
      }
    | { error: true; response: Record<string, unknown> }
> {
    if (!context.github) {
        return {
            error: true,
            response: {
                success: false,
                error: 'GitHub integration not available',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                suggestion:
                    'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables to enable GitHub integration.',
                recoverable: true,
            },
        }
    }

    const repoInfo = await context.github.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const owner = inputOwner ?? detectedOwner ?? undefined
    const repo = repoInfo.repo ?? undefined

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

    return { owner, detectedOwner, repo, github: context.github }
}

/**
 * Resolve owner + repo (both required)
 */
export async function resolveOwnerRepo(
    context: ToolContext,
    input: { owner?: string; repo?: string },
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
    if (!context.github) {
        return {
            error: true,
            response: {
                success: false,
                error: 'GitHub integration not available',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                suggestion:
                    'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables to enable GitHub integration.',
                recoverable: true,
            },
        }
    }

    let toolGithub: GitHubIntegration = context.github
    const registryEntry = input.repo && context.config?.projectRegistry
        ? context.config.projectRegistry[input.repo]
        : undefined

    if (registryEntry) {
        toolGithub = new GitHubIntegration(registryEntry.path)
    }

    const repoInfo = await toolGithub.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo
    
    // HYDRATE GLOBAL CACHE FOR SUBSEQUENT SYNCHRONOUS TOOLS (e.g. create_entry)
    // This ensures that when an agent switches contexts via get_github_context(repo),
    // the global cache is primed for the current repository.
    if (registryEntry && context.github) {
        context.github.setCachedRepoInfo(repoInfo)
    }

    const owner = input.owner ?? detectedOwner ?? undefined
    const repo = input.repo ?? detectedRepo ?? undefined

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
