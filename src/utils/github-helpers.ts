import { getGitHubIntegration } from '../github/github-integration/index.js'
import type { ToolContext } from '../types/index.js'
import { uniqueWorkspaceForProject } from './write-scope.js'

/**
 * Resolve a GitHub issue URL dynamically based on project context.
 *
 * If `existingUrl` is already provided, returns it unchanged.
 * If `issueNumber` is provided, looks up the corresponding repository via
 * project registry mappings or falls back to the globally cached repo info.
 *
 * @returns The resolved issue URL, or undefined if not resolvable
 */
export async function resolveIssueUrl(
    context: ToolContext,
    projectNumber: number | undefined,
    issueNumber: number | undefined,
    existingUrl: string | undefined
): Promise<string | undefined> {
    if (existingUrl) return existingUrl
    if (issueNumber === undefined) return undefined

    // 1. Dynamic Project Registry Resolution. A supplied number that is missing
    // or shared by more than one workspace does not borrow another repository.
    if (projectNumber !== undefined) {
        const registry = context.config?.projectRegistry
        const workspaceId = uniqueWorkspaceForProject(projectNumber, registry)
        const entry = workspaceId !== undefined ? registry?.[workspaceId] : undefined
        if (entry?.path === undefined) return undefined
        const targetGithub = getGitHubIntegration(
            entry.path,
            undefined,
            process.env['GITHUB_TOKEN']
        )
        const repoInfo = await targetGithub.getRepoInfo()
        const host = process.env['GITHUB_HOST'] ?? 'github.com'
        if (repoInfo.owner && repoInfo.repo) {
            return `https://${host}/${repoInfo.owner}/${repoInfo.repo}/issues/${String(issueNumber)}`
        }
        return undefined
    }

    // 2. Omitted project number may use the process repo cache.
    if (context.github) {
        const host = process.env['GITHUB_HOST'] ?? 'github.com'
        const cachedRepo =
            context.github.getCachedRepoInfo() ?? (await context.github.getRepoInfo())
        if (cachedRepo?.owner && cachedRepo?.repo) {
            return `https://${host}/${cachedRepo.owner}/${cachedRepo.repo}/issues/${String(issueNumber)}`
        }
    }

    return undefined
}
