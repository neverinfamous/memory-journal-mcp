/**
 * Team Search Tools - 2 tools
 *
 * Tools: team_search, team_search_by_date_range
 */

import type { JournalEntry, ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { TEAM_DB_ERROR_RESPONSE, batchFetchAuthors, resolveTeamProjectNumber } from './helpers.js'
import {
    TeamSearchSchema,
    TeamSearchSchemaMcp,
    TeamSearchByDateRangeSchema,
    TeamSearchByDateRangeSchemaMcp,
    TeamEntriesListOutputSchema,
    TeamListDeletedEntriesSchema,
    TeamListDeletedEntriesSchemaMcp,
} from './schemas.js'

type TeamDbInstance = NonNullable<ToolContext['teamDb']>

function missingSearchProjectError(): Record<string, unknown> {
    return {
        success: false,
        error: 'Missing project_number. Cross-tenant searches without project_number are not allowed.',
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Specify a project_number.',
        recoverable: true,
    }
}

function enrichSearchResultsWithAuthors(
    teamDb: TeamDbInstance,
    entries: JournalEntry[]
): (JournalEntry & { author: string | null })[] {
    const authorMap = batchFetchAuthors(
        teamDb,
        entries.map((e) => e.id)
    )
    return entries.map((e) => ({
        ...e,
        author: authorMap.get(e.id) ?? null,
    }))
}

function executeTeamSearch(
    context: ToolContext,
    teamDb: TeamDbInstance,
    params: unknown
): Record<string, unknown> {
    const input = TeamSearchSchema.parse(params)
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const projectNumber = resolveTeamProjectNumber(
        context,
        wsId,
        input.project_number,
        input.workspace_id
    )
    if (projectNumber == null) return missingSearchProjectError()

    const result = teamDb.searchEntries(input.query ?? '', {
        limit: input.limit,
        cursor: input.cursor,
        sortBy: input.sort_by,
        projectNumber,
        includeArchived: input.include_archived,
        fuzzy_match: input.fuzzy_match,
        auto_correct: input.auto_correct,
        workspaceId: wsId,
        ...(input.tags !== undefined && input.tags.length > 0 ? { tags: input.tags } : {}),
        ...(input.exclude_tags !== undefined && input.exclude_tags.length > 0
            ? { excludeTags: input.exclude_tags }
            : {}),
        ...(input.entry_type !== undefined ? { entryType: input.entry_type } : {}),
    })
    const enriched = enrichSearchResultsWithAuthors(teamDb, result.entries)
    return {
        success: true,
        entries: enriched,
        count: enriched.length,
        degraded: result.degraded ?? false,
        next_cursor: result.nextCursor,
        suggestions: result.suggestions,
        correctedQuery: result.correctedQuery,
    }
}

function executeTeamSearchByDateRange(
    context: ToolContext,
    teamDb: TeamDbInstance,
    params: unknown
): Record<string, unknown> {
    const input = TeamSearchByDateRangeSchema.parse(params)
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const projectNumber = resolveTeamProjectNumber(
        context,
        wsId,
        input.project_number,
        input.workspace_id
    )
    if (projectNumber == null) return missingSearchProjectError()

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

    const result = teamDb.searchByDateRange(input.start_date, input.end_date, {
        entryType: input.entry_type,
        tags: input.tags,
        excludeTags: input.exclude_tags,
        limit: input.limit,
        cursor: input.cursor,
        sortBy: input.sort_by,
        projectNumber,
        includeArchived: input.include_archived,
        workspaceId: wsId,
    })
    const enriched = enrichSearchResultsWithAuthors(teamDb, result.entries)
    return {
        success: true,
        entries: enriched,
        count: enriched.length,
        degraded: false,
        next_cursor: result.nextCursor,
    }
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamSearchTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_search',
            title: 'Search Team Entries',
            description:
                'Search entries in the team database by text and/or tags. Requires TEAM_DB_PATH. 🛑 WARNING: Team DB is a shared multi-tenant domain. You MUST specify project_number to isolate results to the target project.',
            group: 'team',
            inputSchema: TeamSearchSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamSearch(context, teamDb, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_search_by_date_range',
            title: 'Search Team Entries by Date Range',
            description:
                'Search team entries within a date range with optional filters for entry type and tags. Requires TEAM_DB_PATH. 🛑 WARNING: Team DB is a shared multi-tenant domain. You MUST specify project_number to isolate results to the target project.',
            group: 'team',
            inputSchema: TeamSearchByDateRangeSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamSearchByDateRange(context, teamDb, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_list_deleted_entries',
            title: 'List Deleted Team Entries',
            description: 'List recently soft-deleted team entries that can be restored. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamListDeletedEntriesSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    const { limit, offset, project_number, workspace_id } = TeamListDeletedEntriesSchema.parse(params)
                    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    const projectNumber = resolveTeamProjectNumber(
                        context,
                        wsId,
                        project_number,
                        workspace_id
                    )
                    if (projectNumber == null) {
                        return {
                            success: false,
                            error: 'Missing project_number. Cross-tenant queries without project_number are not allowed.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify a project_number or workspace_id.',
                            recoverable: true,
                        }
                    }
                    const result = teamDb.getDeletedEntries({
                        limit,
                        offset,
                        workspaceId: wsId,
                        projectNumber,
                    })
                    const authorMap = batchFetchAuthors(teamDb, result.entries.map((e) => e.id))
                    const enriched = result.entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                    }))
                    return { success: true, entries: enriched, count: result.count }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}

