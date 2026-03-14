/**
 * Search Tool Group - 4 tools
 *
 * Tools: search_entries, search_by_date_range, semantic_search, get_vector_index_stats
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
    EntriesListOutputSchema,
    relaxedNumber,
} from './schemas.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
const SearchEntriesSchema = z.object({
    query: z.string().optional(),
    limit: z.number().max(500).optional().default(10),
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
    limit: relaxedNumber().optional().default(10),
    is_personal: z.boolean().optional(),
    project_number: relaxedNumber().optional(),
    issue_number: relaxedNumber().optional(),
    pr_number: relaxedNumber().optional(),
    pr_status: z.string().optional(),
    workflow_run_id: relaxedNumber().optional(),
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
    limit: z.number().max(500).optional().default(500),
})

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const SearchByDateRangeSchemaMcp = z.object({
    start_date: z.string(),
    end_date: z.string(),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    is_personal: z.boolean().optional(),
    project_number: relaxedNumber().optional(),
    issue_number: relaxedNumber().optional(),
    pr_number: relaxedNumber().optional(),
    workflow_run_id: relaxedNumber().optional(),
    limit: relaxedNumber().optional().default(500),
})

/** Strict schema — used inside handler for structured Zod errors */
const SemanticSearchSchema = z.object({
    query: z.string(),
    limit: z.number().max(500).optional().default(10),
    similarity_threshold: z.number().optional().default(0.25),
    is_personal: z.boolean().optional(),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
})

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
const SemanticSearchSchemaMcp = z.object({
    query: z.string(),
    limit: relaxedNumber().optional().default(10),
    similarity_threshold: relaxedNumber().optional().default(0.25),
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

const SemanticSearchOutputSchema = z
    .object({
        query: z.string().optional(),
        entries: z.array(SemanticEntryOutputSchema).optional(),
        count: z.number().optional(),
        hint: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const VectorStatsOutputSchema = z
    .object({
        available: z.boolean(),
        error: z.string().optional(),
        itemCount: z.number().optional(),
        modelName: z.string().optional(),
        dimensions: z.number().optional(),
        success: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

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
                'Full-text search journal entries using FTS5 (supports phrases "exact match", prefix auth*, boolean NOT/OR/AND, ranked by relevance). Optional filters for GitHub Projects, Issues, PRs, and Actions.',
            group: 'search',
            inputSchema: SearchEntriesSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    const input = SearchEntriesSchema.parse(params)
                    const hasFilters =
                        input.project_number !== undefined ||
                        input.issue_number !== undefined ||
                        input.pr_number !== undefined ||
                        input.is_personal !== undefined

                    // When merging across DBs, fetch more per-DB so BM25 ranking
                    // in one DB doesn't silently drop entries before the merge.
                    // The actual user limit is applied by mergeAndDedup.
                    const perDbLimit = teamDb ? Math.min(input.limit * 2, 500) : input.limit

                    let personalEntries
                    if (!input.query && !hasFilters) {
                        personalEntries = db.getRecentEntries(perDbLimit, input.is_personal)
                    } else {
                        personalEntries = db.searchEntries(input.query || '', {
                            limit: perDbLimit,
                            isPersonal: input.is_personal,
                            projectNumber: input.project_number,
                            issueNumber: input.issue_number,
                            prNumber: input.pr_number,
                        })
                    }

                    // Cross-database merge when team DB is available
                    // Skip team DB when is_personal is explicitly true (team entries are never personal)
                    if (teamDb && input.is_personal !== true) {
                        let teamEntries
                        if (!input.query && !hasFilters) {
                            teamEntries = teamDb.getRecentEntries(perDbLimit)
                        } else {
                            teamEntries = teamDb.searchEntries(input.query || '', {
                                limit: perDbLimit,
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
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    const input = SearchByDateRangeSchema.parse(params)
                    const perDbLimit = teamDb ? Math.min(input.limit * 2, 500) : input.limit
                    const personalEntries = db.searchByDateRange(input.start_date, input.end_date, {
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                        issueNumber: input.issue_number,
                        prNumber: input.pr_number,
                        workflowRunId: input.workflow_run_id,
                        limit: perDbLimit,
                    })

                    // Cross-database merge when team DB is available
                    // Skip team DB when is_personal is explicitly true (team entries are never personal)
                    if (teamDb && input.is_personal !== true) {
                        const teamEntries = teamDb.searchByDateRange(
                            input.start_date,
                            input.end_date,
                            {
                                entryType: input.entry_type,
                                tags: input.tags,
                                projectNumber: input.project_number,
                                issueNumber: input.issue_number,
                                prNumber: input.pr_number,
                                workflowRunId: input.workflow_run_id,
                                limit: perDbLimit,
                            }
                        )
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
            name: 'semantic_search',
            title: 'Semantic Search',
            description: 'Perform semantic/vector search on journal entries using AI embeddings',
            group: 'search',
            inputSchema: SemanticSearchSchemaMcp,
            outputSchema: SemanticSearchOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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

                    // Batch-fetch all entries in a single query (instead of N+1 getEntryById calls)
                    const entryIds = results.map((r) => r.entryId)
                    const entriesMap = db.getEntriesByIds(entryIds)

                    const entries = results
                        .map((r) => {
                            const entry = entriesMap.get(r.entryId)
                            if (!entry) return null
                            // Apply is_personal filter if specified
                            if (
                                input.is_personal !== undefined &&
                                entry.isPersonal !== input.is_personal
                            )
                                return null
                            return {
                                ...entry,
                                similarity: Math.round(r.score * 100) / 100,
                            }
                        })
                        .filter((e): e is NonNullable<typeof e> => e !== null)

                    const stats = vectorManager.getStats()
                    const isIndexEmpty = stats.itemCount === 0
                    const includeHint = input.hint_on_empty ?? true

                    // Quality gate: if the best match is below this floor,
                    // treat all results as noise and include the hint
                    const QUALITY_FLOOR = 0.5
                    const bestSimilarity = entries[0]?.similarity ?? 0
                    const allNoise = entries.length > 0 && bestSimilarity < QUALITY_FLOOR

                    // Build hint: quality gate hint is always shown (not gated by hint_on_empty)
                    // because noisy results ≠ empty results. hint_on_empty only controls
                    // the "no results" and "empty index" advisory hints.
                    const hint =
                        isIndexEmpty && includeHint
                            ? 'No entries in vector index. Use rebuild_vector_index to index existing entries.'
                            : entries.length === 0 && includeHint
                              ? `No entries matched your query above the similarity threshold (${String(input.similarity_threshold ?? 0.25)}). Try lowering similarity_threshold (e.g., 0.15) for broader matches.`
                              : allNoise
                                ? `Results may be noise — best similarity (${String(bestSimilarity)}) is below quality floor (${String(QUALITY_FLOOR)}). Try a more specific query or raise similarity_threshold to filter weak matches.`
                                : undefined

                    return {
                        query: input.query,
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
            name: 'get_vector_index_stats',
            title: 'Get Vector Index Stats',
            description: 'Get statistics about the semantic search vector index',
            group: 'search',
            inputSchema: z.object({}).strict(),
            outputSchema: VectorStatsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (_params: unknown) => {
                try {
                    if (!vectorManager) {
                        return {
                            success: false,
                            available: false,
                            error: 'Vector search not available',
                        }
                    }
                    const stats = vectorManager.getStats()
                    return { success: true, available: true, ...stats }
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

/** Number of leading characters used as deduplication key */
const DEDUP_KEY_LENGTH = 200

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

    // Concat and sort by timestamp descending (ISO 8601 sorts lexicographically)
    const all = [...personal, ...team].sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    for (const entry of all) {
        // Deduplicate by content (same entry shared to team)
        const key = entry.content.slice(0, DEDUP_KEY_LENGTH)
        if (!seen.has(key)) {
            seen.add(key)
            merged.push(entry)
        }
    }

    return limit !== undefined ? merged.slice(0, limit) : merged
}
