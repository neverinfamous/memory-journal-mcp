import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'

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
    items: z.array(KanbanItemOutputSchema).optional(),
    itemCount: z.number().optional(),
    truncated: z.boolean().optional(),
})

export const KanbanBoardOutputSchema = z
    .object({
        success: z.boolean().optional(),
        projectId: z.string().optional(),
        projectNumber: z.number().optional(),
        projectTitle: z.string().optional(),
        statusFieldId: z.string().optional(),
        statusOptions: z.array(StatusOptionOutputSchema).optional(),
        columns: z.array(KanbanColumnOutputSchema).optional(),
        totalItems: z.number().optional(),
        truncated: z.boolean().optional(),
        itemDirectory: z
            .array(
                z.object({
                    id: z.string(),
                    title: z.string(),
                    status: z.string().nullable(),
                })
            )
            .optional(),
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
        availableStatuses: z.array(z.string()).optional(),
        message: z.string().optional(),
        owner: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const AddKanbanItemOutputSchema = z
    .object({
        success: z.boolean().optional(),
        itemId: z.string().optional(),
        projectNumber: z.number().optional(),
        message: z.string().optional(),
        owner: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const DeleteKanbanItemOutputSchema = z
    .object({
        success: z.boolean().optional(),
        itemId: z.string().optional(),
        projectNumber: z.number().optional(),
        message: z.string().optional(),
        owner: z.string().optional(),
        detectedOwner: z.string().nullable().optional(),
        detectedRepo: z.string().nullable().optional(),
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
        warning: z.string().optional(),
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
        warning: z.string().optional(),
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
        warning: z.string().optional(),
        error: z.string().optional(),
        requiresUserInput: z.boolean().optional(),
        instruction: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
