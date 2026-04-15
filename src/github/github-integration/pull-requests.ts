import { logger } from '../../utils/logger.js'
import type { GitHubClient } from './client.js'
import type {
    GitHubPullRequest,
    GitHubReview,
    GitHubReviewComment,
    CopilotReviewSummary,
} from '../../types/index.js'
import type { PullRequestDetails } from './types.js'

export class PullRequestsManager {
    /** Known Copilot bot login patterns */
    private static readonly COPILOT_BOT_PATTERNS = [
        'copilot-pull-request-reviewer[bot]',
        'github-copilot[bot]',
        'copilot[bot]',
    ]

    constructor(private client: GitHubClient) {}

    async getPullRequests(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubPullRequest[]> {
        if (!this.client.octokit) {
            throw new Error('GitHub API not available')
        }

        const cacheKey = `prs:${owner}:${repo}:${state}:${String(limit)}`
        const cached = this.client.getCached(cacheKey) as GitHubPullRequest[] | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.pulls.list({
                owner,
                repo,
                state,
                per_page: limit,
                sort: 'updated',
                direction: 'desc',
            })

            const result = response.data.map((pr) => ({
                number: pr.number,
                title: pr.title,
                url: pr.html_url,
                state: pr.merged_at
                    ? ('MERGED' as const)
                    : pr.state === 'open'
                      ? ('OPEN' as const)
                      : ('CLOSED' as const),
            }))

            this.client.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get pull requests', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    async getPullRequest(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<PullRequestDetails | null> {
        if (!this.client.octokit) {
            throw new Error('GitHub API not available')
        }

        const cacheKey = `pr:${owner}:${repo}:${String(prNumber)}`
        const cached = this.client.getCached(cacheKey) as PullRequestDetails | null | undefined
        if (cached !== undefined) return cached

        try {
            const response = await this.client.octokit.pulls.get({
                owner,
                repo,
                pull_number: prNumber,
            })

            const pr = response.data

            const details: PullRequestDetails = {
                number: pr.number,
                title: pr.title,
                url: pr.html_url,
                state: pr.merged_at ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED',
                body: pr.body,
                draft: pr.draft ?? false,
                headBranch: pr.head.ref,
                baseBranch: pr.base.ref,
                author: pr.user?.login ?? 'unknown',
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
                mergedAt: pr.merged_at,
                closedAt: pr.closed_at,
                additions: pr.additions,
                deletions: pr.deletions,
                changedFiles: pr.changed_files,
            }

            this.client.setCache(cacheKey, details)
            return details
        } catch (error) {
            logger.error('Failed to get PR details', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    private static isCopilotAuthor(login: string): boolean {
        const lower = login.toLowerCase()
        return PullRequestsManager.COPILOT_BOT_PATTERNS.some(
            (p) => lower === p || lower.includes('copilot')
        )
    }

    async getReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]> {
        if (!this.client.octokit) throw new Error('GitHub API not available')

        const cacheKey = `reviews:${owner}:${repo}:${String(prNumber)}`
        const cached = this.client.getCached(cacheKey) as GitHubReview[] | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.rest.pulls.listReviews({
                owner,
                repo,
                pull_number: prNumber,
                per_page: 100,
            })

            const reviews: GitHubReview[] = response.data.map((r) => ({
                id: r.id,
                author: r.user?.login ?? 'unknown',
                state: r.state as GitHubReview['state'],
                body: r.body ?? null,
                submittedAt: r.submitted_at ?? r.commit_id ?? new Date().toISOString(),
                isCopilot: PullRequestsManager.isCopilotAuthor(r.user?.login ?? ''),
            }))

            this.client.setCache(cacheKey, reviews)
            return reviews
        } catch (error) {
            logger.error('Failed to get PR reviews', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    async getReviewComments(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<GitHubReviewComment[]> {
        if (!this.client.octokit) throw new Error('GitHub API not available')

        const cacheKey = `review-comments:${owner}:${repo}:${String(prNumber)}`
        const cached = this.client.getCached(cacheKey) as GitHubReviewComment[] | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.rest.pulls.listReviewComments({
                owner,
                repo,
                pull_number: prNumber,
                per_page: 100,
            })

            const comments: GitHubReviewComment[] = response.data.map((c) => ({
                id: c.id,
                author: c.user?.login ?? 'unknown',
                body: c.body,
                path: c.path,
                line: c.line ?? c.original_line ?? null,
                side: c.side ?? 'RIGHT',
                createdAt: c.created_at,
                isCopilot: PullRequestsManager.isCopilotAuthor(c.user?.login ?? ''),
            }))

            this.client.setCache(cacheKey, comments)
            return comments
        } catch (error) {
            logger.error('Failed to get review comments', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    async getCopilotReviewSummary(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<CopilotReviewSummary> {
        const [reviews, comments] = await Promise.all([
            this.getReviews(owner, repo, prNumber),
            this.getReviewComments(owner, repo, prNumber),
        ])

        const copilotReviews = reviews.filter((r) => r.isCopilot)
        const copilotComments = comments.filter((c) => c.isCopilot)

        let state: CopilotReviewSummary['state'] = 'none'
        if (copilotReviews.length > 0) {
            const latest = copilotReviews[copilotReviews.length - 1]
            if (latest !== undefined) {
                if (latest.state === 'APPROVED') state = 'approved'
                else if (latest.state === 'CHANGES_REQUESTED') state = 'changes_requested'
                else if (latest.state === 'COMMENTED') state = 'commented'
            }
        }

        return {
            prNumber,
            state,
            commentCount: copilotComments.length,
            comments: copilotComments,
        }
    }
}
