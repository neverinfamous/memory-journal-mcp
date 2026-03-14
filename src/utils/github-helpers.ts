/**
 * GitHub URL Helpers
 *
 * Shared utilities for resolving GitHub URLs from cached repo info.
 * Eliminates duplication between core and team tool handlers.
 */

import type { GitHubIntegration } from '../github/github-integration/index.js'

/**
 * Resolve a GitHub issue URL from the cached repo info.
 *
 * If `existingUrl` is already provided, returns it unchanged.
 * If `issueNumber` is provided without a URL and GitHub is available
 * with cached repo info, constructs the URL automatically.
 *
 * @returns The resolved issue URL, or undefined if not resolvable
 */
export function resolveIssueUrl(
    github: GitHubIntegration | undefined,
    issueNumber: number | undefined,
    existingUrl: string | undefined
): string | undefined {
    if (existingUrl) return existingUrl
    if (issueNumber === undefined || !github) return undefined

    const cachedRepo = github.getCachedRepoInfo()
    if (cachedRepo?.owner && cachedRepo?.repo) {
        return `https://github.com/${cachedRepo.owner}/${cachedRepo.repo}/issues/${String(issueNumber)}`
    }

    return undefined
}
