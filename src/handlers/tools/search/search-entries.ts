import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { PermissionError, ValidationError } from '../../../types/errors.js'
import { resolveSearchMode } from './auto.js'
import { ftsSearch } from './fts.js'
import { resolveAuthorizedIncludeTeam } from './helpers.js'
import { runHybridSearch, runFtsSearch } from './hybrid-branch.js'
import { SearchEntriesSchema, SearchEntriesSchemaMcp } from './schemas.js'
import { EntriesListOutputSchema } from '../schemas.js'
import { runSemanticSearch } from './semantic-branch.js'

export function getSearchEntriesTool(context: ToolContext): ToolDefinition[] {
    const { db, teamDb, vectorManager } = context;
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
                    const projectNumber = alignedProjectFilter(
                        wsId,
                        input.project_number,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )
                    const includeTeam = resolveAuthorizedIncludeTeam(
                        'search_entries',
                        input.include_team,
                        params,
                        context.config?.runtime?.auditLogger
                    )
                    const query = input.query?.trim() || ''
                    const mode = input.mode

                    // Validate: at least one filter or query must be provided to prevent bare searches
                    const hasFilters =
                        (input.workspace_id !== undefined &&
                            input.workspace_id.trim() !== '' &&
                            input.workspace_id.trim() !== 'default') ||
                        input.project_number !== undefined ||
                        input.issue_number !== undefined ||
                        input.pr_number !== undefined ||
                        input.pr_status !== undefined ||
                        input.workflow_run_id !== undefined ||
                        input.is_personal !== undefined ||
                        input.tags !== undefined ||
                        (input.exclude_tags !== undefined && input.exclude_tags.length > 0) ||
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
                        projectNumber,
                        issueNumber: input.issue_number,
                        prNumber: input.pr_number,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        tags: input.tags,
                        excludeTags: input.exclude_tags,
                        entryType: input.entry_type,
                        startDate: input.start_date,
                        endDate: input.end_date,
                        sortBy: input.sort_by,
                        includeTeam,
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
                            projectNumber,
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
                                return {
                                    ...result,
                                    success: true,
                                    entries: result.entries,
                                    count: result.entries.length,
                                    searchMode: 'fts (fallback)',
                                    degraded: true,
                                    facets,
                                    ...(result.nextCursor !== undefined
                                        ? { next_cursor: result.nextCursor }
                                        : {}),
                                }
                            }
                            const semanticPage = await runSemanticSearch({
                                context,
                                input,
                                query,
                                wsId,
                                hasFilters,
                                searchOptions,
                            })

                            return {
                                success: true,
                                entries: semanticPage.page,
                                count: semanticPage.page.length,
                                searchMode: isAuto ? 'semantic (auto)' : 'semantic',
                                degraded: semanticPage.degraded,
                                facets,
                                ...(semanticPage.nextCursor !== undefined ? { next_cursor: semanticPage.nextCursor } : {}),
                            }
                        }
                        case 'hybrid': {
                            return await runHybridSearch({
                                context,
                                input,
                                query,
                                wsId,
                                isAuto,
                                searchOptions,
                                facets,
                            })
                        }
                        case 'fts':
                        default:
                            return runFtsSearch(context, input, isAuto, searchOptions, facets)
                    }
                } catch (err) {
                    if (err instanceof PermissionError) throw err
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
