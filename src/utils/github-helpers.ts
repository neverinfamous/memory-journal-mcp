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
    if (issueNumber === undefined) return undefined

    // 1. Dynamic Project Registry Resolution
    if (projectNumber !== undefined && context.config?.projectRegistry) {
        const entry = Object.entries(context.config.projectRegistry).find(
            ([_, v]) => v.project_number === projectNumber
        )
        if (entry) {
            // Dynamically import and instantiate GitHubIntegration for the resolved path
            // to extract the correct owner/repo directly from the target filesystem
            const { getGitHubIntegration } = await import('../github/github-integration/index.js')
            const targetGithub = getGitHubIntegration(
                entry[1].path,
                undefined,
                process.env['GITHUB_TOKEN']
            )
            const repoInfo = await targetGithub.getRepoInfo()
            const host = process.env['GITHUB_HOST'] ?? 'github.com'
            if (repoInfo.owner && repoInfo.repo) {
                return `https://${host}/${repoInfo.owner}/${repoInfo.repo}/issues/${String(issueNumber)}`
            }
        }
    }

    // 2. Fallback to globally repo info if available
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
