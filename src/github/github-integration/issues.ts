import { logger } from '../../utils/logger.js'
import type { GitHubClient } from './client.js'
import type { GitHubIssue } from '../../types/index.js'
import type { IssueDetails } from './types.js'

export class IssuesManager {
    constructor(private client: GitHubClient) {}

    async getIssues(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubIssue[]> {
        if (!this.client.octokit) {
            return []
        }

        const cacheKey = `issues:${owner}:${repo}:${state}:${String(limit)}`
        const cached = this.client.getCached(cacheKey) as GitHubIssue[] | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.issues.listForRepo({
                owner,
                repo,
                state,
                per_page: Math.min(limit * 2, 100),
                sort: 'updated',
                direction: 'desc',
            })

            const result = response.data
                .filter((issue) => !issue.pull_request)
                .slice(0, limit)
                .map((issue) => ({
                    number: issue.number,
                    title: issue.title,
                    url: issue.html_url,
                    state: issue.state === 'open' ? ('OPEN' as const) : ('CLOSED' as const),
                    milestone: issue.milestone
                        ? {
                              number: issue.milestone.number,
                              title: issue.milestone.title,
                          }
                        : null,
                }))

            this.client.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get issues', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    async getIssue(owner: string, repo: string, issueNumber: number): Promise<IssueDetails | null> {
        if (!this.client.octokit) {
            return null
        }

        const cacheKey = `issue:${owner}:${repo}:${String(issueNumber)}`
        const cached = this.client.getCached(cacheKey) as IssueDetails | null | undefined
        if (cached !== undefined) return cached

        try {
            const response = await this.client.octokit.issues.get({
                owner,
                repo,
                issue_number: issueNumber,
            })

            const issue = response.data

            if (issue.pull_request) {
                return null
            }

            const details: IssueDetails = {
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
                state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
                nodeId: issue.node_id,
                body: issue.body ?? null,
                labels: issue.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
                assignees: issue.assignees?.map((a) => a.login) ?? [],
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
                closedAt: issue.closed_at,
                commentsCount: issue.comments,
                milestone: issue.milestone
                    ? { number: issue.milestone.number, title: issue.milestone.title }
                    : null,
            }

            this.client.setCache(cacheKey, details)
            return details
        } catch (error) {
            logger.error('Failed to get issue details', {
                module: 'GitHub',
                entityId: issueNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return null
        }
    }

    async getIssueComments(
        owner: string,
        repo: string,
        issueNumber: number,
        limit = 30
    ): Promise<{ author: string; body: string; createdAt: string }[]> {
        const _limit = Math.min(limit, 100)
        if (!this.client.octokit) {
            return []
        }

        const cacheKey = `issue-comments:${owner}:${repo}:${String(issueNumber)}:${String(_limit)}`
        const cached = this.client.getCached(cacheKey) as
            | { author: string; body: string; createdAt: string }[]
            | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.issues.listComments({
                owner,
                repo,
                issue_number: issueNumber,
                per_page: _limit,
                sort: 'created',
                direction: 'asc',
            })

            const comments = response.data.slice(0, _limit).map((comment) => ({
                author: comment.user?.login ?? 'unknown',
                body: comment.body ?? '',
                createdAt: comment.created_at,
            }))

            this.client.setCache(cacheKey, comments)
            return comments
        } catch (error) {
            logger.error('Failed to get issue comments', {
                module: 'GitHub',
                entityId: issueNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    async createIssue(
        owner: string,
        repo: string,
        title: string,
        body?: string,
        labels?: string[],
        assignees?: string[],
        milestone?: number
    ): Promise<{ number: number; url: string; title: string; nodeId: string } | null> {
        if (!this.client.octokit) {
            logger.error('Cannot create issue: GitHub API not available', { module: 'GitHub' })
            return null
        }

        try {
            const response = await this.client.octokit.issues.create({
                owner,
                repo,
                title,
                body,
                labels,
                assignees,
                milestone,
            })

            logger.info('Created GitHub issue', {
                module: 'GitHub',
                entityId: response.data.number,
                context: { title, owner, repo },
            })

            return {
                number: response.data.number,
                url: response.data.html_url,
                title: response.data.title,
                nodeId: response.data.node_id,
            }
        } catch (error) {
            logger.error('Failed to create issue', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { title, owner, repo },
            })
            return null
        } finally {
            this.client.invalidateCache(`issues:${owner}:${repo}`)
            this.client.invalidateCache('context:')
        }
    }

    async closeIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        comment?: string
    ): Promise<{ success: boolean; url: string } | null> {
        if (!this.client.octokit) {
            logger.error('Cannot close issue: GitHub API not available', { module: 'GitHub' })
            return null
        }

        try {
            if (comment) {
                await this.client.octokit.issues.createComment({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    body: comment,
                })
            }

            const response = await this.client.octokit.issues.update({
                owner,
                repo,
                issue_number: issueNumber,
                state: 'closed',
            })

            logger.info('Closed GitHub issue', {
                module: 'GitHub',
                entityId: issueNumber,
                context: { owner, repo, hadComment: !!comment },
            })

            return {
                success: true,
                url: response.data.html_url,
            }
        } catch (error) {
            logger.error('Failed to close issue', {
                module: 'GitHub',
                entityId: issueNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return null
        } finally {
            this.client.invalidateCache(`issues:${owner}:${repo}`)
            this.client.invalidateCache(`issue:${owner}:${repo}:${String(issueNumber)}`)
            this.client.invalidateCache('context:')
        }
    }
}
