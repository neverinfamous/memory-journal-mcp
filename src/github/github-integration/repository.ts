import { logger } from '../../utils/logger.js'
import { sanitizeErrorMessageForResponse } from '../../utils/error-helpers.js'
import type { GitHubClient } from './client.js'
import type { RepoInfo, LocalGitStatus } from './types.js'
import type { GitHubWorkflowRun } from '../../types/index.js'

const RESOLVES_ISSUE_PATTERN = /(?:fix|fixes|resolve|resolves|close|closes)\s+#(\d+)/gi

/** Extract unique issue numbers referenced by "fixes #N"-style keywords in commit messages. */
function extractResolvedIssueNumbers(messages: string[]): number[] {
    const resolved: number[] = []
    for (const message of messages) {
        for (const match of message.matchAll(RESOLVES_ISSUE_PATTERN)) {
            const num = parseInt(match[1] ?? '', 10)
            if (!isNaN(num) && !resolved.includes(num)) {
                resolved.push(num)
            }
        }
    }
    return resolved
}

export class RepositoryManager {
    constructor(private client: GitHubClient) {}

    async getRepoInfo(): Promise<RepoInfo> {
        const cached = this.getCachedRepoInfo()
        if (cached) return cached

        try {
            const [branchSettled, remotesSettled] = await Promise.allSettled([
                this.client.git.branch(),
                this.client.git.getRemotes(true),
            ])
            if (branchSettled.status === 'rejected') throw branchSettled.reason
            if (remotesSettled.status === 'rejected') throw remotesSettled.reason
            const branchResult = branchSettled.value
            const remotes = remotesSettled.value
            const branch = branchResult.current || null
            const origin = remotes.find((r) => r.name === 'origin')
            const remoteUrl = origin?.refs?.fetch || null

            const { owner, repo } = this.parseRemoteUrl(remoteUrl)

            const repoInfo = { owner, repo, branch, remoteUrl }
            this.client.setCache('repoInfo', repoInfo)
            return repoInfo
        } catch (error) {
            logger.debug('Failed to get repo info (may not be a git repo)', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return { owner: null, repo: null, branch: null, remoteUrl: null }
        }
    }

    getCachedRepoInfo(): RepoInfo | null {
        return (this.client.getCached('repoInfo') as RepoInfo | undefined) ?? null
    }

    setCachedRepoInfo(info: RepoInfo): void {
        this.client.setCache('repoInfo', info)
    }

    private parseRemoteUrl(remoteUrl: string | null): {
        owner: string | null
        repo: string | null
    } {
        if (!remoteUrl) return { owner: null, repo: null }

        if (remoteUrl.startsWith('git@github.com:')) {
            const pathPart = remoteUrl.replace('git@github.com:', '').replace(/\.git$/i, '')
            const parts = pathPart.split('/')
            if (parts.length >= 2) {
                return { owner: parts[0] ?? null, repo: parts[1] ?? null }
            }
        }

        try {
            const url = new URL(remoteUrl)
            if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
                const path = url.pathname.replace(/\.git$/i, '').replace(/^\//, '')
                const parts = path.split('/')
                if (parts.length >= 2) {
                    return { owner: parts[0] ?? null, repo: parts[1] ?? null }
                }
            }
        } catch (parseError) {
            // Not a valid URL
            logger.debug('Remote URL is not a parseable URL', {
                module: 'GitHub',
                error: parseError instanceof Error ? parseError.message : String(parseError),
            })
        }

        return { owner: null, repo: null }
    }

    async getWorkflowRuns(
        owner: string,
        repo: string,
        limit = 10,
        abortSignal?: AbortSignal
    ): Promise<GitHubWorkflowRun[]> {
        if (!this.client.octokit) {
            logger.debug('GitHub API not available - no token', { module: 'GitHub' })
            throw new Error('GitHub API not available')
        }

        const cacheKey = `workflows:${owner}:${repo}:${String(limit)}`
        const cached = this.client.getCached(cacheKey) as GitHubWorkflowRun[] | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.rest.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                per_page: limit,
                request: { signal: abortSignal },
            })

            const result = response.data.workflow_runs.map((run) => ({
                id: run.id,
                name: run.name ?? 'Unknown Workflow',
                status: run.status as 'queued' | 'in_progress' | 'completed',
                conclusion: run.conclusion as
                    | 'success'
                    | 'failure'
                    | 'cancelled'
                    | 'skipped'
                    | null,
                url: run.html_url,
                headBranch: run.head_branch ?? '',
                headSha: run.head_sha,
                createdAt: run.created_at,
                updatedAt: run.updated_at,
            }))

            this.client.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get workflow runs', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    async getLocalGitStatus(options?: { includeResolvedIssues?: boolean }): Promise<LocalGitStatus> {
        try {
            const includeResolved = options?.includeResolvedIssues ?? true
            const [statusSettled, logSettled] = await Promise.allSettled([
                this.client.git.status(),
                includeResolved ? this.client.git.log({ maxCount: 50 }) : Promise.resolve(null),
            ])
            if (statusSettled.status === 'rejected') {
                throw statusSettled.reason
            }
            const status = statusSettled.value
            const resolvedIssues: number[] = []

            if (logSettled.status === 'fulfilled') {
                if (logSettled.value !== null) {
                    resolvedIssues.push(...extractResolvedIssueNumbers(logSettled.value.all.map((c) => c.message)))
                }
            } else {
                logger.debug('Failed to parse git log for resolved issues', {
                    module: 'GitHub',
                    error: logSettled.reason instanceof Error ? logSettled.reason.message : String(logSettled.reason),
                })
            }

            const trackedChanges = new Set<string>([
                ...status.modified,
                ...status.created,
                ...status.deleted,
                ...status.staged,
                ...status.conflicted,
                ...status.renamed.map((r) => r.to),
            ])
            return {
                branch: status.current || null,
                modified: trackedChanges.size,
                untracked: status.not_added.length,
                isClean: status.isClean(),
                resolvedIssues,
            }
        } catch (error) {
            logger.debug('Failed to get local git status', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return {
                modified: 0,
                untracked: 0,
                isClean: false,
                error: sanitizeErrorMessageForResponse(
                    error instanceof Error ? error.message : String(error)
                ),
            }
        }
    }
}
