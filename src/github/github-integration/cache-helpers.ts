/**
 * Runtime type guards for cached GitHub API payloads and REST response shapes.
 * [BOUNDARY] Preserves exact object references on cache hits while avoiding unsafe `as` assertions.
 */

import { isRecord } from '../../utils/type-guards.js'
import type {
    GitHubIssue,
    GitHubMilestone,
    GitHubPullRequest,
    GitHubReview,
    GitHubReviewComment,
    GitHubWorkflowRun,
    KanbanBoard,
    PopularPath,
    ProjectContext,
    RepoStats,
    TrafficData,
    TrafficReferrer,
} from '../../types/index.js'
import type {
    GitHubRateLimitResponse,
    IssueDetails,
    PullRequestDetails,
    RepoInfo,
} from './types.js'

function isRecordArray(val: unknown): boolean {
    return Array.isArray(val) && val.every((item: unknown) => isRecord(item))
}

export function isCachedGitHubIssues(val: unknown): val is GitHubIssue[] {
    return isRecordArray(val)
}

export function isCachedIssueDetailsOrNull(val: unknown): val is IssueDetails | null {
    return val === null || isRecord(val)
}

export function isCachedIssueComments(
    val: unknown
): val is { author: string; body: string; createdAt: string }[] {
    return isRecordArray(val)
}

export function isCachedGitHubMilestones(val: unknown): val is GitHubMilestone[] {
    return isRecordArray(val)
}

export function isCachedGitHubMilestoneOrNull(val: unknown): val is GitHubMilestone | null {
    return val === null || isRecord(val)
}

export function isCachedGitHubPullRequests(val: unknown): val is GitHubPullRequest[] {
    return isRecordArray(val)
}

export function isCachedPullRequestDetailsOrNull(val: unknown): val is PullRequestDetails | null {
    return val === null || isRecord(val)
}

export function isCachedGitHubReviews(val: unknown): val is GitHubReview[] {
    return isRecordArray(val)
}

export function isCachedGitHubReviewComments(val: unknown): val is GitHubReviewComment[] {
    return isRecordArray(val)
}

export function isCachedRepoStats(val: unknown): val is RepoStats {
    return isRecord(val)
}

export function isCachedTrafficData(val: unknown): val is TrafficData {
    return isRecord(val)
}

export function isCachedTrafficReferrers(val: unknown): val is TrafficReferrer[] {
    return isRecordArray(val)
}

export function isCachedPopularPaths(val: unknown): val is PopularPath[] {
    return isRecordArray(val)
}

export function isCachedRepoInfo(val: unknown): val is RepoInfo {
    return isRecord(val)
}

export function isCachedWorkflowRuns(val: unknown): val is GitHubWorkflowRun[] {
    return isRecordArray(val)
}

export function isCachedKanbanBoard(val: unknown): val is KanbanBoard {
    return isRecord(val)
}

export function isCachedProjectContext(val: unknown): val is ProjectContext {
    return isRecord(val)
}

export function isGitHubRateLimitResponse(val: unknown): val is GitHubRateLimitResponse {
    return isRecord(val) && isRecord(val['resources']) && isRecord(val['rate'])
}
