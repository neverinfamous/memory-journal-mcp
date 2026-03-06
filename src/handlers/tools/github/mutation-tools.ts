/**
 * GitHub Mutation Tools - Barrel file
 *
 * Composes kanban tools and issue tools into a single export
 * for backward compatibility with existing imports.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getKanbanTools } from './kanban-tools.js'
import { getGitHubIssueTools } from './issue-tools.js'

/**
 * Get all GitHub mutation tools (kanban + issue management)
 */
export function getGitHubMutationTools(context: ToolContext): ToolDefinition[] {
    return [...getKanbanTools(context), ...getGitHubIssueTools(context)]
}
