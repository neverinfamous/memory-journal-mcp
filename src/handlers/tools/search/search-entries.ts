import type { z } from 'zod'
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

type SearchEntriesInput = z.infer<typeof SearchEntriesSchema>
type FtsSearchOptions = Parameters<typeof ftsSearch>[3]

interface Facets {
    tags: { name: string; count: number }[]
    entryTypes: { name: string; count: number }[]
    degraded?: boolean
}

function mergeFacetBuckets(
    personal: { name: string; count: number }[],
    team: { name: string; count: number }[],
    maxItems?: number
): { name: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const item of personal) {
        counts.set(item.name, (counts.get(item.name) ?? 0) + item.count)
    }
    for (const item of team) {
        counts.set(item.name, (counts.get(item.name) ?? 0) + item.count)
    }
    const merged = Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return maxItems !== undefined ? merged.slice(0, maxItems) : merged
}

function mergeSearchFacets(personal: Facets, team: Facets): Facets {
    return {
        tags: mergeFacetBuckets(personal.tags, team.tags, 20),
        entryTypes: mergeFacetBuckets(personal.entryTypes, team.entryTypes),
        ...(personal.degraded === true || team.degraded === true ? { degraded: true } : {}),
    }
}

interface PreparedSearchEntries {
    wsId: string
    query: string
    hasFilters: boolean
    isAuto: boolean
    effectiveMode: ReturnType<typeof resolveSearchMode>['resolvedMode']
    searchOptions: FtsSearchOptions
    facets: Facets | undefined
}

function hasSearchEntriesFilter(input: SearchEntriesInput): boolean {
    return (
        (input.workspace_id !== undefined &&
            input.workspace_id.trim() !== '' &&
            input.workspace_id.trim() !== 'default') ||
        (input.project_number !== undefined && input.project_number > 0) ||
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
    )
}

function computeSearchEntriesFacets(
    context: ToolContext,
    input: SearchEntriesInput,
    query: string,
    wsId: string,
    projectNumber: number | undefined,
    includeTeam: boolean
): Facets | undefined {
    if (!input.include_facets) return undefined
    const facetOptions = {
        isPersonal: input.is_personal,
        projectNumber,
        issueNumber: input.issue_number,
        prNumber: input.pr_number,
        prStatus: input.pr_status,
        workflowRunId: input.workflow_run_id,
        tags: input.tags,
        ...(input.exclude_tags !== undefined ? { excludeTags: input.exclude_tags } : {}),
        entryType: input.entry_type,
        startDate: input.start_date,
        endDate: input.end_date,
        includeArchived: input.include_archived,
        workspaceId: wsId,
    }
    const personalFacets = context.db.getSearchFacets(query, facetOptions)
    const teamFacets =
        includeTeam &&
        input.is_personal !== true &&
        context.teamDb !== undefined &&
        typeof context.teamDb.getSearchFacets === 'function'
            ? context.teamDb.getSearchFacets(query, facetOptions)
            : undefined
    return personalFacets !== undefined && teamFacets !== undefined
        ? mergeSearchFacets(personalFacets, teamFacets)
        : personalFacets
}

function buildSearchEntriesContext(
    context: ToolContext,
    input: SearchEntriesInput,
    params: unknown
): PreparedSearchEntries {
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
        context.config?.runtime?.auditLogger,
        context.teamDb,
        context.config,
        wsId,
        projectNumber
    )
    const query = input.query?.trim() ?? ''
    const hasFilters = hasSearchEntriesFilter(input)
    if (query === '' && !hasFilters) {
        throw new ValidationError('Search requires either a query string or at least one filter', {
            suggestion:
                '🛠️ AUTONOMOUS HEALING: Provide a search query or filter, or use get_recent_entries (mj.core.getRecentEntries) to list recent entries for a workspace without a query.',
        })
    }
    const { resolvedMode, isAuto } = resolveSearchMode(input.mode, query)
    const effectiveFuzzyMatch = input.exact_match !== undefined ? !input.exact_match : input.fuzzy_match
    const effectiveAutoCorrect =
        input.exact_match !== undefined && !input.exact_match ? true : input.auto_correct
    const searchOptions: FtsSearchOptions = {
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
        ...(context.config !== undefined ? { config: context.config } : {}),
    }
    const facets = computeSearchEntriesFacets(context, input, query, wsId, projectNumber, includeTeam)
    return { wsId, query, hasFilters, isAuto, effectiveMode: resolvedMode, searchOptions, facets }
}

async function dispatchSearchStrategy(
    context: ToolContext,
    input: SearchEntriesInput,
    prepared: PreparedSearchEntries
): Promise<Record<string, unknown>> {
    const { wsId, query, hasFilters, isAuto, effectiveMode, searchOptions, facets } = prepared
    if (effectiveMode === 'semantic') {
        if (!context.vectorManager) {
            const result = ftsSearch(input.query, context.db, context.teamDb, searchOptions)
            return {
                ...result,
                success: true,
                entries: result.entries,
                count: result.entries.length,
                searchMode: 'fts (fallback)',
                degraded: true,
                facets,
                ...(result.nextCursor !== undefined ? { next_cursor: result.nextCursor } : {}),
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
    if (effectiveMode === 'hybrid') {
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
    return runFtsSearch(context, input, isAuto, searchOptions, facets)
}

export function getSearchEntriesTool(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'search_entries',
            title: 'Search Entries',
            description:
                'Search journal entries. Use sort_by: "blended" (or "importance") to surface structurally significant entries before major decisions. Supports modes: auto (default), fts, semantic, hybrid. Optional filters for GitHub Projects, Issues, PRs, and Actions. ' +
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
            handler: async (params: unknown): Promise<Record<string, unknown>> => {
                try {
                    const input = SearchEntriesSchema.parse(params)
                    const prepared = buildSearchEntriesContext(context, input, params)
                    return await dispatchSearchStrategy(context, input, prepared)
                } catch (err) {
                    if (err instanceof PermissionError) throw err
                    const formatted = formatHandlerError(err)
                    return err instanceof ValidationError ? { ...formatted, degraded: false } : { ...formatted }
                }
            },
        },
    ]
}
