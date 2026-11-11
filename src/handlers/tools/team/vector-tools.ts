/**
 * Team Vector Tools - 4 tools
 *
 * Tools: team_semantic_search, team_get_vector_index_stats,
 *        team_rebuild_vector_index, team_add_to_vector_index
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { logger } from '../../../utils/logger.js'
import { TEAM_DB_ERROR_RESPONSE, batchFetchAuthors, resolveTeamProjectNumber } from './helpers.js'
import {
    TeamSemanticSearchSchema,
    TeamSemanticSearchSchemaMcp,
    TeamSemanticSearchOutputSchema,
    TeamVectorStatsOutputSchema,
    TeamRebuildVectorIndexOutputSchema,
    TeamAddToVectorIndexSchema,
    TeamAddToVectorIndexSchemaMcp,
    TeamAddToVectorIndexOutputSchema,
} from './schemas.js'
import { passMetadataFilters } from '../search/helpers.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager/index.js'

// ============================================================================
// Constants
// ============================================================================

/** Quality floor — below this, results are treated as noise */
const QUALITY_FLOOR = 0.5

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamVectorTools(context: ToolContext): ToolDefinition[] {
    const { teamDb, teamVectorManager, progress } = context

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
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = TeamSemanticSearchSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const projectNumber =
                        resolveTeamProjectNumber(context, wsId, input.project_number) ?? undefined

                    if (!input.query && input.entry_id === undefined) {
                        return {
                            success: false,
                            error: 'Either query or entry_id must be provided',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Provide a text query for semantic search, or an entry_id to find related entries',
                            recoverable: true,
                        }
                    }

                    if (!teamVectorManager) {
                        return {
                            success: false,
                            error: 'Team vector search not available. Ensure TEAM_DB_PATH is configured and semantic search is enabled.',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: true,
                            query: input.query,
                        }
                    }

                    const hasFilters =
                        input.tags !== undefined ||
                        input.entry_type !== undefined ||
                        input.start_date !== undefined ||
                        input.end_date !== undefined ||
                        projectNumber !== undefined ||
                        input.issue_number !== undefined ||
                        input.pr_number !== undefined ||
                        input.workflow_run_id !== undefined

                    const internalLimit = hasFilters
                        ? Math.min(Math.max(input.limit * 10, 100), 1000)
                        : input.limit * 2

                    let results: SemanticSearchResult[]
                    if (input.entry_id !== undefined) {
                        results = await teamVectorManager.searchByEntryId(
                            input.entry_id,
                            internalLimit,
                            input.similarity_threshold ?? 0.25,
                            wsId
                        )
                    } else {
                        results = await teamVectorManager.search(
                            input.query ?? '',
                            internalLimit,
                            input.similarity_threshold ?? 0.25,
                            wsId
                        )
                    }

                    // Batch-fetch all entries (instead of N+1 getEntryById calls)
                    const entryIds = results.map((r) => r.entryId)
                    const entriesMap = teamDb.getEntriesByIds(entryIds, wsId)

                    // Batch-fetch authors
                    const authorMap = batchFetchAuthors(teamDb, entryIds)

                    // Pre-hydrate tags to avoid N+1 queries during metadata filtering
                    const tagsMap = teamDb.getTagsForEntries(entryIds)
                    for (const entry of entriesMap.values()) {
                        entry.tags = tagsMap.get(entry.id) ?? []
                    }

                    const entries = results
                        .map((r) => {
                            const entry = entriesMap.get(r.entryId)
                            if (!entry) return null
                            if (input.entry_id !== undefined && entry.id === input.entry_id)
                                return null

                            // Enforce tenant isolation
                            if (
                                projectNumber !== undefined &&
                                entry.projectNumber !== projectNumber
                            ) {
                                return null
                            }
                            if (wsId !== '*' && entry.workspaceId !== wsId) {
                                return null
                            }

                            // Apply filters
                            if (
                                !passMetadataFilters(
                                    entry,
                                    {
                                        tags: input.tags,
                                        entryType: input.entry_type,
                                        startDate: input.start_date,
                                        endDate: input.end_date,
                                        issueNumber: input.issue_number,
                                        prNumber: input.pr_number,
                                        workflowRunId: input.workflow_run_id,
                                        includeArchived: input.include_archived,
                                    },
                                    teamDb
                                )
                            ) {
                                return null
                            }

                            return {
                                ...entry,
                                author: authorMap.get(r.entryId) ?? null,
                                similarity: Math.round(r.score * 100) / 100,
                            }
                        })
                        .filter((e): e is NonNullable<typeof e> => e !== null)
                        .slice(0, input.limit)

                    const stats = teamVectorManager.getStats()
                    const isIndexEmpty = stats.itemCount === 0
                    const includeHint = input.hint_on_empty ?? true

                    const bestSimilarity = entries[0]?.similarity ?? 0
                    const allNoise = entries.length > 0 && bestSimilarity < QUALITY_FLOOR

                    const hint =
                        isIndexEmpty && includeHint
                            ? 'No entries in team vector index. Use team_rebuild_vector_index to index existing entries.'
                            : entries.length === 0 && includeHint
                              ? `No entries matched your query above the similarity threshold (${String(input.similarity_threshold ?? 0.25)}). Try lowering similarity_threshold (e.g., 0.15) for broader matches.`
                              : allNoise
                                ? `Results may be noise — best similarity (${String(bestSimilarity)}) is below quality floor (${String(QUALITY_FLOOR)}). Try a more specific query or raise similarity_threshold to filter weak matches.`
                                : undefined

                    return {
                        success: true,
                        query: input.query,
                        ...(input.entry_id !== undefined ? { entryId: input.entry_id } : {}),
                        entries,
                        count: entries.length,
                        ...(hint !== undefined ? { hint } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
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
                        return { available: false, error: TEAM_DB_ERROR_RESPONSE.error }
                    }

                    if (!teamVectorManager) {
                        return { available: false, error: 'Team vector search not available' }
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
            inputSchema: z.object({}).strict(),
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
            handler: async (_params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    if (!teamVectorManager) {
                        return {
                            success: false,
                            entriesIndexed: 0,
                            error: 'Team vector search not available',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: true,
                        }
                    }

                    const { success, indexed, failed, firstError } =
                        await teamVectorManager.rebuildIndex(progress)

                    if (!success && firstError) {
                        logger.warning(`Team vector index rebuild had errors: ${firstError}`)
                    }

                    return {
                        success,
                        entriesIndexed: indexed,
                        ...(failed > 0 ? { failedEntries: failed } : {}),
                        ...(!success
                            ? {
                                  error: firstError ?? 'All entries failed to generate embeddings',
                              }
                            : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
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
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, project_number, workspace_id } = TeamAddToVectorIndexSchema.parse(params)

                    if (!teamVectorManager) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: 'Team vector search not available',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: true,
                        }
                    }

                    let wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    let entry = teamDb.getEntryById(entry_id, wsId)
                    if (
                        !entry &&
                        workspace_id === undefined &&
                        project_number === undefined
                    ) {
                        entry = teamDb.getEntryById(entry_id, '*')
                        if (entry?.workspaceId !== undefined) {
                            wsId = entry.workspaceId
                        }
                    } else if (entry?.workspaceId !== undefined && (wsId === '*' || wsId === 'default')) {
                        wsId = entry.workspaceId
                    }
                    const projectNumber =
                        project_number ??
                        entry?.projectNumber ??
                        resolveTeamProjectNumber(context, wsId, project_number)
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }
                    if (entry?.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${String(projectNumber)}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    try {
                        await teamVectorManager.addEntry(entry)
                        return {
                            success: true,
                            entryId: entry_id,
                        }
                    } catch (err) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: err instanceof Error ? err.message : 'Failed to generate or store embedding'
                        }
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
