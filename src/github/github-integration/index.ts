import type { RepoInfo, IssueDetails, PullRequestDetails, LocalGitStatus, RateLimitSnapshot, GitHubRateLimitResponse } from './types.js'
import { GitHubClient } from './client.js'
import { IssuesManager } from './issues.js'
import { PullRequestsManager } from './pull-requests.js'
import { ProjectsManager } from './projects.js'
import { MilestonesManager } from './milestones.js'
import { InsightsManager } from './insights.js'
import { RepositoryManager } from './repository.js'
import type {
    GitHubIssue,
    GitHubMilestone,
    GitHubPullRequest,
    GitHubReview,
    GitHubReviewComment,
    GitHubWorkflowRun,
    CopilotReviewSummary,
    ProjectContext,
    KanbanBoard,
    RepoStats,
    TrafficData,
    TrafficReferrer,
    PopularPath,
} from '../../types/index.js'

export type { RepoInfo, IssueDetails, PullRequestDetails }

// Removed global cache pool

/**
 * Factory method for creating a GitHubIntegration instance.
 * Pools instances by working directory on the ServerRuntime to prevent state bleed
 * and cross-project coupling, as identified in the Copilot Security Audit.
 */
import { createHash } from 'node:crypto'
import * as path from 'node:path'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import { logger } from '../../utils/logger.js'

export function getGitHubIntegration(
    workingDir = '.',
    runtime?: ServerRuntime,
    token?: string
): GitHubIntegration {
    const resolvedDir = path.resolve(workingDir === '.' ? process.cwd() : workingDir)
    const normalizedDir = process.platform === 'win32' ? resolvedDir.toLowerCase() : resolvedDir

    // Support instance-scoped runtime pools for multi-tenant isolation
    if (runtime) {
        runtime.githubClientPool ??= new Map<string, GitHubIntegration>()
        const cacheKey = token
            ? `${normalizedDir}:${createHash('sha256').update(token).digest('hex').substring(0, 12)}`
            : normalizedDir
        let instance = runtime.githubClientPool.get(cacheKey)
        if (!instance) {
            instance = new GitHubIntegration(resolvedDir, token)
            runtime.githubClientPool.set(cacheKey, instance)
        }
        return instance
    }

    // Fallback to non-pooled transient instances if no runtime is provided
    return new GitHubIntegration(resolvedDir, token)
}

/**
 * GitHubIntegration - Handles GitHub API and local git operations
 * Uses composition over sub-modules to maintain the exact same API surface.
 */
export class GitHubIntegration {
    private client: GitHubClient
    private issuesManager: IssuesManager
    private pullRequestsManager: PullRequestsManager
    private projectsManager: ProjectsManager
    private milestonesManager: MilestonesManager
    private insightsManager: InsightsManager
    private repositoryManager: RepositoryManager

    constructor(workingDir = '.', token?: string) {
        this.client = new GitHubClient(workingDir, token)
        this.issuesManager = new IssuesManager(this.client)
        this.pullRequestsManager = new PullRequestsManager(this.client)
        this.projectsManager = new ProjectsManager(this.client)
        this.milestonesManager = new MilestonesManager(this.client)
        this.insightsManager = new InsightsManager(this.client)
        this.repositoryManager = new RepositoryManager(this.client)
    }

    isApiAvailable(): boolean {
        return this.client.isApiAvailable()
    }

    getLatestRateLimit(): RateLimitSnapshot | null {
        return this.client.latestRateLimit
    }

    async getRateLimit(): Promise<GitHubRateLimitResponse> {
        const cached = this.client.getCachedWithTtl('rate-limit', 30_000)
        if (cached !== undefined) return cached as GitHubRateLimitResponse

        if (!this.client.octokit) throw new Error('GitHub API not available')
        const { data } = await this.client.octokit.rateLimit.get()
        this.client.setCache('rate-limit', data)
        return data as GitHubRateLimitResponse
    }

    clearCache(): void {
        this.client.clearCache()
    }

    async getRepoInfo(): Promise<RepoInfo> {
        return this.repositoryManager.getRepoInfo()
    }

    getCachedRepoInfo(): RepoInfo | null {
        return this.repositoryManager.getCachedRepoInfo()
    }

    setCachedRepoInfo(info: RepoInfo): void {
        this.repositoryManager.setCachedRepoInfo(info)
    }

    async getLocalGitStatus(): Promise<LocalGitStatus> {
        return this.repositoryManager.getLocalGitStatus()
    }

    async getIssues(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20,
        abortSignal?: AbortSignal
    ): Promise<GitHubIssue[]> {
        return this.issuesManager.getIssues(owner, repo, state, limit, abortSignal)
    }

    async getIssue(owner: string, repo: string, issueNumber: number): Promise<IssueDetails | null> {
        return this.issuesManager.getIssue(owner, repo, issueNumber)
    }

    async getIssueComments(
        owner: string,
        repo: string,
        issueNumber: number,
        limit = 30
    ): Promise<{ author: string; body: string; createdAt: string }[]> {
        return this.issuesManager.getIssueComments(owner, repo, issueNumber, limit)
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
        return this.issuesManager.createIssue(
            owner,
            repo,
            title,
            body,
            labels,
            assignees,
            milestone
        )
    }

    async closeIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        comment?: string
    ): Promise<{ success: boolean; url: string } | null> {
        return this.issuesManager.closeIssue(owner, repo, issueNumber, comment)
    }

    async getPullRequests(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20,
        abortSignal?: AbortSignal
    ): Promise<GitHubPullRequest[]> {
        return this.pullRequestsManager.getPullRequests(owner, repo, state, limit, abortSignal)
    }

    async getPullRequest(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<PullRequestDetails | null> {
        return this.pullRequestsManager.getPullRequest(owner, repo, prNumber)
    }

    async getReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]> {
        return this.pullRequestsManager.getReviews(owner, repo, prNumber)
    }

    async getReviewComments(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<GitHubReviewComment[]> {
        return this.pullRequestsManager.getReviewComments(owner, repo, prNumber)
    }

    async getCopilotReviewSummary(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<CopilotReviewSummary> {
        return this.pullRequestsManager.getCopilotReviewSummary(owner, repo, prNumber)
    }

    async getWorkflowRuns(
        owner: string,
        repo: string,
        limit = 10,
        abortSignal?: AbortSignal
    ): Promise<GitHubWorkflowRun[]> {
        return this.repositoryManager.getWorkflowRuns(owner, repo, limit, abortSignal)
    }

    async getRepoContext(
        abortSignal?: AbortSignal,
        target?: { owner: string; repo: string }
    ): Promise<ProjectContext> {
        const detected = await this.repositoryManager.getRepoInfo()
        const isSameRepoTarget =
            target === undefined ||
            ((detected.owner?.toLowerCase() ?? '') === target.owner.toLowerCase() &&
                (detected.repo?.toLowerCase() ?? '') === target.repo.toLowerCase())
        // [INVARIANT] H24: When an explicit target differs from CWD's detected repo, never leak
        // CWD branch, remoteUrl, or HEAD commit onto the target repo context.
        const repoInfo =
            target !== undefined
                ? isSameRepoTarget
                    ? { ...detected, owner: target.owner, repo: target.repo }
                    : {
                          owner: target.owner,
                          repo: target.repo,
                          branch: null,
                          remoteUrl: `https://github.com/${target.owner}/${target.repo}`,
                      }
                : detected
        const cacheKey =
            target !== undefined ? `context:repo:${target.owner}/${target.repo}` : 'context:repo'
        const cached = this.client.getCached(cacheKey) as ProjectContext | undefined
        if (cached) return cached

        const context: ProjectContext = {
            repoName: repoInfo.repo,
            branch: repoInfo.branch,
            commit: null,
            remoteUrl: repoInfo.remoteUrl,
            projects: [],
            issues: [],
            pullRequests: [],
            workflowRuns: [],
            milestones: [],
        }

        const degraded: string[] = []
        if (isSameRepoTarget) {
            try {
                const log = await this.client.git.log({ maxCount: 1 })
                context.commit = log.latest?.hash ?? null
            } catch (err) {
                logger.debug(
                    `git log failed: ${err instanceof Error ? err.message : String(err)}`,
                    { module: 'GitHubIntegration' }
                )
                degraded.push('commit')
            }
        }
        if (repoInfo.owner && repoInfo.repo) {
            const [issuesResult, prsResult, runsResult, milestonesResult] =
                await Promise.allSettled([
                    this.issuesManager.getIssues(
                        repoInfo.owner,
                        repoInfo.repo,
                        'open',
                        10,
                        abortSignal
                    ),
                    this.pullRequestsManager.getPullRequests(
                        repoInfo.owner,
                        repoInfo.repo,
                        'open',
                        10,
                        abortSignal
                    ),
                    this.repositoryManager.getWorkflowRuns(
                        repoInfo.owner,
                        repoInfo.repo,
                        10,
                        abortSignal
                    ),
                    this.milestonesManager.getMilestones(
                        repoInfo.owner,
                        repoInfo.repo,
                        'open',
                        10,
                        abortSignal
                    ),
                ])

            context.issues = issuesResult.status === 'fulfilled' ? issuesResult.value : []
            if (issuesResult.status === 'rejected') degraded.push('issues')

            context.pullRequests = prsResult.status === 'fulfilled' ? prsResult.value : []
            if (prsResult.status === 'rejected') degraded.push('pullRequests')

            context.workflowRuns = runsResult.status === 'fulfilled' ? runsResult.value : []
            if (runsResult.status === 'rejected') degraded.push('workflowRuns')

            context.milestones =
                milestonesResult.status === 'fulfilled' ? milestonesResult.value : []
            if (milestonesResult.status === 'rejected') degraded.push('milestones')
        }

        if (degraded.length > 0) {
            context.degraded = degraded
        } else {
            this.client.setCache(cacheKey, context)
        }

        return context
    }

    async getProjectKanban(
        owner: string,
        projectNumber: number,
        repo?: string,
        abortSignal?: AbortSignal
    ): Promise<KanbanBoard | null> {
        return this.projectsManager.getProjectKanban(owner, projectNumber, repo, abortSignal)
    }

    async moveProjectItem(
        projectId: string,
        itemId: string,
        statusFieldId: string,
        statusOptionId: string
    ): Promise<{ success: boolean; error?: string }> {
        return this.projectsManager.moveProjectItem(
            projectId,
            itemId,
            statusFieldId,
            statusOptionId
        )
    }

    async addProjectItem(
        projectId: string,
        contentId: string
    ): Promise<{ success: boolean; itemId?: string; error?: string }> {
        return this.projectsManager.addProjectItem(projectId, contentId)
    }

    async deleteProjectItem(
        projectId: string,
        itemId: string
    ): Promise<{ success: boolean; error?: string }> {
        return this.projectsManager.deleteProjectItem(projectId, itemId)
    }

    async getMilestones(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20,
        abortSignal?: AbortSignal
    ): Promise<GitHubMilestone[]> {
        return this.milestonesManager.getMilestones(owner, repo, state, limit, abortSignal)
    }

    async getMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number
    ): Promise<GitHubMilestone | null> {
        return this.milestonesManager.getMilestone(owner, repo, milestoneNumber)
    }

    async createMilestone(
        owner: string,
        repo: string,
        title: string,
        description?: string,
        dueOn?: string
    ): Promise<GitHubMilestone | null> {
        return this.milestonesManager.createMilestone(owner, repo, title, description, dueOn)
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
        return this.milestonesManager.updateMilestone(owner, repo, milestoneNumber, updates)
    }

    async deleteMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number
    ): Promise<{ success: boolean; error?: string }> {
        return this.milestonesManager.deleteMilestone(owner, repo, milestoneNumber)
    }

    async getRepoStats(owner: string, repo: string): Promise<RepoStats | null> {
        return this.insightsManager.getRepoStats(owner, repo)
    }

    async getTrafficData(owner: string, repo: string): Promise<TrafficData | null> {
        return this.insightsManager.getTrafficData(owner, repo)
    }

    async getTopReferrers(owner: string, repo: string, limit = 5): Promise<TrafficReferrer[] | null> {
        return this.insightsManager.getTopReferrers(owner, repo, limit)
    }

    async getPopularPaths(owner: string, repo: string, limit = 5): Promise<PopularPath[] | null> {
        return this.insightsManager.getPopularPaths(owner, repo, limit)
    }
}
