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

/** Strict schema — used inside handler for structured Zod errors */
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

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
const SearchEntriesSchemaMcp = z.object({
    query: z.string().optional(),
    limit: z.number().optional().default(10),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    pr_status: z.string().optional(),
    workflow_run_id: z.number().optional(),
})

/** Strict schema — used inside handler for structured Zod errors */
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

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const SearchByDateRangeSchemaMcp = z.object({
    start_date: z.string(),
    end_date: z.string(),
    entry_type: z.string().optional(),
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
    query: z.string().optional(),
    entries: z.array(SemanticEntryOutputSchema).optional(),
    count: z.number().optional(),
    hint: z.string().optional(),
    success: z.boolean().optional(),
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
    const { db, teamDb, vectorManager } = context
    return [
        {
            name: 'search_entries',
            title: 'Search Entries',
            description:
                'Search journal entries with optional filters for GitHub Projects, Issues, PRs, and Actions',
            group: 'search',
            inputSchema: SearchEntriesSchemaMcp,
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

                    let personalEntries
                    if (!input.query && !hasFilters) {
                        personalEntries = db.getRecentEntries(input.limit, input.is_personal)
                    } else {
                        personalEntries = db.searchEntries(input.query || '', {
                            limit: input.limit,
                            isPersonal: input.is_personal,
                            projectNumber: input.project_number,
                            issueNumber: input.issue_number,
                            prNumber: input.pr_number,
                        })
                    }

                    // Cross-database merge when team DB is available
                    if (teamDb) {
                        let teamEntries
                        if (!input.query && !hasFilters) {
                            teamEntries = teamDb.getRecentEntries(input.limit)
                        } else {
                            teamEntries = teamDb.searchEntries(input.query || '', {
                                limit: input.limit,
                                projectNumber: input.project_number,
                                issueNumber: input.issue_number,
                                prNumber: input.pr_number,
                            })
                        }
                        const merged = mergeAndDedup(
                            personalEntries.map((e) => ({ ...e, source: 'personal' as const })),
                            teamEntries.map((e) => ({ ...e, source: 'team' as const })),
                            input.limit
                        )
                        return { entries: merged, count: merged.length }
                    }

                    return { entries: personalEntries, count: personalEntries.length }
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
            inputSchema: SearchByDateRangeSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const input = SearchByDateRangeSchema.parse(params)
                    const personalEntries = db.searchByDateRange(input.start_date, input.end_date, {
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                    })

                    // Cross-database merge when team DB is available
                    if (teamDb) {
                        const teamEntries = teamDb.searchByDateRange(
                            input.start_date,
                            input.end_date,
                            {
                                entryType: input.entry_type,
                                tags: input.tags,
                                projectNumber: input.project_number,
                            }
                        )
                        const merged = mergeAndDedup(
                            personalEntries.map((e) => ({ ...e, source: 'personal' as const })),
                            teamEntries.map((e) => ({ ...e, source: 'team' as const }))
                        )
                        return { entries: merged, count: merged.length }
                    }

                    return { entries: personalEntries, count: personalEntries.length }
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

// ============================================================================
// Helpers
// ============================================================================

interface EntryWithSource {
    content: string
    timestamp: string
    source: 'personal' | 'team'
    [key: string]: unknown
}

/**
 * Merge personal and team results, deduplicate by content,
 * and sort by timestamp descending.
 */
function mergeAndDedup(
    personal: EntryWithSource[],
    team: EntryWithSource[],
    limit?: number
): EntryWithSource[] {
    const seen = new Set<string>()
    const merged: EntryWithSource[] = []

    // Concat and sort by timestamp descending
    const all = [...personal, ...team].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    for (const entry of all) {
        // Deduplicate by content (same entry shared to team)
        const key = entry.content.slice(0, 200)
        if (!seen.has(key)) {
            seen.add(key)
            merged.push(entry)
        }
    }

    return limit !== undefined ? merged.slice(0, limit) : merged
}
