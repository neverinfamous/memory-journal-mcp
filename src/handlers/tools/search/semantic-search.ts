import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { passMetadataFilters } from './helpers.js'
import { SemanticSearchSchema, SemanticSearchSchemaMcp, SemanticSearchOutputSchema } from './schemas.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager/index.js'

export function getSemanticSearchTool(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager } = context;
    return [
        {
            name: 'semantic_search',
            title: 'Semantic Search',
            description:
                'Perform semantic/vector search on journal entries using AI embeddings. Supports find-related-by-ID (entry_id) and metadata filters (tags, entry_type, date range). ' +
                'Threshold default is 0.25 (try 0.15-0.2 for broader matches, 0.4+ for strict matches). ' +
                'Entries are auto-indexed on creation. If index drifts, use rebuild_vector_index.',
            group: 'search',
            inputSchema: SemanticSearchSchemaMcp,
            outputSchema: SemanticSearchOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = SemanticSearchSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)

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

                    const hasFilters =
                        input.is_personal !== undefined ||
                        input.tags !== undefined ||
                        input.entry_type !== undefined ||
                        input.start_date !== undefined ||
                        input.end_date !== undefined ||
                        input.project_number !== undefined ||
                        input.issue_number !== undefined ||
                        input.pr_number !== undefined ||
                        input.workflow_run_id !== undefined

                    const internalLimit = hasFilters
                        ? Math.min(Math.max(input.limit * 10, 100), 1000)
                        : input.limit * 2

                    // Determine search method: by entry_id or by query
                    let results: SemanticSearchResult[]
                    if (input.entry_id !== undefined) {
                        // Find related by ID: lookup existing embedding, skip re-embedding
                        results = await vectorManager.searchByEntryId(
                            input.entry_id,
                            internalLimit,
                            input.similarity_threshold ?? 0.25
                        )
                    } else {
                        results = await vectorManager.search(
                            input.query ?? '',
                            internalLimit,
                            input.similarity_threshold ?? 0.25
                        )
                    }

                    // Batch-fetch all entries in a single query (instead of N+1 getEntryById calls)
                    const entryIds = results.map((r) => r.entryId)
                    const entriesMap = db.getEntriesByIds(entryIds)

                    // Pre-hydrate tags to avoid N+1 queries during metadata filtering
                    const filterOptions = {
                        isPersonal: input.is_personal,
                        projectNumber: input.project_number,
                        issueNumber: input.issue_number,
                        prNumber: input.pr_number,
                        workflowRunId: input.workflow_run_id,
                        tags: input.tags,
                        entryType: input.entry_type,
                        startDate: input.start_date,
                        endDate: input.end_date,
                        includeTeam: input.include_team,
                        includeArchived: input.include_archived,
                        workspaceId: wsId,
                    }

                    if (input.tags && input.tags.length > 0) {
                        const tagsMap = db.getTagsForEntries(entryIds)
                        for (const entry of entriesMap.values()) {
                            entry.tags = tagsMap.get(entry.id) ?? []
                        }
                    }

                    const entries = results
                        .map((r) => {
                            const entry = entriesMap.get(r.entryId)
                            if (!entry) return null

                            if (!passMetadataFilters(entry, filterOptions, db)) return null

                            // Exclude the source entry from find-related results
                            if (input.entry_id !== undefined && entry.id === input.entry_id)
                                return null
                            return {
                                ...entry,
                                similarity: Math.round(r.score * 100) / 100,
                            }
                        })
                        .filter((e): e is NonNullable<typeof e> => e !== null)
                        .slice(0, input.limit)

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
    ];
}
