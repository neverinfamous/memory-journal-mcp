/**
 * GitHub Milestone Tools - 5 tools
 *
 * Tools: get_github_milestones, get_github_milestone,
 *        create_github_milestone, update_github_milestone, delete_github_milestone
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { milestoneCompletionPct, fenceUntrustedInline } from '../../resources/shared.js'
import { markUntrustedContent } from '../../../utils/security-utils.js'

function fenceMilestone<
    T extends { title: string; description?: string | null; creator?: string | null },
>(ms: T): T {
    return {
        ...ms,
        title: fenceUntrustedInline(ms.title),
        ...(ms.description !== undefined && ms.description !== null
            ? { description: markUntrustedContent(ms.description) }
            : {}),
        ...(ms.creator !== undefined && ms.creator !== null
            ? { creator: fenceUntrustedInline(ms.creator) }
            : {}),
    }
}
import { relaxedNumber } from '../schemas.js'
import {
    GitHubMilestonesListOutputSchema,
    GitHubMilestoneResultOutputSchema,
    CreateMilestoneOutputSchema,
    UpdateMilestoneOutputSchema,
    DeleteMilestoneOutputSchema,
} from './schemas.js'
import { githubScopeInputFields, githubScopeParseFields, resolveOwnerRepo } from './helpers.js'

const MilestonesListSchemaMcp = z.object({
    ...githubScopeInputFields,
    state: z.string().optional().default('open').describe('Filter by state (default: open)'),
    limit: relaxedNumber().optional().default(20).describe('Max milestones to return (default: 20)'),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
})
const MilestonesListSchema = z.object({
    state: z.enum(['open', 'closed', 'all']).optional().default('open'),
    limit: z.number().int().min(1).max(100).optional().default(20),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
}).strict()
const MilestoneGetSchemaMcp = z.object({
    ...githubScopeInputFields,
    milestone_number: relaxedNumber().optional().describe('Milestone number'),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
})
const MilestoneGetSchema = z.object({
    milestone_number: z.number().int().positive(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
}).strict()
const MilestoneCreateSchemaMcp = z.object({
    ...githubScopeInputFields,
    title: z.string().optional().describe('Milestone title'),
    description: z.string().optional().describe('Milestone description'),
    due_on: z.string().optional().describe('Due date in YYYY-MM-DD format (optional)'),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
})
const MilestoneCreateSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    due_on: z.string().nullable().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
}).strict()
const MilestoneUpdateSchemaMcp = z.object({
    ...githubScopeInputFields,
    milestone_number: relaxedNumber().optional().describe('Milestone number to update'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    due_on: z.string().nullable().optional().describe('New due date in YYYY-MM-DD format (or null to clear)'),
    state: z.string().optional().describe('Set to "closed" to close the milestone'),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
})
const MilestoneUpdateSchema = z.object({
    milestone_number: z.number().int().positive(),
    title: z.string().optional(),
    description: z.string().optional(),
    due_on: z.string().nullable().optional(),
    state: z.enum(['open', 'closed']).optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
}).strict()
const MilestoneDeleteSchemaMcp = z.object({
    ...githubScopeInputFields,
    milestone_number: relaxedNumber().optional().describe('Milestone number to delete'),
    confirm: z.boolean().optional().describe('Must be set to true to confirm deletion'),
    owner: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
    repo: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
})
const MilestoneDeleteSchema = z.object({
    milestone_number: z.number().int().positive(),
    confirm: z.literal(true),
    owner: z.string().optional(),
    repo: z.string().optional(),
    ...githubScopeParseFields,
}).strict()

// ============================================================================
// Tool Definitions
// ============================================================================

export function getGitHubMilestoneTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_github_milestones',
            title: 'List GitHub Milestones',
            description:
                'List GitHub milestones for the repository with completion percentages and due dates.',
            group: 'github',
            inputSchema: MilestonesListSchemaMcp,
            outputSchema: GitHubMilestonesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = MilestonesListSchema.parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'should I list milestones for'
                    )
                    if ('error' in resolved) return resolved.response

                    const milestones = await resolved.github.getMilestones(
                        resolved.owner,
                        resolved.repo,
                        input.state,
                        input.limit
                    )
                    const milestonesWithPercentage = milestones.map((ms) => {
                        const completionPercentage = milestoneCompletionPct(
                            ms.openIssues,
                            ms.closedIssues
                        )
                        return fenceMilestone({ ...ms, completionPercentage })
                    })

                    return {
                        milestones: milestonesWithPercentage,
                        count: milestonesWithPercentage.length,
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_github_milestone',
            title: 'Get GitHub Milestone Details',
            description:
                'Get detailed information about a specific GitHub milestone including progress and linked issue counts.',
            group: 'github',
            inputSchema: MilestoneGetSchemaMcp,
            outputSchema: GitHubMilestoneResultOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = MilestoneGetSchema.parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'is this milestone in'
                    )
                    if ('error' in resolved) return resolved.response

                    const milestone = await resolved.github.getMilestone(
                        resolved.owner,
                        resolved.repo,
                        input.milestone_number
                    )
                    if (!milestone) {
                        return {
                            success: false,
                            error: `Milestone #${String(input.milestone_number)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the milestone number exists in this repository.',
                            recoverable: true,
                            owner: resolved.owner,
                            repo: resolved.repo,
                            detectedOwner: resolved.detectedOwner,
                            detectedRepo: resolved.detectedRepo,
                        }
                    }

                    const completionPercentage = milestoneCompletionPct(
                        milestone.openIssues,
                        milestone.closedIssues
                    )

                    return {
                        milestone: fenceMilestone({ ...milestone, completionPercentage }),
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'create_github_milestone',
            title: 'Create GitHub Milestone',
            description:
                'Create a new GitHub milestone for tracking progress toward a project goal.',
            group: 'github',
            inputSchema: MilestoneCreateSchemaMcp,
            outputSchema: CreateMilestoneOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = MilestoneCreateSchema.parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'should I create this milestone in'
                    )
                    if ('error' in resolved) return resolved.response

                    const dueOn =
                        input.due_on !== null && input.due_on !== undefined && input.due_on !== ''
                            ? input.due_on.includes('T')
                                ? input.due_on
                                : `${input.due_on}T08:00:00Z`
                            : undefined
                    const milestone = await resolved.github.createMilestone(
                        resolved.owner,
                        resolved.repo,
                        input.title,
                        input.description,
                        dueOn
                    )

                    if (!milestone) {
                        return {
                            success: false,
                            error: 'Failed to create milestone. Check GITHUB_TOKEN permissions.',
                            code: 'GITHUB_API_ERROR',
                            category: 'github',
                            suggestion: 'Verify GITHUB_TOKEN has repo scope and try again.',
                            recoverable: true,
                        }
                    }

                    return {
                        success: true,
                        milestone: fenceMilestone({ ...milestone, completionPercentage: 0 }),
                        message: `Created milestone #${String(milestone.number)}: ${fenceUntrustedInline(milestone.title)}`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'update_github_milestone',
            title: 'Update GitHub Milestone',
            description:
                'Update a GitHub milestone (title, description, due date, or state). Use state "closed" to close a completed milestone.',
            group: 'github',
            inputSchema: MilestoneUpdateSchemaMcp,
            outputSchema: UpdateMilestoneOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = MilestoneUpdateSchema.parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'should I update this milestone in'
                    )
                    if ('error' in resolved) return resolved.response

                    const dueOn =
                        input.due_on === null
                            ? null
                            : input.due_on !== undefined && input.due_on !== ''
                              ? input.due_on.includes('T')
                                  ? input.due_on
                                  : `${input.due_on}T08:00:00Z`
                              : undefined
                    const milestone = await resolved.github.updateMilestone(
                        resolved.owner,
                        resolved.repo,
                        input.milestone_number,
                        {
                            title: input.title,
                            description: input.description,
                            dueOn,
                            state: input.state,
                        }
                    )

                    if (!milestone) {
                        return {
                            success: false,
                            error: `Failed to update milestone #${String(input.milestone_number)}. Check that it exists and GITHUB_TOKEN has permissions.`,
                            code: 'GITHUB_API_ERROR',
                            category: 'github',
                            suggestion:
                                'Verify the milestone exists and GITHUB_TOKEN has repo scope.',
                            recoverable: true,
                        }
                    }

                    const completionPercentage = milestoneCompletionPct(
                        milestone.openIssues,
                        milestone.closedIssues
                    )

                    return {
                        success: true,
                        milestone: fenceMilestone({ ...milestone, completionPercentage }),
                        message: `Updated milestone #${String(milestone.number)}: ${fenceUntrustedInline(milestone.title)}`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'delete_github_milestone',
            title: 'Delete GitHub Milestone',
            description:
                'Permanently delete a GitHub milestone. Issues assigned to the milestone will be un-assigned but not deleted.',
            group: 'github',
            inputSchema: MilestoneDeleteSchemaMcp,
            outputSchema: DeleteMilestoneOutputSchema,
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                destructiveHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = MilestoneDeleteSchema.parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'should I delete this milestone from'
                    )
                    if ('error' in resolved) return resolved.response

                    const result = await resolved.github.deleteMilestone(
                        resolved.owner,
                        resolved.repo,
                        input.milestone_number
                    )

                    if (!result.success) {
                        return {
                            success: false,
                            milestoneNumber: input.milestone_number,
                            message: `Failed to delete milestone #${String(input.milestone_number)}`,
                            error: result.error ?? undefined,
                            code: 'GITHUB_API_ERROR',
                            category: 'github',
                            suggestion:
                                'Verify the milestone exists and GITHUB_TOKEN has repo scope.',
                            recoverable: true,
                        }
                    }

                    return {
                        success: true,
                        milestoneNumber: input.milestone_number,
                        message: `Deleted milestone #${String(input.milestone_number)}`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
