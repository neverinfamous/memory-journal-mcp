/**
 * Search Tool Group - 4 tools
 *
 * Tools: search_entries, search_by_date_range, semantic_search, get_vector_index_stats
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
    EntriesListOutputSchema,
} from './schemas.js'

// ============================================================================
// Input Schemas
// ============================================================================

const SearchEntriesSchema = z.object({
    query: z.string().optional(),
    limit: z.number().optional().default(10),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
})

const SearchByDateRangeSchema = z.object({
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.array(z.string()).optional(),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    workflow_run_id: z.number().optional(),
})

const SemanticSearchSchema = z.object({
    query: z.string(),
    limit: z.number().optional().default(10),
    similarity_threshold: z.number().optional().default(0.25),
    is_personal: z.boolean().optional(),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
})

// ============================================================================
// Output Schemas
// ============================================================================

const SemanticEntryOutputSchema = EntryOutputSchema.extend({
    similarity: z.number(),
})

const SemanticSearchOutputSchema = z.object({
    query: z.string(),
    entries: z.array(SemanticEntryOutputSchema),
    count: z.number(),
    hint: z.string().optional(),
    error: z.string().optional(),
})

const VectorStatsOutputSchema = z.object({
    available: z.boolean(),
    error: z.string().optional(),
    entryCount: z.number().optional(),
    indexSize: z.number().optional(),
})

// ============================================================================
// Tool Definitions
// ============================================================================

export function getSearchTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager } = context
    return [
        {
            name: 'search_entries',
            title: 'Search Entries',
            description:
                'Search journal entries with optional filters for GitHub Projects, Issues, PRs, and Actions',
            group: 'search',
            inputSchema: SearchEntriesSchema,
            outputSchema: EntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const input = SearchEntriesSchema.parse(params)
                    const hasFilters =
                        input.project_number !== undefined ||
                        input.issue_number !== undefined ||
                        input.pr_number !== undefined ||
                        input.is_personal !== undefined

                    if (!input.query && !hasFilters) {
                        const entries = db.getRecentEntries(input.limit, input.is_personal)
                        return { entries, count: entries.length }
                    }

                    const entries = db.searchEntries(input.query || '', {
                        limit: input.limit,
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                        issueNumber: input.issue_number,
                        prNumber: input.pr_number,
                    })
                    return { entries, count: entries.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'search_by_date_range',
            title: 'Search by Date Range',
            description: 'Search journal entries within a date range with optional filters',
            group: 'search',
            inputSchema: SearchByDateRangeSchema,
            outputSchema: EntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const input = SearchByDateRangeSchema.parse(params)
                    const entries = db.searchByDateRange(input.start_date, input.end_date, {
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                    })
                    return { entries, count: entries.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'semantic_search',
            title: 'Semantic Search',
            description: 'Perform semantic/vector search on journal entries using AI embeddings',
            group: 'search',
            inputSchema: SemanticSearchSchema,
            outputSchema: SemanticSearchOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = SemanticSearchSchema.parse(params)

                    if (!vectorManager) {
                        return {
                            success: false,
                            error: 'Semantic search not initialized. Vector search manager is not available.',
                            query: input.query,
                            entries: [],
                            count: 0,
                        }
                    }

                    const results = await vectorManager.search(
                        input.query,
                        input.limit ?? 10,
                        input.similarity_threshold ?? 0.25
                    )

                    const entries = results
                        .map((r) => {
                            const entry = db.getEntryById(r.entryId)
                            if (!entry) return null
                            return {
                                ...entry,
                                similarity: Math.round(r.score * 100) / 100,
                            }
                        })
                        .filter((e): e is NonNullable<typeof e> => e !== null)

                    const stats = await vectorManager.getStats()
                    const isIndexEmpty = stats.itemCount === 0
                    const includeHint = input.hint_on_empty ?? true

                    return {
                        query: input.query,
                        entries,
                        count: entries.length,
                        ...(includeHint && isIndexEmpty
                            ? {
                                  hint: 'No entries in vector index. Use rebuild_vector_index to index existing entries.',
                              }
                            : includeHint && entries.length === 0
                              ? {
                                    hint: `No entries matched your query above the similarity threshold (${String(input.similarity_threshold ?? 0.25)}). Try lowering similarity_threshold (e.g., 0.15) for broader matches.`,
                                }
                              : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_vector_index_stats',
            title: 'Get Vector Index Stats',
            description: 'Get statistics about the semantic search vector index',
            group: 'search',
            inputSchema: z.object({}),
            outputSchema: VectorStatsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: async (_params: unknown) => {
                try {
                    if (!vectorManager) {
                        return { available: false, error: 'Vector search not available' }
                    }
                    const stats = await vectorManager.getStats()
                    return { available: true, ...stats }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
