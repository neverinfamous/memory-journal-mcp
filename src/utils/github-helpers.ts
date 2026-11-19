import { getGitHubIntegration } from '../github/github-integration/index.js'
import type { ToolContext } from '../types/index.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from './write-scope.js'

/** Resolve normalized GitHub hostname (stripping protocol, credentials, paths, queries, and trailing slashes). */
export function resolveGithubHost(rawEnv = process.env['GITHUB_HOST']): string {
    const raw = rawEnv?.trim()
    if (raw === undefined || raw === '') return 'github.com'
    if (raw.includes('://') && !/^https?:\/\//i.test(raw)) return 'github.com'
    try {
        const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        const parsed = new URL(candidate)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'github.com'
        return parsed.host !== '' ? parsed.host : 'github.com'
    } catch {
        return 'github.com'
    }
}

async function resolveIssueUrlFromRepoPath(
    repoPath: string | undefined,
    issueNumber: number,
    runtime?: ToolContext['config'] extends infer C
        ? C extends { runtime?: infer R }
            ? R
            : never
        : never
): Promise<string | undefined> {
    if (repoPath === undefined || repoPath.trim() === '') return undefined
    const targetGithub = getGitHubIntegration(
        repoPath,
        runtime,
        process.env['GITHUB_TOKEN']
    )
    const repoInfo = await targetGithub.getRepoInfo()
    const host = resolveGithubHost()
    if (repoInfo.owner && repoInfo.repo) {
        return `https://${host}/${repoInfo.owner}/${repoInfo.repo}/issues/${String(issueNumber)}`
    }
    return undefined
}

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
        return resolveIssueUrlFromRepoPath(entry?.path, issueNumber, context.config?.runtime)
    }

    const trimmedWs = workspaceId?.trim()
    if (trimmedWs !== undefined && trimmedWs !== '') {
        const lowerWs = trimmedWs.toLowerCase()
        if (lowerWs === 'default' || trimmedWs === '*') return undefined
        const matchedKey =
            registry !== undefined
                ? Object.keys(registry).find((k) => k.toLowerCase() === lowerWs)
                : undefined
        const entry = matchedKey !== undefined ? registry?.[matchedKey] : undefined
        return resolveIssueUrlFromRepoPath(entry?.path, issueNumber, context.config?.runtime)
    }

    // 2. Omitted project number and workspace may use the process repo cache.
    if (context.github) {
        const host = resolveGithubHost()
        const cachedRepo =
            context.github.getCachedRepoInfo() ?? (await context.github.getRepoInfo())
        if (cachedRepo?.owner && cachedRepo?.repo) {
            return `https://${host}/${cachedRepo.owner}/${cachedRepo.repo}/issues/${String(issueNumber)}`
        }
    }

    return undefined
}
