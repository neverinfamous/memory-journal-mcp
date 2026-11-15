/**
 * Team Vector Tools - 4 tools
 *
 * Tools: team_semantic_search, team_get_vector_index_stats,
 *        team_rebuild_vector_index, team_add_to_vector_index
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { relaxedNumber } from '../schemas.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import {
    TeamSemanticSearchSchemaMcp,
    TeamSemanticSearchOutputSchema,
    TeamVectorStatsOutputSchema,
    TeamRebuildVectorIndexOutputSchema,
    TeamAddToVectorIndexSchemaMcp,
    TeamAddToVectorIndexOutputSchema,
} from './schemas.js'
import {
    executeTeamAddToVectorIndex,
    executeTeamRebuildVectorIndex,
    executeTeamSemanticSearch,
} from './vector-helpers.js'

export function getTeamVectorTools(context: ToolContext): ToolDefinition[] {
    const { teamDb, teamVectorManager } = context

    return [
        {
            name: 'team_semantic_search',
            title: 'Team Semantic Search',
            description:
                'Perform semantic/vector search on team entries using AI embeddings. Supports find-related-by-ID (entry_id) and metadata filters. Threshold default is 0.25 (try 0.15-0.2 for broader matches, 0.4+ for strict matches). Entries auto-indexed on creation. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamSemanticSearchSchemaMcp,
            outputSchema: TeamSemanticSearchOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => executeTeamSemanticSearch(context, params),
        },
        {
            name: 'team_get_vector_index_stats',
            title: 'Team Vector Index Stats',
            description:
                'Get statistics about the team vector search index (item count, model, dimensions). Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: z.object({}).strict(),
            outputSchema: TeamVectorStatsOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (_params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, available: false, error: TEAM_DB_ERROR_RESPONSE.error }
                    }

                    if (!teamVectorManager) {
                        return { success: false, available: false, error: 'Team vector search not available' }
                    }

                    const stats = teamVectorManager.getStats()
                    return {
                        success: true,
                        available: true,
                        itemCount: stats.itemCount,
                        modelName: stats.modelName,
                        dimensions: stats.dimensions,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_rebuild_vector_index',
            title: 'Rebuild Team Vector Index',
            description:
                'Rebuild the team semantic search vector index from all existing team entries. Requires TEAM_DB_PATH. [REQUIRES ADMIN SCOPE]',
            group: 'team',
            inputSchema: z
                .object({ workspace_id: z.string().optional(), project_number: relaxedNumber().optional() })
                .strict(),
            outputSchema: TeamRebuildVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            capabilities: {
                requiresAdminScope: true,
            },
            handler: async (params: unknown) => executeTeamRebuildVectorIndex(context, params),
        },
        {
            name: 'team_add_to_vector_index',
            title: 'Add Team Entry to Vector Index',
            description:
                'Add a specific team entry to the semantic search vector index. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamAddToVectorIndexSchemaMcp,
            outputSchema: TeamAddToVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => executeTeamAddToVectorIndex(context, params),
        },
    ]
}
