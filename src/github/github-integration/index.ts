import type { RepoInfo, IssueDetails, PullRequestDetails } from './types.js'
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

/**
 * Module-scoped cache of integration instances bound to specific working directories
 */
const integrationCache = new Map<string, GitHubIntegration>()

/**
 * Factory method for retrieving a cached GitHubIntegration instance
 * Helps prevent blocking the Node.js event loop with excessive class instantiations
 */
export function getGitHubIntegration(workingDir = '.'): GitHubIntegration {
    const cached = integrationCache.get(workingDir)
    if (cached) return cached
    
    const newIntegration = new GitHubIntegration(workingDir)
    integrationCache.set(workingDir, newIntegration)
    return newIntegration
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

    constructor(workingDir = '.') {
        this.client = new GitHubClient(workingDir)
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

    async getIssues(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubIssue[]> {
        return this.issuesManager.getIssues(owner, repo, state, limit)
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
        limit = 20
    ): Promise<GitHubPullRequest[]> {
        return this.pullRequestsManager.getPullRequests(owner, repo, state, limit)
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

    async getWorkflowRuns(owner: string, repo: string, limit = 10): Promise<GitHubWorkflowRun[]> {
        return this.repositoryManager.getWorkflowRuns(owner, repo, limit)
    }

    async getRepoContext(): Promise<ProjectContext> {
        const cached = this.client.getCached('context:repo') as ProjectContext | undefined
        if (cached) return cached

        const repoInfo = await this.repositoryManager.getRepoInfo()

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

        try {
            const log = await this.client.git.log({ maxCount: 1 })
            context.commit = log.latest?.hash ?? null
        } catch {
            // Ignore error
        }

        if (repoInfo.owner && repoInfo.repo) {
            context.issues = await this.issuesManager.getIssues(
                repoInfo.owner,
                repoInfo.repo,
                'open',
                10
            )
            context.pullRequests = await this.pullRequestsManager.getPullRequests(
                repoInfo.owner,
                repoInfo.repo,
                'open',
                10
            )
            context.workflowRuns = await this.repositoryManager.getWorkflowRuns(
                repoInfo.owner,
                repoInfo.repo,
                10
            )
            context.milestones = await this.milestonesManager.getMilestones(
                repoInfo.owner,
                repoInfo.repo,
                'open',
                10
            )
        }

        this.client.setCache('context:repo', context)
        return context
    }

    async getProjectKanban(
        owner: string,
        projectNumber: number,
        repo?: string
    ): Promise<KanbanBoard | null> {
        return this.projectsManager.getProjectKanban(owner, projectNumber, repo)
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
        limit = 20
    ): Promise<GitHubMilestone[]> {
        return this.milestonesManager.getMilestones(owner, repo, state, limit)
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

    async getTopReferrers(owner: string, repo: string, limit = 5): Promise<TrafficReferrer[]> {
        return this.insightsManager.getTopReferrers(owner, repo, limit)
    }

    async getPopularPaths(owner: string, repo: string, limit = 5): Promise<PopularPath[]> {
        return this.insightsManager.getPopularPaths(owner, repo, limit)
    }
}
