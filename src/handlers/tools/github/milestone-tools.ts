/**
 * GitHub Milestone Tools - 5 tools
 *
 * Tools: get_github_milestones, get_github_milestone,
 *        create_github_milestone, update_github_milestone, delete_github_milestone
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import { formatHandlerErrorResponse } from '../../../utils/error-helpers.js'
import {
    GitHubMilestonesListOutputSchema,
    GitHubMilestoneResultOutputSchema,
    CreateMilestoneOutputSchema,
    UpdateMilestoneOutputSchema,
    DeleteMilestoneOutputSchema,
} from './schemas.js'

// ============================================================================
// Helper: owner/repo resolution
// ============================================================================

async function resolveOwnerRepo(
    context: ToolContext,
    input: { owner?: string; repo?: string },
    entityLabel: string
): Promise<
    | {
          owner: string
          repo: string
          detectedOwner: string | null
          detectedRepo: string | null
          github: GitHubIntegration
      }
    | { error: true; response: Record<string, unknown> }
> {
    if (!context.github) {
        return { error: true, response: { error: 'GitHub integration not available' } }
    }

    const repoInfo = await context.github.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo
    const owner = input.owner ?? detectedOwner ?? undefined
    const repo = input.repo ?? detectedRepo ?? undefined

    if (!owner || !repo) {
        return {
            error: true,
            response: {
                error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                requiresUserInput: true,
                detectedOwner,
                detectedRepo,
                instruction: `Ask the user: "${entityLabel}"`,
            },
        }
    }

    return { owner, repo, detectedOwner, detectedRepo, github: context.github }
}

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
                        const total = ms.openIssues + ms.closedIssues
                        const completionPercentage =
                            total > 0 ? Math.round((ms.closedIssues / total) * 100) : 0
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
                    return formatHandlerErrorResponse(err)
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
                            owner: resolved.owner,
                            repo: resolved.repo,
                            detectedOwner: resolved.detectedOwner,
                            detectedRepo: resolved.detectedRepo,
                        }
                    }

                    const total = milestone.openIssues + milestone.closedIssues
                    const completionPercentage =
                        total > 0 ? Math.round((milestone.closedIssues / total) * 100) : 0

                    return {
                        milestone: { ...milestone, completionPercentage },
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
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
                        }
                    }

                    return {
                        success: true,
                        milestone: { ...milestone, completionPercentage: 0 },
                        message: `Created milestone #${String(milestone.number)}: ${milestone.title}`,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
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
                        }
                    }

                    const total = milestone.openIssues + milestone.closedIssues
                    const completionPercentage =
                        total > 0 ? Math.round((milestone.closedIssues / total) * 100) : 0

                    return {
                        success: true,
                        milestone: { ...milestone, completionPercentage },
                        message: `Updated milestone #${String(milestone.number)}: ${milestone.title}`,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
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
                        }
                    }

                    return {
                        success: true,
                        milestoneNumber: input.milestone_number,
                        message: `Deleted milestone #${String(input.milestone_number)}`,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
    ]
}
