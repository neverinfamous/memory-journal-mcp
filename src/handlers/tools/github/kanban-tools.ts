/**
 * GitHub Kanban Tools - 2 tools
 *
 * Tools: get_kanban_board, move_kanban_item
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { relaxedNumber } from '../schemas.js'
import {
    KanbanBoardOutputSchema,
    MoveKanbanItemOutputSchema,
    AddKanbanItemOutputSchema,
    DeleteKanbanItemOutputSchema,
} from './schemas.js'
import { githubScopeInputFields } from './helpers.js'
import {
    handleAddKanbanItem,
    handleDeleteKanbanItem,
    handleGetKanbanBoard,
    handleMoveKanbanItem,
} from './kanban-helpers.js'

export function getKanbanTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_kanban_board',
            title: 'Get Kanban Board',
            description:
                'View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.',
            group: 'github',
            inputSchema: z.object({
                ...githubScopeInputFields,
                project_number: relaxedNumber()
                    .optional()
                    .describe('GitHub Project number (optional if repo is registered)'),
                owner: z.string().optional().describe('Project owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
                summary_only: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe(
                        'Return column summaries only (name + itemCount), omitting individual items. Saves ~80% tokens.'
                    ),
                item_limit: z.number().int().min(0).max(100)
                    .optional()
                    .default(25)
                    .describe(
                        'Maximum items per column (default 25, max 100). Set to 0 for summary_only behavior.'
                    ),
            }),
            outputSchema: KanbanBoardOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: (params: unknown) => handleGetKanbanBoard(context, params),
        },
        {
            name: 'move_kanban_item',
            title: 'Move Kanban Item',
            description:
                'Move a Kanban item to a different status column. Requires the project board to have a Status field.',
            group: 'github',
            inputSchema: z.object({
                ...githubScopeInputFields,
                project_number: relaxedNumber()
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
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: (params: unknown) => handleMoveKanbanItem(context, params),
        },
        {
            name: 'add_kanban_item',
            title: 'Add Kanban Item',
            description:
                'Add an existing GitHub Issue or Pull Request to a Kanban board (GitHub Project v2). Returns the project item ID on success.',
            group: 'github',
            inputSchema: z.object({
                ...githubScopeInputFields,
                project_number: relaxedNumber()
                    .optional()
                    .describe('GitHub Project number (optional if repo is registered)'),
                issue_number: relaxedNumber()
                    .optional()
                    .describe('The number of the issue or PR to add'),
                owner: z
                    .string()
                    .optional()
                    .describe('Repository owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: AddKanbanItemOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: (params: unknown) => handleAddKanbanItem(context, params),
        },
        {
            name: 'delete_kanban_item',
            title: 'Delete Kanban Item',
            description:
                'Remove an item from a GitHub Kanban board cleanly. This untethers it from the project but does NOT close or delete the underlying Issue/PR.',
            group: 'github',
            inputSchema: z.object({
                ...githubScopeInputFields,
                project_number: relaxedNumber()
                    .optional()
                    .describe('GitHub Project number (optional if repo is registered)'),
                item_id: z
                    .string()
                    .describe('The project item ID to remove (from get_kanban_board)'),
                owner: z.string().optional().describe('Project owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: DeleteKanbanItemOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: (params: unknown) => handleDeleteKanbanItem(context, params),
        },
    ]
}
