import { getGitHubIntegration } from '../github/github-integration/index.js'
import type { ToolContext } from '../types/index.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from './write-scope.js'

/**
 * Resolve a GitHub issue URL dynamically based on project context.
 *
 * If `existingUrl` is already provided, returns it unchanged.
 * If `issueNumber` is provided, looks up the corresponding repository via
 * project registry mappings or falls back to the globally cached repo info
 * when the call does not target `'default'`, `'*'`, or a different workspace path.
 *
 * @returns The resolved issue URL, or undefined if not resolvable
 */
export async function resolveIssueUrl(
    context: ToolContext,
    projectNumber: number | undefined,
    issueNumber: number | undefined,
    existingUrl: string | undefined,
    workspaceId?: string
): Promise<string | undefined> {
    if (existingUrl) return existingUrl
    if (issueNumber === undefined) return undefined

    const registry = activeProjectRegistry(context.config?.projectRegistry)

    // 1. Dynamic Project Registry Resolution. A supplied number that is missing
    // or shared by more than one workspace does not borrow another repository.
    if (projectNumber !== undefined) {
        const resolvedWs = uniqueWorkspaceForProject(projectNumber, registry)
        const entry = resolvedWs !== undefined ? registry?.[resolvedWs] : undefined
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

    const trimmedWs = workspaceId?.trim()
    if (trimmedWs !== undefined && trimmedWs !== '') {
        const lowerWs = trimmedWs.toLowerCase()
        if (lowerWs === 'default' || trimmedWs === '*') return undefined
        const matchedKey = registry !== undefined
            ? Object.keys(registry).find((k) => k.toLowerCase() === lowerWs)
            : undefined
        const entry = matchedKey !== undefined ? registry?.[matchedKey] : undefined
        if (entry?.path !== undefined && entry.path !== '') {
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
        return undefined
    }

    // 2. Omitted project number and workspace may use the process repo cache.
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
