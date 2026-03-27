import type { ToolContext } from '../types/index.js'

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
    if (issueNumber === undefined || !context.github) return undefined

    // 1. Dynamic Project Registry Resolution
    if (projectNumber !== undefined && context.config?.projectRegistry) {
        const entry = Object.entries(context.config.projectRegistry).find(
            ([_, v]) => v.project_number === projectNumber
        )
        if (entry) {
            // Re-import locally to avoid circular dependencies if needed, but we already have the type
            // Actually, we need the constructor. 
            // We can dynamically resolve the repo info if we instantiate a new GitHubIntegration for that path
            // But to avoid circular deps or importing the class, we can just return what we expect if we know owner/repo
            // Wait, we need to know the owner/repo for that project path!
            const { GitHubIntegration } = await import('../github/github-integration/index.js')
            const targetGithub = new GitHubIntegration(entry[1].path)
            const repoInfo = await targetGithub.getRepoInfo()
            if (repoInfo.owner && repoInfo.repo) {
                return `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${String(issueNumber)}`
            }
        }
    }

    // 2. Fallback to globally cached repo info
    const cachedRepo = context.github.getCachedRepoInfo()
    if (cachedRepo?.owner && cachedRepo?.repo) {
        return `https://github.com/${cachedRepo.owner}/${cachedRepo.repo}/issues/${String(issueNumber)}`
    }

    return undefined
}
