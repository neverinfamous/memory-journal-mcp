import { logger } from '../../utils/logger.js'
import type { GitHubClient } from './client.js'
import type { GitHubMilestone } from '../../types/index.js'

export class MilestonesManager {
    constructor(private client: GitHubClient) {}

    async getMilestones(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20,
        abortSignal?: AbortSignal
    ): Promise<GitHubMilestone[]> {
        if (!this.client.octokit) {
            throw new Error('GitHub API not available')
        }

        const cacheKey = `milestones:${owner}:${repo}:${state}:${String(limit)}`
        const cached = this.client.getCached(cacheKey) as GitHubMilestone[] | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.issues.listMilestones({
                owner,
                repo,
                state,
                per_page: limit,
                sort: 'due_on',
                direction: 'asc',
                request: { signal: abortSignal },
            })

            const result = response.data.map((ms) => ({
                number: ms.number,
                title: ms.title,
                description: ms.description ?? null,
                state: ms.state === 'open' ? ('open' as const) : ('closed' as const),
                url: ms.html_url,
                dueOn: ms.due_on ?? null,
                openIssues: ms.open_issues,
                closedIssues: ms.closed_issues,
                createdAt: ms.created_at,
                updatedAt: ms.updated_at,
                creator: ms.creator?.login ?? null,
            }))

            this.client.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get milestones', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    async getMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number
    ): Promise<GitHubMilestone | null> {
        if (!this.client.octokit) {
            throw new Error('GitHub API not available')
        }

        const cacheKey = `milestone:${owner}:${repo}:${String(milestoneNumber)}`
        const cached = this.client.getCached(cacheKey) as GitHubMilestone | null | undefined
        if (cached !== undefined) return cached

        try {
            const response = await this.client.octokit.issues.getMilestone({
                owner,
                repo,
                milestone_number: milestoneNumber,
            })

            const ms = response.data
            const milestone: GitHubMilestone = {
                number: ms.number,
                title: ms.title,
                description: ms.description ?? null,
                state: ms.state === 'open' ? 'open' : 'closed',
                url: ms.html_url,
                dueOn: ms.due_on ?? null,
                openIssues: ms.open_issues,
                closedIssues: ms.closed_issues,
                createdAt: ms.created_at,
                updatedAt: ms.updated_at,
                creator: ms.creator?.login ?? null,
            }

            this.client.setCache(cacheKey, milestone)
            return milestone
        } catch (error) {
            logger.error('Failed to get milestone', {
                module: 'GitHub',
                entityId: milestoneNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    async createMilestone(
        owner: string,
        repo: string,
        title: string,
        description?: string,
        dueOn?: string
    ): Promise<GitHubMilestone | null> {
        if (!this.client.octokit) {
            logger.error('Cannot create milestone: GitHub API not available', {
                module: 'GitHub',
            })
            throw new Error('GitHub API not available')
        }

        try {
            const response = await this.client.octokit.issues.createMilestone({
                owner,
                repo,
                title,
                description,
                due_on: dueOn,
            })

            const ms = response.data

            logger.info('Created GitHub milestone', {
                module: 'GitHub',
                entityId: ms.number,
                context: { title, owner, repo },
            })

            return {
                number: ms.number,
                title: ms.title,
                description: ms.description ?? null,
                state: ms.state === 'open' ? 'open' : 'closed',
                url: ms.html_url,
                dueOn: ms.due_on ?? null,
                openIssues: ms.open_issues,
                closedIssues: ms.closed_issues,
                createdAt: ms.created_at,
                updatedAt: ms.updated_at,
                creator: ms.creator?.login ?? null,
            }
        } catch (error) {
            logger.error('Failed to create milestone', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { title, owner, repo },
            })
            throw error
        } finally {
            this.client.invalidateCache(`milestones:${owner}:${repo}`)
            this.client.invalidateCache('context:')
        }
    }

    async updateMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number,
        updates: {
            title?: string
            description?: string
            dueOn?: string | null
            state?: 'open' | 'closed'
        }
    ): Promise<GitHubMilestone | null> {
        if (!this.client.octokit) {
            logger.error('Cannot update milestone: GitHub API not available', {
                module: 'GitHub',
            })
            throw new Error('GitHub API not available')
        }

        try {
            const response = await this.client.octokit.issues.updateMilestone({
                owner,
                repo,
                milestone_number: milestoneNumber,
                title: updates.title,
                description: updates.description,
                due_on: updates.dueOn === null ? undefined : updates.dueOn,
                state: updates.state,
            })

            const ms = response.data

            logger.info('Updated GitHub milestone', {
                module: 'GitHub',
                entityId: milestoneNumber,
                context: { owner, repo, updates: Object.keys(updates) },
            })

            return {
                number: ms.number,
                title: ms.title,
                description: ms.description ?? null,
                state: ms.state === 'open' ? 'open' : 'closed',
                url: ms.html_url,
                dueOn: ms.due_on ?? null,
                openIssues: ms.open_issues,
                closedIssues: ms.closed_issues,
                createdAt: ms.created_at,
                updatedAt: ms.updated_at,
                creator: ms.creator?.login ?? null,
            }
        } catch (error) {
            logger.error('Failed to update milestone', {
                module: 'GitHub',
                entityId: milestoneNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        } finally {
            this.client.invalidateCache(`milestones:${owner}:${repo}`)
            this.client.invalidateCache(`milestone:${owner}:${repo}:${String(milestoneNumber)}`)
            this.client.invalidateCache('context:')
        }
    }

    async deleteMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.client.octokit) {
            return { success: false, error: 'GitHub API not available' }
        }

        try {
            await this.client.octokit.issues.deleteMilestone({
                owner,
                repo,
                milestone_number: milestoneNumber,
            })

            logger.info('Deleted GitHub milestone', {
                module: 'GitHub',
                entityId: milestoneNumber,
                context: { owner, repo },
            })

            return { success: true }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to delete milestone', {
                module: 'GitHub',
                entityId: milestoneNumber,
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        } finally {
            this.client.invalidateCache(`milestones:${owner}:${repo}`)
            this.client.invalidateCache(`milestone:${owner}:${repo}:${String(milestoneNumber)}`)
            this.client.invalidateCache('context:')
        }
    }
}
