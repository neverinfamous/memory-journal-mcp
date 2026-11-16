/**
 * Shared GitHub Output Schemas
 */

import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'

// ============================================================================
// Issue Schemas
// ============================================================================

export const GitHubIssueOutputSchema = z
    .object({
        number: z.number(),
        title: z.string(),
        url: z.string(),
        state: z.enum(['OPEN', 'CLOSED']),
        milestone: z
            .object({
                number: z.number(),
                title: z.string(),
            })
            .nullable()
            .optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GitHubIssueDetailsOutputSchema = GitHubIssueOutputSchema.extend({
    body: z.string().nullable(),
    bodyTruncated: z.boolean().optional(),
    bodyFullLength: z.number().optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
    closedAt: z.string().nullable(),
    commentsCount: z.number(),
})

export const GitHubIssuesListOutputSchema = z
    .object({
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        issues: z.array(GitHubIssueOutputSchema).optional(),
        count: z.number().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GitHubIssueResultOutputSchema = z
    .object({
        issue: GitHubIssueDetailsOutputSchema.optional(),
        comments: z
            .array(
                z.object({
                    author: z.string(),
                    body: z.string(),
                    createdAt: z.string(),
                })
            )
            .optional(),
        commentCount: z.number().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// PR Schemas
// ============================================================================

export const GitHubPullRequestOutputSchema = z
    .object({
        number: z.number(),
        title: z.string(),
        url: z.string(),
        state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
        headRef: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GitHubPRDetailsOutputSchema = GitHubPullRequestOutputSchema.extend({
    body: z.string().nullable(),
    bodyTruncated: z.boolean().optional(),
    bodyFullLength: z.number().optional(),
    draft: z.boolean(),
    headBranch: z.string(),
    baseBranch: z.string(),
    author: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    mergedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    additions: z.number(),
    deletions: z.number(),
    changedFiles: z.number(),
})

export const GitHubPRsListOutputSchema = z
    .object({
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        pullRequests: z.array(GitHubPullRequestOutputSchema).optional(),
        count: z.number().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GitHubPRResultOutputSchema = z
    .object({
        pullRequest: GitHubPRDetailsOutputSchema.optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Context Schema
// ============================================================================

export const GitHubContextOutputSchema = z
    .object({
        repoName: z.string().nullable().optional(),
        branch: z.string().nullable().optional(),
        commit: z.string().nullable().optional(),
        remoteUrl: z.string().nullable().optional(),
        issues: z.array(GitHubIssueOutputSchema).optional(),
        pullRequests: z.array(GitHubPullRequestOutputSchema).optional(),
        issueCount: z.number().optional(),
        prCount: z.number().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
        degraded: z.array(z.string()).optional(),
        warning: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export {
    KanbanBoardOutputSchema,
    MoveKanbanItemOutputSchema,
    AddKanbanItemOutputSchema,
    DeleteKanbanItemOutputSchema,
    GitHubMilestoneOutputSchema,
    GitHubMilestonesListOutputSchema,
    GitHubMilestoneResultOutputSchema,
    CreateMilestoneOutputSchema,
    UpdateMilestoneOutputSchema,
    DeleteMilestoneOutputSchema,
} from './kanban-milestone-schemas.js'

// ============================================================================
// Issue Lifecycle Schemas
// ============================================================================

export const CreateGitHubIssueWithEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        issue: z
            .object({
                number: z.number(),
                title: z.string(),
                url: z.string(),
            })
            .optional(),
        project: z
            .object({
                projectNumber: z.number(),
                added: z.boolean(),
                message: z.string().optional(),
                error: z.string().optional(),
                initialStatus: z
                    .object({
                        status: z.string(),
                        set: z.boolean(),
                        error: z.string().optional(),
                    })
                    .optional(),
            })
            .optional(),
        journalEntry: z
            .object({
                id: z.number(),
                linkedToIssue: z.number(),
            })
            .optional(),
        message: z.string().optional(),
        warning: z.string().optional(),
        projectItemError: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const CloseGitHubIssueWithEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        issue: z
            .object({
                number: z.number(),
                title: z.string(),
                url: z.string(),
                previousState: z.string(),
                newState: z.string(),
            })
            .optional(),
        journalEntry: z
            .object({
                id: z.number(),
                linkedToIssue: z.number(),
                significanceType: z.string(),
            })
            .optional(),
        kanban: z
            .object({
                moved: z.boolean(),
                projectNumber: z.number().optional(),
                error: z.string().optional(),
                message: z.string().optional(),
            })
            .optional(),
        message: z.string().optional(),
        warning: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Insights Schema
// ============================================================================

export const RepoInsightsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        section: z.string().optional(),
        stars: z.number().optional(),
        forks: z.number().optional(),
        watchers: z.number().optional(),
        openIssues: z.number().optional(),
        size: z.number().optional(),
        defaultBranch: z.string().optional(),
        traffic: z
            .object({
                clones: z.object({
                    total: z.number(),
                    unique: z.number(),
                    dailyAvg: z.number(),
                }),
                views: z.object({
                    total: z.number(),
                    unique: z.number(),
                    dailyAvg: z.number(),
                }),
                period: z.string(),
            })
            .optional(),
        referrers: z
            .array(
                z.object({
                    referrer: z.string(),
                    count: z.number(),
                    uniques: z.number(),
                })
            )
            .optional(),
        paths: z
            .array(
                z.object({
                    path: z.string(),
                    title: z.string(),
                    count: z.number(),
                    uniques: z.number(),
                })
            )
            .optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Copilot Review Schema
// ============================================================================

export const CopilotReviewCommentOutputSchema = z
    .object({
        body: z.string(),
        path: z.string(),
        line: z.number().nullable(),
    })
    .extend(ErrorFieldsMixin.shape)

export const CopilotReviewsOutputSchema = z
    .object({
        prNumber: z.number().optional(),
        state: z.enum(['approved', 'changes_requested', 'commented', 'none']).optional(),
        commentCount: z.number().optional(),
        comments: z.array(CopilotReviewCommentOutputSchema).optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
