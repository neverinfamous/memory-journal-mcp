/**
 * Team Vector Tools - 4 tools
 *
 * Tools: team_semantic_search, team_get_vector_index_stats,
 *        team_rebuild_vector_index, team_add_to_vector_index
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE, batchFetchAuthors } from './helpers.js'
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
import type { SemanticSearchResult } from '../../../vector/vector-search-manager.js'

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
                'Perform semantic/vector search on team entries using AI embeddings. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamSemanticSearchSchemaMcp,
            outputSchema: TeamSemanticSearchOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = TeamSemanticSearchSchema.parse(params)

                    if (!input.query && input.entry_id === undefined) {
                        return {
                            success: false,
                            error: 'Either query or entry_id must be provided',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Provide a text query for semantic search, or an entry_id to find related entries',
                            recoverable: true,
                            entries: [],
                            count: 0,
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
                            entries: [],
                            count: 0,
                        }
                    }

                    const hasFilters =
                        input.tags !== undefined ||
                        input.entry_type !== undefined ||
                        input.start_date !== undefined ||
                        input.end_date !== undefined ||
                        input.project_number !== undefined

                    const internalLimit = hasFilters
                        ? Math.min(Math.max(input.limit * 10, 100), 1000)
                        : input.limit * 2

                    let results: SemanticSearchResult[]
                    if (input.entry_id !== undefined) {
                        results = await teamVectorManager.searchByEntryId(
                            input.entry_id,
                            internalLimit,
                            input.similarity_threshold ?? 0.25
                        )
                    } else {
                        results = await teamVectorManager.search(
                            input.query ?? '',
                            internalLimit,
                            input.similarity_threshold ?? 0.25
                        )
                    }

                    // Batch-fetch all entries (instead of N+1 getEntryById calls)
                    const entryIds = results.map((r) => r.entryId)
                    const entriesMap = teamDb.getEntriesByIds(entryIds)

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
                            if (entry.projectNumber !== input.project_number) {
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
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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
                'Rebuild the team semantic search vector index from all existing team entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: z.object({}).strict(),
            outputSchema: TeamRebuildVectorIndexOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
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

                    const { indexed, failed, firstError, partial } = await teamVectorManager.rebuildIndex(
                        teamDb,
                        progress
                    )
                    const success = indexed > 0 || failed === 0
                    return {
                        success,
                        partial,
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
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, project_number } = TeamAddToVectorIndexSchema.parse(params)

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

                    const entry = teamDb.getEntryById(entry_id)
                    if (entry?.projectNumber !== project_number) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${project_number}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const result = await teamVectorManager.addEntry(entry_id, entry.content)
                    return {
                        success: result.success,
                        entryId: entry_id,
                        ...(result.success
                            ? {}
                            : {
                                  error: result.error ?? 'Failed to generate or store embedding',
                              }),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
