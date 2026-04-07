/**
 * GitHub Kanban Tools - 2 tools
 *
 * Tools: get_kanban_board, move_kanban_item
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { KanbanBoardOutputSchema, MoveKanbanItemOutputSchema } from './schemas.js'
import { resolveOwner, resolveProjectNumber } from './helpers.js'

export function getKanbanTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_kanban_board',
            title: 'Get Kanban Board',
            description:
                'View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.',
            group: 'github',
            inputSchema: z.object({
                project_number: z
                    .number()
                    .optional()
                    .describe('GitHub Project number (optional if repo is registered)'),
                owner: z.string().optional().describe('Project owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: KanbanBoardOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.number().optional(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwner(context, input.owner)
                    if ('error' in resolved) return resolved.response

                    // Fallback to explicit repo param if auto-detect failed (resolveOwner uses getRepoInfo)
                    const effectiveRepo = input.repo ?? resolved.repo
                    const projectNum = resolveProjectNumber(
                        context,
                        effectiveRepo,
                        input.project_number
                    )

                    if (projectNum === undefined) {
                        return {
                            success: false,
                            error: 'project_number is required and could not be resolved from registry. Please supply it explicitly.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                            requiresUserInput: true,
                            instruction:
                                'Ask the user: "What is the GitHub Project number for this repository? (Usually found in the URL: projects/<number>)"',
                        }
                    }

                    const board = await resolved.github.getProjectKanban(
                        resolved.owner,
                        projectNum,
                        effectiveRepo
                    )

                    if (!board) {
                        return {
                            success: false,
                            error: `Project #${String(projectNum)} not found or Status field not configured`,
                            projectNumber: projectNum,
                            owner: resolved.owner,
                            hint: 'Projects can be at user, repository, or organization level.',
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the project number and owner. Use GitHub to check project settings.',
                            recoverable: true,
                        }
                    }

                    return board
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'move_kanban_item',
            title: 'Move Kanban Item',
            description:
                'Move a Kanban item to a different status column. Requires the project board to have a Status field.',
            group: 'github',
            inputSchema: z.object({
                project_number: z
                    .number()
                    .optional()
                    .describe('GitHub Project number (optional if repo is registered)'),
                item_id: z.string().describe('Project item ID (from get_kanban_board)'),
                target_status: z
                    .string()
                    .describe('Target status column name (e.g., "In Progress", "Done")'),
                owner: z.string().optional().describe('Project owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: MoveKanbanItemOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.number().optional(),
                            item_id: z.string(),
                            target_status: z.string(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwner(context, input.owner)
                    if ('error' in resolved) return resolved.response

                    const effectiveRepo = input.repo ?? resolved.repo
                    const projectNum = resolveProjectNumber(
                        context,
                        effectiveRepo,
                        input.project_number
                    )

                    if (projectNum === undefined) {
                        return {
                            success: false,
                            error: 'project_number is required and could not be resolved from registry. Please supply it explicitly.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                        }
                    }

                    const board = await resolved.github.getProjectKanban(
                        resolved.owner,
                        projectNum,
                        effectiveRepo
                    )

                    if (!board) {
                        return {
                            success: false,
                            error: `Project #${String(projectNum)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the project number and owner.',
                            recoverable: true,
                        }
                    }

                    // Find target status option
                    const statusOption = board.statusOptions.find(
                        (opt) => opt.name.toLowerCase() === input.target_status.toLowerCase()
                    )

                    if (!statusOption) {
                        return {
                            success: false,
                            error: `Status "${input.target_status}" not found`,
                            availableStatuses: board.statusOptions.map((o) => o.name),
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Use one of the available status column names.',
                            recoverable: true,
                        }
                    }

                    const result = await resolved.github.moveProjectItem(
                        board.projectId,
                        input.item_id,
                        board.statusFieldId,
                        statusOption.id
                    )

                    return {
                        success: result.success,
                        itemId: input.item_id,
                        newStatus: statusOption.name,
                        projectNumber: projectNum,
                        message: result.success
                            ? `Moved item to "${statusOption.name}"`
                            : undefined,
                        error: result.error,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
