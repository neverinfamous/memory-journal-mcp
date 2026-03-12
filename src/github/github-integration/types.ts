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
