import { logger } from '../../utils/logger.js'
import type { GitHubClient } from './client.js'
import type { RepoInfo } from './types.js'
import type { GitHubWorkflowRun } from '../../types/index.js'

export class RepositoryManager {
    constructor(private client: GitHubClient) {}

    async getRepoInfo(): Promise<RepoInfo> {
        const cached = this.getCachedRepoInfo()
        if (cached) return cached

        try {
            const branchResult = await this.client.git.branch()
            const branch = branchResult.current || null

            const remotes = await this.client.git.getRemotes(true)
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
            const pathPart = remoteUrl.replace('git@github.com:', '').replace('.git', '')
            const parts = pathPart.split('/')
            if (parts.length >= 2) {
                return { owner: parts[0] ?? null, repo: parts[1] ?? null }
            }
        }

        try {
            const url = new URL(remoteUrl)
            if (url.hostname === 'github.com') {
                const path = url.pathname.replace('.git', '').replace(/^\//, '')
                const parts = path.split('/')
                if (parts.length >= 2) {
                    return { owner: parts[0] ?? null, repo: parts[1] ?? null }
                }
            }
        } catch {
            // Not a valid URL
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
}
