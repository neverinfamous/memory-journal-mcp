import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ValidationError } from '../../../types/errors.js'
import { passMetadataFilters, collectTeamSearchEntries, mergeAndDedup, type EntryWithSource } from './helpers.js'
import { resolveSearchMode } from './auto.js'
import { ftsSearch } from './fts.js'
import { hybridSearch } from './hybrid.js'
import { decodeCursor, encodeCursor } from '../../../database/sqlite-adapter/entries/search/cursor.js'
import { SearchEntriesSchema, SearchEntriesSchemaMcp } from './schemas.js'
import { EntriesListOutputSchema } from '../schemas.js'

function cursorOffset(cursor: string | undefined): number {
    if (cursor === undefined || cursor.length === 0) return 0
    const decoded = decodeCursor(cursor)
    if (decoded !== null && 'offset' in decoded) return decoded.offset
    return 0
}

function pageRows<T>(rows: T[], cursor: string | undefined, limit: number): { page: T[]; nextCursor?: string } {
    const offset = cursorOffset(cursor)
    const page = rows.slice(offset, offset + limit)
    const next = offset + page.length
    if (next < rows.length) return { page, nextCursor: encodeCursor({ offset: next }) }
    return { page }
}

export function getSearchEntriesTool(context: ToolContext): ToolDefinition[] {
    const { db, teamDb, vectorManager, teamVectorManager } = context;
    return [
        {
            name: 'search_entries',
            title: 'Search Entries',
            description:
                'Search journal entries. Use sort_by: "importance" to surface structurally significant entries before major decisions. Supports modes: auto (default), fts, semantic, hybrid. Optional filters for GitHub Projects, Issues, PRs, and Actions. ' +
                'FTS5 syntax: "exact phrase", prefix*, OR/NOT/AND. Word-boundary matched. Automatically merges team DB results when TEAM_DB_PATH is configured.',
            group: 'search',
            inputSchema: SearchEntriesSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = SearchEntriesSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const query = input.query?.trim() || ''
                    const mode = input.mode

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
                            ...formatHandlerError(
                                new ValidationError(
                                    'Search requires either a query string or at least one filter',
                                    {
                                        suggestion:
                                            'Provide a search query or use get_recent_entries instead',
                                    }
                                )
                            ),
                            entries: [],
                            count: 0,
                            degraded: false,
                        }
                    }

                    // Resolve effective mode
                    const { resolvedMode, isAuto } = resolveSearchMode(mode, query)

                    const effectiveMode = resolvedMode

                    // Intercept hallucinated exact_match
                    let effectiveFuzzyMatch = input.fuzzy_match;
                    let effectiveAutoCorrect = input.auto_correct;
                    if (input.exact_match !== undefined) {
                        effectiveFuzzyMatch = !input.exact_match;
                        if (!input.exact_match) {
                            effectiveAutoCorrect = true;
                        }
                    }

                    const searchOptions = {
                        limit: input.limit,
                        cursor: input.cursor,
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
                        sortBy: input.sort_by,
                        includeTeam: input.include_team,
                        includeArchived: input.include_archived,
                        includeHighlights: input.include_highlights,
                        fuzzy_match: effectiveFuzzyMatch,
                        auto_correct: effectiveAutoCorrect,
                        workspaceId: wsId,
                    }

                    let facets: { tags: {name: string; count: number}[]; entryTypes: {name: string; count: number}[] } | undefined
                    if (input.include_facets) {
                        facets = db.getSearchFacets(query, {
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
                            includeArchived: input.include_archived,
                            workspaceId: wsId,
                        })
                        // Team facets could be merged here, but we'll stick to personal DB for now to keep it simple and fast,
                        // or merge if needed. Since we usually query one DB, this is acceptable for phase 1.
                    }

                    // Route to the appropriate search strategy
                    switch (effectiveMode) {
                        case 'semantic': {
                            if (!vectorManager) {
                                // Fallback to FTS when vector search is unavailable
                                const result = ftsSearch(input.query, db, teamDb, searchOptions)
                                return { ...result, searchMode: 'fts (fallback)' }
                            }
                            // Use semantic search with overfetching for filtering reliability
                            const internalLimit = hasFilters
                                ? Math.min(Math.max(input.limit * 10, 100), 1000)
                                : input.limit * 2
                            const semanticResults = await vectorManager.search(
                                query,
                                internalLimit,
                                0.25,
                                wsId
                            )
                            const entryIds = semanticResults.map((r) => r.entryId)
                            const entriesMap = db.getEntriesByIds(entryIds)

                            // Pre-hydrate tags to avoid N+1 queries during metadata filtering
                            if (input.tags && input.tags.length > 0) {
                                const tagsMap = db.getTagsForEntries(entryIds)
                                for (const entry of entriesMap.values()) {
                                    entry.tags = tagsMap.get(entry.id) ?? []
                                }
                            }

                            const entries: EntryWithSource[] = []
                            for (const result of semanticResults) {
                                const entry = entriesMap.get(result.entryId)
                                if (entry === undefined) continue
                                if (!passMetadataFilters(entry, searchOptions, db)) continue
                                entries.push({
                                    ...entry,
                                    content: entry.content,
                                    timestamp: entry.timestamp,
                                    source: 'personal',
                                })
                            }
                            let ranked = entries

                            if (searchOptions.includeTeam && input.is_personal !== true && teamDb !== undefined) {
                                const teamEntries = await collectTeamSearchEntries(query, teamDb, teamVectorManager, {
                                    ...searchOptions,
                                    limit: input.limit,
                                })
                                ranked = mergeAndDedup(ranked, teamEntries, input.limit)
                            }

                            // Post-fetch importance re-sort for vector results
                            if (input.sort_by === 'importance') {
                                const ids: number[] = []
                                for (const entry of ranked) {
                                    const id = entry['id']
                                    if (typeof id === 'number') ids.push(id)
                                }
                                const importanceMap = db.getEntriesByIdsWithImportance(ids)
                                const scored = ranked.map((entry) => {
                                    const id = entry['id']
                                    const score =
                                        typeof id === 'number'
                                            ? (importanceMap.get(id)?.importance.score ?? 0)
                                            : 0
                                    return { ...entry, importanceScore: Math.round(score * 100) / 100 }
                                })
                                scored.sort((a, b) => {
                                    const left = typeof a.importanceScore === 'number' ? a.importanceScore : 0
                                    const right = typeof b.importanceScore === 'number' ? b.importanceScore : 0
                                    return right - left
                                })
                                ranked = scored
                            }

                            const semanticPage = pageRows(ranked, input.cursor, input.limit)

                            return {
                                success: true,
                                entries: semanticPage.page,
                                count: semanticPage.page.length,
                                searchMode: isAuto ? 'semantic (auto)' : 'semantic',
                                degraded: false,
                                facets,
                                ...(semanticPage.nextCursor !== undefined ? { next_cursor: semanticPage.nextCursor } : {}),
                            }
                        }
                        case 'hybrid': {
                            if (!vectorManager) {
                                // Fallback to FTS when vector search is unavailable
                                const result = ftsSearch(input.query, db, teamDb, searchOptions)
                                return { ...result, searchMode: 'fts (fallback)' }
                            }
                            const hybridOffset = cursorOffset(input.cursor)
                            const { entries: hybridEntries, degraded } = await hybridSearch(
                                query,
                                db,
                                vectorManager,
                                {
                                    ...searchOptions,
                                    limit: input.limit + hybridOffset,
                                    ftsWeight: input.fts_weight,
                                    semanticWeight: input.semantic_weight,
                                    ...(teamDb !== undefined ? { teamDb } : {}),
                                    ...(teamVectorManager !== undefined ? { teamVectorManager } : {}),
                                }
                            )
                            const hybridPage = pageRows(hybridEntries, input.cursor, input.limit)

                            // Post-fetch importance re-sort for vector results
                            if (input.sort_by === 'importance') {
                                const ids = hybridEntries.map((e) => e['id'] as number)
                                const importanceMap = db.getEntriesByIdsWithImportance(ids)
                                const scored = hybridEntries.map((e) => {
                                    const entryId = e['id'] as number
                                    const imp = importanceMap.get(entryId)?.importance.score ?? 0
                                    return { ...e, importanceScore: Math.round(imp * 100) / 100 }
                                })
                                scored.sort(
                                    (a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0)
                                )
                                const scoredPage = pageRows(scored, input.cursor, input.limit)
                                return {
                                    success: true,
                                    entries: scoredPage.page,
                                    count: scoredPage.page.length,
                                    searchMode: isAuto ? 'hybrid (auto)' : 'hybrid',
                                    degraded: degraded === true,
                                    facets,
                                    ...(scoredPage.nextCursor !== undefined ? { next_cursor: scoredPage.nextCursor } : {}),
                                }
                            }

                            return {
                                success: true,
                                entries: hybridPage.page,
                                count: hybridPage.page.length,
                                searchMode: isAuto ? 'hybrid (auto)' : 'hybrid',
                                degraded: degraded === true,
                                facets,
                                ...(hybridPage.nextCursor !== undefined ? { next_cursor: hybridPage.nextCursor } : {}),
                            }
                        }
                        case 'fts':
                        default: {
                            const result = ftsSearch(input.query, db, teamDb, searchOptions)
                            return {
                                ...result,
                                success: true,
                                searchMode: isAuto ? 'fts (auto)' : 'fts',
                                degraded: result.degraded ?? false,
                                next_cursor: result.nextCursor,
                                highlights: result.highlights,
                                suggestions: result.suggestions,
                                correctedQuery: result.correctedQuery,
                                facets,
                            }
                        }
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
