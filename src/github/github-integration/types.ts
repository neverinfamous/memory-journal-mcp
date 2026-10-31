import type { GitHubIssue, GitHubPullRequest } from '../../types/index.js'

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
    nodeId: string
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
 * Local Git status details
 */
export interface LocalGitStatus {
    branch?: string | null
    modified: number
    untracked: number
    isClean: boolean
    resolvedIssues?: number[]
}

/** Snapshot of rate limit state from response headers */
export interface RateLimitSnapshot {
    limit: number
    remaining: number
    used: number
    reset: number
    resource: string
    capturedAt: string
}

/** Rate limit category details */
export interface RateLimitCategory {
    limit: number
    remaining: number
    used: number
    reset: number
}

/** Full rate limit response from GET /rate_limit */
export interface GitHubRateLimitResponse {
    resources: {
        core: RateLimitCategory
        search: RateLimitCategory
        graphql: RateLimitCategory
        [key: string]: RateLimitCategory
    }
    rate: RateLimitCategory
}
