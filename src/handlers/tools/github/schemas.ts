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
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Kanban Schemas
// ============================================================================

const KanbanItemOutputSchema = z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    type: z.enum(['ISSUE', 'PULL_REQUEST', 'DRAFT_ISSUE']),
    status: z.string().nullable(),
    number: z.number().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
})

const StatusOptionOutputSchema = z.object({
    id: z.string(),
    name: z.string(),
    color: z.string().optional(),
})

const KanbanColumnOutputSchema = z.object({
    status: z.string(),
    statusOptionId: z.string(),
    items: z.array(KanbanItemOutputSchema),
    itemCount: z.number().optional(),
    truncated: z.boolean().optional(),
})

export const KanbanBoardOutputSchema = z
    .object({
        projectId: z.string().optional(),
        projectNumber: z.number().optional(),
        projectTitle: z.string().optional(),
        statusFieldId: z.string().optional(),
        statusOptions: z.array(StatusOptionOutputSchema).optional(),
        columns: z.array(KanbanColumnOutputSchema).optional(),
        totalItems: z.number().optional(),
        itemDirectory: z.array(z.object({
            id: z.string(),
            title: z.string(),
            status: z.string().nullable()
        })).optional(),
        summaryOnly: z.boolean().optional(),
        owner: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        hint: z.string().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const MoveKanbanItemOutputSchema = z
    .object({
        success: z.boolean().optional(),
        itemId: z.string().optional(),
        newStatus: z.string().optional(),
        projectNumber: z.number().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        hint: z.string().optional(),
        availableStatuses: z.array(z.string()).optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const AddKanbanItemOutputSchema = z
    .object({
        success: z.boolean().optional(),
        itemId: z.string().optional(),
        projectNumber: z.number().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        hint: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const DeleteKanbanItemOutputSchema = z
    .object({
        success: z.boolean().optional(),
        itemId: z.string().optional(),
        projectNumber: z.number().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        hint: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

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
                message: z.string(),
                initialStatus: z
                    .object({
                        status: z.string(),
                        set: z.boolean(),
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
                projectNumber: z.number(),
                message: z.string().optional(),
            })
            .optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Milestone Schemas
// ============================================================================

export const GitHubMilestoneOutputSchema = z
    .object({
        number: z.number(),
        title: z.string(),
        description: z.string().nullable(),
        state: z.enum(['open', 'closed']),
        url: z.string(),
        dueOn: z.string().nullable(),
        openIssues: z.number(),
        closedIssues: z.number(),
        completionPercentage: z.number().optional(),
        createdAt: z.string(),
        updatedAt: z.string(),
        creator: z.string().nullable(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GitHubMilestonesListOutputSchema = z
    .object({
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        milestones: z.array(GitHubMilestoneOutputSchema).optional(),
        count: z.number().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GitHubMilestoneResultOutputSchema = z
    .object({
        milestone: GitHubMilestoneOutputSchema.optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const CreateMilestoneOutputSchema = z
    .object({
        success: z.boolean().optional(),
        milestone: GitHubMilestoneOutputSchema.optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const UpdateMilestoneOutputSchema = z
    .object({
        success: z.boolean().optional(),
        milestone: GitHubMilestoneOutputSchema.optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const DeleteMilestoneOutputSchema = z
    .object({
        success: z.boolean().optional(),
        milestoneNumber: z.number().optional(),
        message: z.string().optional(),
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
