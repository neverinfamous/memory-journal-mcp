/**
 * Search Tool Group — 4 tools
 *
 * Tools: search_entries, search_by_date_range, semantic_search, get_vector_index_stats
 *
 * v6.4.0 (Hush Phase 1 — Search Excellence):
 * - search_entries: Added `mode` param ('auto'|'fts'|'semantic'|'hybrid')
 * - semantic_search: Added `entry_id`, `tags`, `entry_type`, `start_date`, `end_date` filters
 * - Module split: search.ts → search/ directory for maintainability
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
    EntriesListOutputSchema,
    relaxedNumber,
} from '../schemas.js'
import { MAX_QUERY_LIMIT, calcPerDbLimit, mergeAndDedup } from './helpers.js'
import { resolveSearchMode, type SearchMode } from './auto.js'
import { ftsSearch } from './fts.js'
import { hybridSearch } from './hybrid.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
const SearchEntriesSchema = z.object({
    query: z.string().optional(),
    mode: z
        .enum(['auto', 'fts', 'semantic', 'hybrid'])
        .optional()
        .default('auto')
        .describe(
            'Search strategy: auto (default, heuristic-based), fts (FTS5 keyword), semantic (vector), hybrid (RRF fusion of FTS5+vector)'
        ),
    limit: z.number().max(MAX_QUERY_LIMIT).optional().default(10),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
    tags: z.array(z.string()).optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
})

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
const SearchEntriesSchemaMcp = z.object({
    query: z.string().optional(),
    mode: z
        .string()
        .optional()
        .default('auto')
        .describe(
            'Search strategy: auto (default, heuristic-based), fts (FTS5 keyword), semantic (vector), hybrid (RRF fusion of FTS5+vector)'
        ),
    limit: relaxedNumber().optional().default(10),
    is_personal: z.boolean().optional(),
    project_number: relaxedNumber().optional(),
    issue_number: relaxedNumber().optional(),
    pr_number: relaxedNumber().optional(),
    pr_status: z.string().optional(),
    workflow_run_id: relaxedNumber().optional(),
    tags: z.array(z.string()).optional(),
    entry_type: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
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
    limit: z.number().max(MAX_QUERY_LIMIT).optional().default(500),
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
    query: z.string().optional(),
    entry_id: z
        .number()
        .optional()
        .describe(
            'Find entries related to this entry ID (uses existing embedding, skips re-embedding)'
        ),
    limit: z.number().max(MAX_QUERY_LIMIT).optional().default(10),
    similarity_threshold: z.number().optional().default(0.25),
    is_personal: z.boolean().optional(),
    tags: z.array(z.string()).optional().describe('Filter results by tags'),
    entry_type: z.enum(ENTRY_TYPES).optional().describe('Filter results by entry type'),
    start_date: z
        .string()
        .regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('Filter results from this date (YYYY-MM-DD)'),
    end_date: z
        .string()
        .regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('Filter results until this date (YYYY-MM-DD)'),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
})

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
const SemanticSearchSchemaMcp = z.object({
    query: z.string().optional(),
    entry_id: relaxedNumber()
        .optional()
        .describe(
            'Find entries related to this entry ID (uses existing embedding, skips re-embedding)'
        ),
    limit: relaxedNumber().optional().default(10),
    similarity_threshold: relaxedNumber().optional().default(0.25),
    is_personal: z.boolean().optional(),
    tags: z.array(z.string()).optional().describe('Filter results by tags'),
    entry_type: z.string().optional().describe('Filter results by entry type'),
    start_date: z.string().optional().describe('Filter results from this date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('Filter results until this date (YYYY-MM-DD)'),
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
        entryId: z.number().optional(),
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
                'Search journal entries with auto-selecting strategy. Supports modes: auto (default — heuristic selects best strategy), fts (FTS5 keyword with phrases "exact match", prefix auth*, boolean NOT/OR/AND), semantic (vector similarity), hybrid (RRF fusion of FTS5+vector). Optional filters for GitHub Projects, Issues, PRs, and Actions.',
            group: 'search',
            inputSchema: SearchEntriesSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    const input = SearchEntriesSchema.parse(params)
                    const query = input.query || ''
                    const mode = input.mode as SearchMode

                    // Resolve effective mode
                    const { resolvedMode, isAuto } = resolveSearchMode(mode, query)

                    // Validate: at least one filter or query must be provided to prevent bare searches
                    const hasFilters =
                        input.project_number !== undefined ||
                        input.issue_number !== undefined ||
                        input.pr_number !== undefined ||
                        input.pr_status !== undefined ||
                        input.workflow_run_id !== undefined ||
                        input.is_personal !== undefined ||
                        input.tags !== undefined ||
                        input.entry_type !== undefined ||
                        input.start_date !== undefined ||
                        input.end_date !== undefined

                    if (!query && !hasFilters) {
                        return {
                            success: false,
                            error: 'Search requires either a query string or at least one filter',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Provide a search query or use get_recent_entries instead',
                            recoverable: true,
                            entries: [],
                            count: 0,
                        }
                    }

                    const effectiveMode = resolvedMode

                    const searchOptions = {
                        limit: input.limit,
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                        issueNumber: input.issue_number,
                        prNumber: input.pr_number,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        tags: input.tags,
                        entryType: input.entry_type,
                        startDate: input.start_date,
                        endDate: input.end_date,
                    }

                    // Route to the appropriate search strategy
                    switch (effectiveMode) {
                        case 'semantic': {
                            if (!vectorManager) {
                                // Fallback to FTS when vector search is unavailable
                                const result = ftsSearch(input.query, db, teamDb, searchOptions)
                                return { ...result, searchMode: 'fts (fallback)' }
                            }
                            // Use semantic search, then fetch full entries
                            const semanticResults = await vectorManager.search(
                                query,
                                input.limit,
                                0.25
                            )
                            const entryIds = semanticResults.map((r) => r.entryId)
                            const entriesMap = db.getEntriesByIds(entryIds)
                            const entries = semanticResults
                                .map((r) => {
                                    const entry = entriesMap.get(r.entryId)
                                    if (!entry) return null
                                    if (
                                        input.is_personal !== undefined &&
                                        entry.isPersonal !== input.is_personal
                                    )
                                        return null
                                    return { ...entry, source: 'personal' as const }
                                })
                                .filter((e): e is NonNullable<typeof e> => e !== null)
                            return {
                                entries,
                                count: entries.length,
                                searchMode: isAuto ? 'semantic (auto)' : 'semantic',
                            }
                        }
                        case 'hybrid': {
                            if (!vectorManager) {
                                // Fallback to FTS when vector search is unavailable
                                const result = ftsSearch(input.query, db, teamDb, searchOptions)
                                return { ...result, searchMode: 'fts (fallback)' }
                            }
                            const { entries } = await hybridSearch(
                                query,
                                db,
                                vectorManager,
                                searchOptions
                            )
                            return {
                                entries,
                                count: entries.length,
                                searchMode: isAuto ? 'hybrid (auto)' : 'hybrid',
                            }
                        }
                        case 'fts':
                        default: {
                            const result = ftsSearch(input.query, db, teamDb, searchOptions)
                            return {
                                ...result,
                                searchMode: isAuto ? 'fts (auto)' : 'fts',
                            }
                        }
                    }
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

                    // Validate date range order (YYYY-MM-DD sorts lexicographically)
                    if (input.start_date > input.end_date) {
                        return {
                            success: false,
                            error: `Invalid date range: start_date (${input.start_date}) is after end_date (${input.end_date})`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Ensure start_date is before or equal to end_date',
                            recoverable: true,
                        }
                    }

                    const perDbLimit = calcPerDbLimit(input.limit, !!teamDb)
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
            description:
                'Perform semantic/vector search on journal entries using AI embeddings. Supports find-related-by-ID (entry_id) and metadata filters (tags, entry_type, date range).',
            group: 'search',
            inputSchema: SemanticSearchSchemaMcp,
            outputSchema: SemanticSearchOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    const input = SemanticSearchSchema.parse(params)

                    // Validate: at least one of query or entry_id must be provided
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

                    if (!vectorManager) {
                        return {
                            success: false,
                            error: 'Semantic search not initialized. Vector search manager is not available.',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: false,
                            query: input.query,
                            entries: [],
                            count: 0,
                        }
                    }

                    // Determine search method: by entry_id or by query
                    let results: SemanticSearchResult[]
                    if (input.entry_id !== undefined) {
                        // Find related by ID: lookup existing embedding, skip re-embedding
                        results = await vectorManager.searchByEntryId(
                            input.entry_id,
                            input.limit ?? 10,
                            input.similarity_threshold ?? 0.25
                        )
                    } else {
                        results = await vectorManager.search(
                            input.query ?? '',
                            input.limit ?? 10,
                            input.similarity_threshold ?? 0.25
                        )
                    }

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
                            // Apply metadata filters
                            if (input.tags && input.tags.length > 0) {
                                const entryTags = db.getTagsForEntry(entry.id)
                                if (!input.tags.some((t) => entryTags.includes(t))) return null
                            }
                            if (input.entry_type && entry.entryType !== input.entry_type)
                                return null
                            if (input.start_date) {
                                const entryDate = entry.timestamp.split('T')[0] ?? ''
                                if (entryDate < input.start_date) return null
                            }
                            if (input.end_date) {
                                const entryDate = entry.timestamp.split('T')[0] ?? ''
                                if (entryDate > input.end_date) return null
                            }
                            // Exclude the source entry from find-related results
                            if (input.entry_id !== undefined && entry.id === input.entry_id)
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
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: false,
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
