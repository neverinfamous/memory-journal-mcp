/**
 * GitHub Kanban Tools - 2 tools
 *
 * Tools: get_kanban_board, move_kanban_item
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { KanbanBoardOutputSchema, MoveKanbanItemOutputSchema } from './schemas.js'
import { resolveOwner } from './helpers.js'

export function getKanbanTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_kanban_board',
            title: 'Get Kanban Board',
            description:
                'View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.',
            group: 'github',
            inputSchema: z.object({
                project_number: z.number().describe('GitHub Project number'),
                owner: z.string().optional().describe('Project owner - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: KanbanBoardOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.number(),
                            owner: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwner(context, input.owner)
                    if ('error' in resolved) return resolved.response

                    const board = await resolved.github.getProjectKanban(
                        resolved.owner,
                        input.project_number,
                        resolved.repo
                    )

                    if (!board) {
                        return {
                            success: false,
                            error: `Project #${String(input.project_number)} not found or Status field not configured`,
                            projectNumber: input.project_number,
                            owner: resolved.owner,
                            hint: 'Projects can be at user, repository, or organization level.',
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the project number and owner. Use GitHub to check project settings.',
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
                project_number: z.number().describe('GitHub Project number'),
                item_id: z.string().describe('Project item ID (from get_kanban_board)'),
                target_status: z
                    .string()
                    .describe('Target status column name (e.g., "In Progress", "Done")'),
                owner: z.string().optional().describe('Project owner - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: MoveKanbanItemOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.number(),
                            item_id: z.string(),
                            target_status: z.string(),
                            owner: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwner(context, input.owner)
                    if ('error' in resolved) return resolved.response

                    const board = await resolved.github.getProjectKanban(
                        resolved.owner,
                        input.project_number,
                        resolved.repo
                    )

                    if (!board) {
                        return {
                            success: false,
                            error: `Project #${String(input.project_number)} not found`,
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
                        newStatus: statusOption.name,
                        error: result.error,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
