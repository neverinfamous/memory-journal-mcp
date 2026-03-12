/**
 * Memory Journal MCP Server - GitHub Integration
 *
 * GitHub API integration using @octokit/rest for API access,
 * @octokit/graphql for Projects v2, and simple-git for local repository operations.
 */

import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'
import * as simpleGitImport from 'simple-git'
import { logger } from '../utils/logger.js'
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
    KanbanColumn,
    ProjectV2Item,
    ProjectV2StatusOption,
    RepoStats,
    TrafficData,
    TrafficReferrer,
    PopularPath,
} from '../types/index.js'

/** TTL for cached GitHub API responses (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000

/** TTL for cached traffic/insights responses (10 minutes - traffic data changes slowly) */
const TRAFFIC_CACHE_TTL_MS = 10 * 60 * 1000

/** Generic cache entry with timestamp */
interface CacheEntry<T> {
    data: T
    timestamp: number
}

// Handle simpleGit ESM/CJS interop
type SimpleGitType = typeof simpleGitImport.simpleGit
const simpleGit: SimpleGitType = simpleGitImport.simpleGit

/**
 * Local repository information
 */
export interface RepoInfo {
    owner: string | null
    repo: string | null
    branch: string | null
    remoteUrl: string | null
}

/**
 * GitHub issue details (extended)
 */
export interface IssueDetails extends GitHubIssue {
    body: string | null
    labels: string[]
    assignees: string[]
    createdAt: string
    updatedAt: string
    closedAt: string | null
    commentsCount: number
}

/**
 * GitHub PR details (extended)
 */
export interface PullRequestDetails extends GitHubPullRequest {
    body: string | null
    draft: boolean
    headBranch: string
    baseBranch: string
    author: string
    createdAt: string
    updatedAt: string
    mergedAt: string | null
    closedAt: string | null
    additions: number
    deletions: number
    changedFiles: number
}

/**
 * GitHubIntegration - Handles GitHub API and local git operations
 */
export class GitHubIntegration {
    private octokit: Octokit | null = null
    private graphqlWithAuth: typeof graphql | null = null
    private git: simpleGitImport.SimpleGit
    private readonly token: string | undefined
    private cachedRepoInfo: RepoInfo | null = null

    /** TTL response cache for GitHub API read methods */
    private readonly apiCache = new Map<string, CacheEntry<unknown>>()

    constructor(workingDir = '.') {
        this.token = process.env['GITHUB_TOKEN']

        // Use GITHUB_REPO_PATH env var if set, otherwise fall back to workingDir
        const envRepoPath = process.env['GITHUB_REPO_PATH']
        const effectiveDir = envRepoPath || workingDir

        // Resolve and log the actual working directory
        const resolvedDir = effectiveDir === '.' ? process.cwd() : effectiveDir
        logger.info('GitHub integration using directory', {
            module: 'GitHub',
            workingDir,
            envRepoPath: envRepoPath ?? 'not set',
            effectiveDir,
            resolvedDir,
            cwd: process.cwd(),
        })

        this.git = simpleGit(effectiveDir)

        // Initialize Octokit and GraphQL if token is available
        if (this.token) {
            this.octokit = new Octokit({ auth: this.token })
            this.graphqlWithAuth = graphql.defaults({
                headers: { authorization: `token ${this.token}` },
            })
            logger.info('GitHub integration initialized with token', { module: 'GitHub' })
        } else {
            logger.info('GitHub integration initialized without token (limited functionality)', {
                module: 'GitHub',
            })
        }
    }

    /**
     * Check if GitHub API is available (token present)
     */
    isApiAvailable(): boolean {
        return this.octokit !== null
    }

    /**
     * Get a cached value if it exists and hasn't expired.
     */
    private getCached(key: string): unknown {
        const entry = this.apiCache.get(key)
        if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
            return entry.data
        }
        if (entry) {
            this.apiCache.delete(key)
        }
        return undefined
    }

    /**
     * Store a value in the cache.
     */
    private setCache(key: string, data: unknown): void {
        this.apiCache.set(key, { data, timestamp: Date.now() })
    }

    /**
     * Invalidate all cache entries matching a prefix.
     */
    private invalidateCache(prefix: string): void {
        for (const key of this.apiCache.keys()) {
            if (key.startsWith(prefix)) {
                this.apiCache.delete(key)
            }
        }
    }

    /**
     * Clear all cached GitHub API responses.
     */
    clearCache(): void {
        this.apiCache.clear()
    }

    /**
     * Get local repository information
     * Caches the result for synchronous access via getCachedRepoInfo()
     */
    async getRepoInfo(): Promise<RepoInfo> {
        try {
            // Get current branch
            const branchResult = await this.git.branch()
            const branch = branchResult.current || null

            // Get remote URL
            const remotes = await this.git.getRemotes(true)
            const origin = remotes.find((r) => r.name === 'origin')
            const remoteUrl = origin?.refs?.fetch || null

            // Parse owner/repo from remote URL
            const { owner, repo } = this.parseRemoteUrl(remoteUrl)

            const repoInfo = { owner, repo, branch, remoteUrl }
            // Cache the result for synchronous access
            this.cachedRepoInfo = repoInfo
            return repoInfo
        } catch (error) {
            logger.debug('Failed to get repo info (may not be a git repo)', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return { owner: null, repo: null, branch: null, remoteUrl: null }
        }
    }

    /**
     * Get cached repository information (synchronous)
     * Returns null if getRepoInfo() has never been called.
     * Used for synchronous URL construction in create_entry.
     */
    getCachedRepoInfo(): RepoInfo | null {
        return this.cachedRepoInfo
    }

    /**
     * Parse owner and repo from GitHub remote URL
     */
    private parseRemoteUrl(remoteUrl: string | null): {
        owner: string | null
        repo: string | null
    } {
        if (!remoteUrl) return { owner: null, repo: null }

        // Handle SSH format: git@github.com:owner/repo.git
        if (remoteUrl.startsWith('git@github.com:')) {
            const pathPart = remoteUrl.replace('git@github.com:', '').replace('.git', '')
            const parts = pathPart.split('/')
            if (parts.length >= 2) {
                return { owner: parts[0] ?? null, repo: parts[1] ?? null }
            }
        }

        // Handle HTTPS format: https://github.com/owner/repo.git
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

    /**
     * Get repository issues
     */
    async getIssues(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubIssue[]> {
        if (!this.octokit) {
            return []
        }

        const cacheKey = `issues:${owner}:${repo}:${state}:${String(limit)}`
        const cached = this.getCached(cacheKey) as GitHubIssue[] | undefined
        if (cached) return cached

        try {
            // Over-fetch by 2× because GitHub REST API includes PRs in the
            // issues endpoint. After filtering PRs out we slice to `limit`.
            const response = await this.octokit.issues.listForRepo({
                owner,
                repo,
                state,
                per_page: Math.min(limit * 2, 100),
                sort: 'updated',
                direction: 'desc',
            })

            // Filter out pull requests (GitHub API includes PRs in issues)
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

            this.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get issues', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Get issue details
     */
    async getIssue(owner: string, repo: string, issueNumber: number): Promise<IssueDetails | null> {
        if (!this.octokit) {
            return null
        }

        const cacheKey = `issue:${owner}:${repo}:${String(issueNumber)}`
        const cached = this.getCached(cacheKey) as IssueDetails | null | undefined
        if (cached !== undefined) return cached

        try {
            const response = await this.octokit.issues.get({
                owner,
                repo,
                issue_number: issueNumber,
            })

            const issue = response.data

            // Verify it's not a PR
            if (issue.pull_request) {
                return null
            }

            const details: IssueDetails = {
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
                state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
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

            this.setCache(cacheKey, details)
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

    /**
     * Create a new GitHub issue
     */
    async createIssue(
        owner: string,
        repo: string,
        title: string,
        body?: string,
        labels?: string[],
        assignees?: string[],
        milestone?: number
    ): Promise<{ number: number; url: string; title: string; nodeId: string } | null> {
        if (!this.octokit) {
            logger.error('Cannot create issue: GitHub API not available', { module: 'GitHub' })
            return null
        }

        try {
            const response = await this.octokit.issues.create({
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
            this.invalidateCache(`issues:${owner}:${repo}`)
            this.invalidateCache('context:')
        }
    }

    /**
     * Close a GitHub issue with optional comment
     */
    async closeIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        comment?: string
    ): Promise<{ success: boolean; url: string } | null> {
        if (!this.octokit) {
            logger.error('Cannot close issue: GitHub API not available', { module: 'GitHub' })
            return null
        }

        try {
            // Add comment if provided
            if (comment) {
                await this.octokit.issues.createComment({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    body: comment,
                })
            }

            // Close the issue
            const response = await this.octokit.issues.update({
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
            this.invalidateCache(`issues:${owner}:${repo}`)
            this.invalidateCache(`issue:${owner}:${repo}:${String(issueNumber)}`)
            this.invalidateCache('context:')
        }
    }

    /**
     * Get repository pull requests
     */
    async getPullRequests(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubPullRequest[]> {
        if (!this.octokit) {
            return []
        }

        const cacheKey = `prs:${owner}:${repo}:${state}:${String(limit)}`
        const cached = this.getCached(cacheKey) as GitHubPullRequest[] | undefined
        if (cached) return cached

        try {
            const response = await this.octokit.pulls.list({
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

            this.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get pull requests', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Get PR details
     */
    async getPullRequest(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<PullRequestDetails | null> {
        if (!this.octokit) {
            return null
        }

        const cacheKey = `pr:${owner}:${repo}:${String(prNumber)}`
        const cached = this.getCached(cacheKey) as PullRequestDetails | null | undefined
        if (cached !== undefined) return cached

        try {
            const response = await this.octokit.pulls.get({
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

            this.setCache(cacheKey, details)
            return details
        } catch (error) {
            logger.error('Failed to get PR details', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return null
        }
    }

    // ========================================================================
    // PR Reviews & Copilot Integration
    // ========================================================================

    /** Known Copilot bot login patterns */
    private static readonly COPILOT_BOT_PATTERNS = [
        'copilot-pull-request-reviewer[bot]',
        'github-copilot[bot]',
        'copilot[bot]',
    ]

    /** Check if an author login matches a Copilot bot */
    private static isCopilotAuthor(login: string): boolean {
        const lower = login.toLowerCase()
        return GitHubIntegration.COPILOT_BOT_PATTERNS.some((p) => lower === p || lower.includes('copilot'))
    }

    /**
     * Get all reviews for a PR
     */
    async getReviews(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<GitHubReview[]> {
        if (!this.octokit) return []

        const cacheKey = `reviews:${owner}:${repo}:${String(prNumber)}`
        const cached = this.getCached(cacheKey) as GitHubReview[] | undefined
        if (cached) return cached

        try {
            const response = await this.octokit.rest.pulls.listReviews({
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
                isCopilot: GitHubIntegration.isCopilotAuthor(r.user?.login ?? ''),
            }))

            this.setCache(cacheKey, reviews)
            return reviews
        } catch (error) {
            logger.error('Failed to get PR reviews', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Get review comments (file-level) for a PR
     */
    async getReviewComments(
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<GitHubReviewComment[]> {
        if (!this.octokit) return []

        const cacheKey = `review-comments:${owner}:${repo}:${String(prNumber)}`
        const cached = this.getCached(cacheKey) as GitHubReviewComment[] | undefined
        if (cached) return cached

        try {
            const response = await this.octokit.rest.pulls.listReviewComments({
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
                side: c.side! as 'LEFT' | 'RIGHT',
                createdAt: c.created_at,
                isCopilot: GitHubIntegration.isCopilotAuthor(c.user?.login ?? ''),
            }))

            this.setCache(cacheKey, comments)
            return comments
        } catch (error) {
            logger.error('Failed to get review comments', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Get Copilot's review summary for a PR
     */
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

        // Determine overall state from Copilot's reviews
        let state: CopilotReviewSummary['state'] = 'none'
        if (copilotReviews.length > 0) {
            // Use the latest Copilot review state
            const latest = copilotReviews[copilotReviews.length - 1]
            if (latest.state === 'APPROVED') state = 'approved'
            else if (latest.state === 'CHANGES_REQUESTED') state = 'changes_requested'
            else if (latest.state === 'COMMENTED') state = 'commented'
        }

        return {
            prNumber,
            state,
            commentCount: copilotComments.length,
            comments: copilotComments,
        }
    }

    /**
     * Get workflow runs from GitHub Actions
     */
    async getWorkflowRuns(owner: string, repo: string, limit = 10): Promise<GitHubWorkflowRun[]> {
        if (!this.octokit) {
            logger.debug('GitHub API not available - no token', { module: 'GitHub' })
            return []
        }

        const cacheKey = `workflows:${owner}:${repo}:${String(limit)}`
        const cached = this.getCached(cacheKey) as GitHubWorkflowRun[] | undefined
        if (cached) return cached

        try {
            const response = await this.octokit.rest.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                per_page: limit,
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

            this.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get workflow runs', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Get full repository context (issues, PRs, branch info)
     */
    async getRepoContext(): Promise<ProjectContext> {
        const cached = this.getCached('context:repo') as ProjectContext | undefined
        if (cached) return cached

        const repoInfo = await this.getRepoInfo()

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

        // Get current commit
        try {
            const log = await this.git.log({ maxCount: 1 })
            context.commit = log.latest?.hash ?? null
        } catch {
            // Ignore error
        }

        // Get issues, PRs, and workflow runs if we have owner/repo
        if (repoInfo.owner && repoInfo.repo) {
            context.issues = await this.getIssues(repoInfo.owner, repoInfo.repo, 'open', 10)
            context.pullRequests = await this.getPullRequests(
                repoInfo.owner,
                repoInfo.repo,
                'open',
                10
            )
            context.workflowRuns = await this.getWorkflowRuns(repoInfo.owner, repoInfo.repo, 10)
            context.milestones = await this.getMilestones(repoInfo.owner, repoInfo.repo, 'open', 10)
        }

        this.setCache('context:repo', context)
        return context
    }

    // ==========================================================================
    // GitHub Projects v2 Kanban Methods
    // ==========================================================================

    /**
     * Get a Kanban board view of a GitHub Project v2
     * Fetches project items grouped by Status field
     *
     * Searches in order: user projects, then repository projects, then organization projects
     */
    async getProjectKanban(
        owner: string,
        projectNumber: number,
        repo?: string
    ): Promise<KanbanBoard | null> {
        if (!this.graphqlWithAuth) {
            logger.debug('GraphQL not available - no token', { module: 'GitHub' })
            return null
        }

        // Common fragment for project data
        const projectFragment = `
            fragment ProjectData on ProjectV2 {
                id
                title
                fields(first: 20) {
                    nodes {
                        ... on ProjectV2SingleSelectField {
                            id
                            name
                            options {
                                id
                                name
                                color
                            }
                        }
                    }
                }
                items(first: 100) {
                    nodes {
                        id
                        type
                        createdAt
                        updatedAt
                        fieldValues(first: 10) {
                            nodes {
                                ... on ProjectV2ItemFieldSingleSelectValue {
                                    name
                                    field {
                                        ... on ProjectV2SingleSelectField {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                        content {
                            ... on Issue {
                                number
                                title
                                url
                                labels(first: 5) {
                                    nodes { name }
                                }
                                assignees(first: 5) {
                                    nodes { login }
                                }
                            }
                            ... on PullRequest {
                                number
                                title
                                url
                                labels(first: 5) {
                                    nodes { name }
                                }
                                assignees(first: 5) {
                                    nodes { login }
                                }
                            }
                            ... on DraftIssue {
                                title
                            }
                        }
                    }
                }
            }
        `

        // Try user-level project first
        const userQuery = `
            ${projectFragment}
            query($owner: String!, $number: Int!) {
                user(login: $owner) {
                    projectV2(number: $number) {
                        ...ProjectData
                    }
                }
            }
        `

        // Repository-level project query
        const repoQuery = `
            ${projectFragment}
            query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    projectV2(number: $number) {
                        ...ProjectData
                    }
                }
            }
        `

        // Organization-level project query
        const orgQuery = `
            ${projectFragment}
            query($owner: String!, $number: Int!) {
                organization(login: $owner) {
                    projectV2(number: $number) {
                        ...ProjectData
                    }
                }
            }
        `

        interface ProjectV2Data {
            id: string
            title: string
            fields: {
                nodes: {
                    id?: string
                    name?: string
                    options?: {
                        id: string
                        name: string
                        color?: string
                    }[]
                }[]
            }
            items: {
                nodes: {
                    id: string
                    type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE'
                    createdAt: string
                    updatedAt: string
                    fieldValues: {
                        nodes: {
                            name?: string
                            field?: { name?: string }
                        }[]
                    }
                    content: {
                        number?: number
                        title?: string
                        url?: string
                        labels?: { nodes: { name: string }[] }
                        assignees?: { nodes: { login: string }[] }
                    } | null
                }[]
            }
        }

        interface UserResponse {
            user: { projectV2: ProjectV2Data | null } | null
        }
        interface RepoResponse {
            repository: { projectV2: ProjectV2Data | null } | null
        }
        interface OrgResponse {
            organization: { projectV2: ProjectV2Data | null } | null
        }

        let project: ProjectV2Data | null = null
        let source = ''

        // Try user-level project first
        try {
            const response = await this.graphqlWithAuth<UserResponse>(userQuery, {
                owner,
                number: projectNumber,
            })
            if (response.user?.projectV2) {
                project = response.user.projectV2
                source = 'user'
            }
        } catch {
            logger.debug('User project not found, trying repository...', { module: 'GitHub' })
        }

        // Try repository-level project if user project not found
        if (!project && repo) {
            try {
                const response = await this.graphqlWithAuth<RepoResponse>(repoQuery, {
                    owner,
                    repo,
                    number: projectNumber,
                })
                if (response.repository?.projectV2) {
                    project = response.repository.projectV2
                    source = 'repository'
                }
            } catch {
                logger.debug('Repository project not found, trying organization...', {
                    module: 'GitHub',
                })
            }
        }

        // Try organization-level project as last resort
        if (!project) {
            try {
                const response = await this.graphqlWithAuth<OrgResponse>(orgQuery, {
                    owner,
                    number: projectNumber,
                })
                if (response.organization?.projectV2) {
                    project = response.organization.projectV2
                    source = 'organization'
                }
            } catch {
                logger.debug('Organization project not found', { module: 'GitHub' })
            }
        }

        if (!project) {
            logger.warning('Project not found', { module: 'GitHub', entityId: projectNumber })
            return null
        }

        // Find the Status field
        const statusField = project.fields.nodes.find(
            (f) => f.name === 'Status' && f.options !== undefined && f.options.length > 0
        )

        if (!statusField?.id || !statusField.options) {
            logger.warning('Status field not found in project', {
                module: 'GitHub',
                entityId: projectNumber,
            })
            return null
        }

        const statusOptions: ProjectV2StatusOption[] = statusField.options.map((opt) => ({
            id: opt.id,
            name: opt.name,
            color: opt.color,
        }))

        // Group items by status
        const columnMap = new Map<string, ProjectV2Item[]>()

        // Initialize columns for all status options
        for (const opt of statusOptions) {
            columnMap.set(opt.name, [])
        }
        // Add a column for items without status
        columnMap.set('No Status', [])

        for (const item of project.items.nodes) {
            // Find the Status field value
            const statusValue = item.fieldValues.nodes.find((fv) => fv.field?.name === 'Status')
            const status = statusValue?.name ?? 'No Status'

            const content = item.content
            const projectItem: ProjectV2Item = {
                id: item.id,
                title: content?.title ?? 'Draft Issue',
                url: content?.url ?? '',
                type: item.type,
                status,
                number: content?.number,
                labels: content?.labels?.nodes.map((l) => l.name) ?? [],
                assignees: content?.assignees?.nodes.map((a) => a.login) ?? [],
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            }

            const column = columnMap.get(status)
            if (column) {
                column.push(projectItem)
            } else {
                columnMap.get('No Status')?.push(projectItem)
            }
        }

        // Build columns array
        const columns: KanbanColumn[] = []
        for (const opt of statusOptions) {
            const items = columnMap.get(opt.name) ?? []
            columns.push({
                status: opt.name,
                statusOptionId: opt.id,
                items,
            })
        }

        // Add "No Status" column if it has items
        const noStatusItems = columnMap.get('No Status') ?? []
        if (noStatusItems.length > 0) {
            columns.push({
                status: 'No Status',
                statusOptionId: '',
                items: noStatusItems,
            })
        }

        const totalItems = project.items.nodes.length

        logger.info('Fetched Kanban board', {
            module: 'GitHub',
            entityId: projectNumber,
            context: { columns: columns.length, items: totalItems, source },
        })

        return {
            projectId: project.id,
            projectNumber,
            projectTitle: project.title,
            statusFieldId: statusField.id,
            statusOptions,
            columns,
            totalItems,
        }
    }

    /**
     * Move a project item to a different status column
     */
    async moveProjectItem(
        projectId: string,
        itemId: string,
        statusFieldId: string,
        statusOptionId: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.graphqlWithAuth) {
            return { success: false, error: 'GraphQL not available - no token' }
        }

        try {
            const mutation = `
                mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                    updateProjectV2ItemFieldValue(
                        input: {
                            projectId: $projectId
                            itemId: $itemId
                            fieldId: $fieldId
                            value: { singleSelectOptionId: $optionId }
                        }
                    ) {
                        projectV2Item {
                            id
                        }
                    }
                }
            `

            await this.graphqlWithAuth(mutation, {
                projectId,
                itemId,
                fieldId: statusFieldId,
                optionId: statusOptionId,
            })

            logger.info('Moved project item', {
                module: 'GitHub',
                entityId: itemId,
                context: { targetStatus: statusOptionId },
            })

            return { success: true }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to move project item', {
                module: 'GitHub',
                entityId: itemId,
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        } finally {
            this.invalidateCache('kanban:')
        }
    }

    /**
     * Add an item to a GitHub Project v2
     */
    async addProjectItem(
        projectId: string,
        contentId: string
    ): Promise<{ success: boolean; itemId?: string; error?: string }> {
        if (!this.graphqlWithAuth) {
            return { success: false, error: 'GraphQL not available - no token' }
        }

        try {
            const mutation = `
                mutation($projectId: ID!, $contentId: ID!) {
                    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
                        item {
                            id
                        }
                    }
                }
            `

            const response = await this.graphqlWithAuth<{
                addProjectV2ItemById: { item: { id: string } }
            }>(mutation, {
                projectId,
                contentId,
            })

            const itemId = response.addProjectV2ItemById?.item?.id

            logger.info('Added item to project', {
                module: 'GitHub',
                context: { projectId, contentId, itemId },
            })

            return { success: true, itemId }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to add item to project', {
                module: 'GitHub',
                context: { projectId, contentId },
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        } finally {
            this.invalidateCache('kanban:')
        }
    }

    // ==========================================================================
    // GitHub Milestones Methods
    // ==========================================================================

    /**
     * List milestones for a repository
     */
    async getMilestones(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubMilestone[]> {
        if (!this.octokit) {
            return []
        }

        const cacheKey = `milestones:${owner}:${repo}:${state}:${String(limit)}`
        const cached = this.getCached(cacheKey) as GitHubMilestone[] | undefined
        if (cached) return cached

        try {
            const response = await this.octokit.issues.listMilestones({
                owner,
                repo,
                state,
                per_page: limit,
                sort: 'due_on',
                direction: 'asc',
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

            this.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get milestones', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Get a single milestone by number
     */
    async getMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number
    ): Promise<GitHubMilestone | null> {
        if (!this.octokit) {
            return null
        }

        const cacheKey = `milestone:${owner}:${repo}:${String(milestoneNumber)}`
        const cached = this.getCached(cacheKey) as GitHubMilestone | null | undefined
        if (cached !== undefined) return cached

        try {
            const response = await this.octokit.issues.getMilestone({
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

            this.setCache(cacheKey, milestone)
            return milestone
        } catch (error) {
            logger.error('Failed to get milestone', {
                module: 'GitHub',
                entityId: milestoneNumber,
                error: error instanceof Error ? error.message : String(error),
            })
            return null
        }
    }

    /**
     * Create a new milestone
     */
    async createMilestone(
        owner: string,
        repo: string,
        title: string,
        description?: string,
        dueOn?: string
    ): Promise<GitHubMilestone | null> {
        if (!this.octokit) {
            logger.error('Cannot create milestone: GitHub API not available', {
                module: 'GitHub',
            })
            return null
        }

        try {
            const response = await this.octokit.issues.createMilestone({
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
            return null
        } finally {
            this.invalidateCache(`milestones:${owner}:${repo}`)
            this.invalidateCache('context:')
        }
    }

    /**
     * Update an existing milestone
     */
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
        if (!this.octokit) {
            logger.error('Cannot update milestone: GitHub API not available', {
                module: 'GitHub',
            })
            return null
        }

        try {
            const response = await this.octokit.issues.updateMilestone({
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
            return null
        } finally {
            this.invalidateCache(`milestones:${owner}:${repo}`)
            this.invalidateCache(`milestone:${owner}:${repo}:${String(milestoneNumber)}`)
            this.invalidateCache('context:')
        }
    }

    /**
     * Delete a milestone
     */
    async deleteMilestone(
        owner: string,
        repo: string,
        milestoneNumber: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.octokit) {
            return { success: false, error: 'GitHub API not available' }
        }

        try {
            await this.octokit.issues.deleteMilestone({
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
            this.invalidateCache(`milestones:${owner}:${repo}`)
            this.invalidateCache(`milestone:${owner}:${repo}:${String(milestoneNumber)}`)
            this.invalidateCache('context:')
        }
    }

    // ==========================================================================
    // Repository Insights/Traffic Methods
    // ==========================================================================

    /**
     * Get a cached value with a custom TTL.
     * Used for traffic endpoints which change slowly (10-min TTL).
     */
    private getCachedWithTtl(key: string, ttlMs: number): unknown {
        const entry = this.apiCache.get(key)
        if (entry && Date.now() - entry.timestamp < ttlMs) {
            return entry.data
        }
        if (entry) {
            this.apiCache.delete(key)
        }
        return undefined
    }

    /**
     * Get repository statistics (stars, forks, watchers).
     * Uses a single GET /repos/{owner}/{repo} API call.
     */
    async getRepoStats(owner: string, repo: string): Promise<RepoStats | null> {
        if (!this.octokit) {
            return null
        }

        const cacheKey = `repostats:${owner}:${repo}`
        const cached = this.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | RepoStats
            | undefined
        if (cached) return cached

        try {
            const response = await this.octokit.repos.get({ owner, repo })
            const data = response.data

            const result: RepoStats = {
                stars: data.stargazers_count,
                forks: data.forks_count,
                watchers: data.subscribers_count,
                openIssues: data.open_issues_count,
                size: data.size,
                defaultBranch: data.default_branch,
            }

            this.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get repo stats', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return null
        }
    }

    /**
     * Get aggregated traffic data (14-day rolling clones + views).
     * Combines GET /repos/{owner}/{repo}/traffic/clones and /traffic/views.
     * Requires push access to the repository.
     */
    async getTrafficData(owner: string, repo: string): Promise<TrafficData | null> {
        if (!this.octokit) {
            return null
        }

        const cacheKey = `traffic:${owner}:${repo}`
        const cached = this.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | TrafficData
            | undefined
        if (cached) return cached

        try {
            const [clonesRes, viewsRes] = await Promise.all([
                this.octokit.rest.repos.getClones({ owner, repo }),
                this.octokit.rest.repos.getViews({ owner, repo }),
            ])

            const clonesDays = clonesRes.data.clones?.length ?? 0
            const viewsDays = viewsRes.data.views?.length ?? 0

            const result: TrafficData = {
                clones: {
                    total: clonesRes.data.count,
                    unique: clonesRes.data.uniques,
                    dailyAvg: clonesDays > 0 ? Math.round(clonesRes.data.count / clonesDays) : 0,
                },
                views: {
                    total: viewsRes.data.count,
                    unique: viewsRes.data.uniques,
                    dailyAvg: viewsDays > 0 ? Math.round(viewsRes.data.count / viewsDays) : 0,
                },
                period: '14 days',
            }

            this.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get traffic data', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return null
        }
    }

    /**
     * Get top referrer sources for the repository (14-day rolling).
     * Requires push access to the repository.
     */
    async getTopReferrers(owner: string, repo: string, limit = 5): Promise<TrafficReferrer[]> {
        if (!this.octokit) {
            return []
        }

        const cacheKey = `referrers:${owner}:${repo}`
        const cached = this.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | TrafficReferrer[]
            | undefined
        if (cached) return cached.slice(0, limit)

        try {
            const response = await this.octokit.rest.repos.getTopReferrers({ owner, repo })

            const result: TrafficReferrer[] = response.data.map((r) => ({
                referrer: r.referrer,
                count: r.count,
                uniques: r.uniques,
            }))

            this.setCache(cacheKey, result)
            return result.slice(0, limit)
        } catch (error) {
            logger.error('Failed to get top referrers', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return []
        }
    }

    /**
     * Get popular repository paths (14-day rolling).
     * Requires push access to the repository.
     */
    async getPopularPaths(owner: string, repo: string, limit = 5): Promise<PopularPath[]> {
        if (!this.octokit) {
            return []
        }

        const cacheKey = `paths:${owner}:${repo}`
        const cached = this.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | PopularPath[]
            | undefined
        if (cached) return cached.slice(0, limit)

        try {
            const response = await this.octokit.rest.repos.getTopPaths({ owner, repo })

            const result: PopularPath[] = response.data.map((p) => ({
                path: p.path,
                title: p.title,
                count: p.count,
                uniques: p.uniques,
            }))

            this.setCache(cacheKey, result)
            return result.slice(0, limit)
        } catch (error) {
            logger.error('Failed to get popular paths', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return []
        }
    }
}
