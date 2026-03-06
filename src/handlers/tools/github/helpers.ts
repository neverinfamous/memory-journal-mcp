/**
 * GitHub Tool Helpers - Shared owner/repo resolution
 */

import type { ToolContext } from '../../../types/index.js'
import type { GitHubIntegration } from '../../../github/GitHubIntegration.js'

/**
 * Resolve owner (owner-only, no repo required)
 */
export async function resolveOwner(
    context: ToolContext,
    inputOwner?: string
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
        return { error: true, response: { error: 'GitHub integration not available' } }
    }

    const repoInfo = await context.github.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const owner = inputOwner ?? detectedOwner ?? undefined
    const repo = repoInfo.repo ?? undefined

    if (!owner) {
        return {
            error: true,
            response: {
                error: 'STOP: Could not auto-detect repository owner. DO NOT GUESS. You MUST ask the user to provide the GitHub owner.',
                requiresUserInput: true,
                detectedOwner,
                instruction:
                    'Ask the user: "What GitHub username or organization owns this project?"',
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
    input: { owner?: string; repo?: string }
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
        return { error: true, response: { error: 'GitHub integration not available' } }
    }

    const repoInfo = await context.github.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo
    const owner = input.owner ?? detectedOwner ?? undefined
    const repo = input.repo ?? detectedRepo ?? undefined

    if (!owner || !repo) {
        return {
            error: true,
            response: {
                error: 'STOP: Could not auto-detect repository. DO NOT GUESS.',
                requiresUserInput: true,
                detected: { owner, repo },
            },
        }
    }

    return { owner, repo, detectedOwner, detectedRepo, github: context.github }
}
