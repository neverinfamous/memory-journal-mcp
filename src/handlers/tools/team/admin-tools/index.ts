/**
 * Team Admin Tools barrel — 7 tools
 *
 * Composes CRUD tools (update, delete, restore, merge_tags)
 * and batch tools (batch_create, batch_update, batch_delete).
 */

import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { getTeamAdminCrudTools } from './crud.js'
import { getTeamAdminBatchTools } from './batch.js'

export function getTeamAdminTools(context: ToolContext): ToolDefinition[] {
    return [...getTeamAdminCrudTools(context), ...getTeamAdminBatchTools(context)]
}
