/**
 * GitHub Milestone Tools - 5 tools
 *
 * Tools: get_github_milestones, get_github_milestone,
 *        create_github_milestone, update_github_milestone, delete_github_milestone
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { milestoneCompletionPct } from '../../resources/shared.js'
import {
    GitHubMilestonesListOutputSchema,
    GitHubMilestoneResultOutputSchema,
    CreateMilestoneOutputSchema,
    UpdateMilestoneOutputSchema,
    DeleteMilestoneOutputSchema,
} from './schemas.js'
import { resolveOwnerRepo } from './helpers.js'

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
            inputSchema: z.object({
                state: z
                    .string()
                    .optional()
                    .default('open')
                    .describe('Filter by state (default: open)'),
                limit: z
                    .number()
                    .optional()
                    .default(20)
                    .describe('Max milestones to return (default: 20)'),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            outputSchema: GitHubMilestonesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                            limit: z.number().optional().default(20),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'What GitHub repository should I list milestones for? Please provide the owner and repo name (e.g., owner/repo).'
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
                        return { ...ms, completionPercentage }
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
            inputSchema: z.object({
                milestone_number: z.number().describe('Milestone number'),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            outputSchema: GitHubMilestoneResultOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            milestone_number: z.number(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'What GitHub repository is this milestone from? Please provide the owner and repo name (e.g., owner/repo).'
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
                        milestone: { ...milestone, completionPercentage },
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
            inputSchema: z.object({
                title: z.string().min(1).describe('Milestone title'),
                description: z.string().optional().describe('Milestone description'),
                due_on: z.string().optional().describe('Due date in YYYY-MM-DD format (optional)'),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: CreateMilestoneOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            title: z.string().min(1),
                            description: z.string().optional(),
                            due_on: z.string().optional(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'What GitHub repository should I create the milestone in?'
                    )
                    if ('error' in resolved) return resolved.response

                    const dueOn = input.due_on ? `${input.due_on}T08:00:00Z` : undefined
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
                        milestone: { ...milestone, completionPercentage: 0 },
                        message: `Created milestone #${String(milestone.number)}: ${milestone.title}`,
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
            inputSchema: z.object({
                milestone_number: z.number().describe('Milestone number to update'),
                title: z.string().optional().describe('New title'),
                description: z.string().optional().describe('New description'),
                due_on: z.string().optional().describe('New due date in YYYY-MM-DD format'),
                state: z.string().optional().describe('Set to "closed" to close the milestone'),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: UpdateMilestoneOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            milestone_number: z.number(),
                            title: z.string().optional(),
                            description: z.string().optional(),
                            due_on: z.string().optional(),
                            state: z.enum(['open', 'closed']).optional(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'What GitHub repository is this milestone in?'
                    )
                    if ('error' in resolved) return resolved.response

                    const dueOn = input.due_on ? `${input.due_on}T08:00:00Z` : undefined
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
                            suggestion: 'Verify the milestone exists and GITHUB_TOKEN has repo scope.',
                            recoverable: true,
                        }
                    }

                    const completionPercentage = milestoneCompletionPct(
                        milestone.openIssues,
                        milestone.closedIssues
                    )

                    return {
                        success: true,
                        milestone: { ...milestone, completionPercentage },
                        message: `Updated milestone #${String(milestone.number)}: ${milestone.title}`,
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
            inputSchema: z.object({
                milestone_number: z.number().describe('Milestone number to delete'),
                confirm: z.literal(true).describe('Must be set to true to confirm deletion'),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: DeleteMilestoneOutputSchema,
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                destructiveHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            milestone_number: z.number(),
                            confirm: z.literal(true),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(
                        context,
                        input,
                        'What GitHub repository is this milestone in?'
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
                            suggestion: 'Verify the milestone exists and GITHUB_TOKEN has repo scope.',
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
