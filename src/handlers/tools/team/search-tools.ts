/**
 * Team Search Tools - 2 tools
 *
 * Tools: team_search, team_search_by_date_range
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { MAX_QUERY_LIMIT } from '../schemas.js'
import { TEAM_DB_ERROR_RESPONSE, batchFetchAuthors } from './helpers.js'
import {
    TeamSearchSchema,
    TeamSearchSchemaMcp,
    TeamSearchByDateRangeSchema,
    TeamSearchByDateRangeSchemaMcp,
    TeamEntriesListOutputSchema,
    TeamListDeletedEntriesSchema,
    TeamListDeletedEntriesSchemaMcp,
} from './schemas.js'

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
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { query, tags, limit, cursor, sort_by, project_number, include_archived, fuzzy_match, auto_correct } =
                        TeamSearchSchema.parse(params)


                    const projectNumber = project_number

                    const searchLimit =
                        tags && tags.length > 0
                            ? Math.min(Math.max(limit * 5, 50), MAX_QUERY_LIMIT)
                            : limit

                    const result = teamDb.searchEntries(query ?? '', {
                        limit: searchLimit,
                        cursor,
                        sortBy: sort_by,
                        projectNumber: projectNumber,
                        includeArchived: include_archived,
                        fuzzy_match,
                        auto_correct,
                    })
                    let entries = result.entries

                    // Security: Enforce entryType constraint for cross-tenant searches
                    if (projectNumber == null) {
                        if (tags && tags.length > 0 && tags.some(t => !t.startsWith('flag:'))) {
                            return {
                                success: false,
                                error: 'Cross-project team searches are only permitted for flags. Provide a project_number or use flag:* tags.',
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                suggestion: 'Provide a project_number, or use tags starting with "flag:"',
                                recoverable: true,
                            }
                        }
                        entries = entries.filter((e) => e.entryType === 'flag')
                    }

                    // Filter by tags if provided (batch query instead of N+1)
                    if (tags && tags.length > 0) {
                        const entryIds = entries.map((e) => e.id)
                        if (entryIds.length > 0) {
                            const entryTagMap = teamDb.getTagsForEntries(entryIds)
                            entries = entries.filter((e) => {
                                const entryTags = entryTagMap.get(e.id) ?? []
                                return tags.some((t: string) => entryTags.includes(t))
                            })
                        }
                    }

                    // Apply final limit after filtering
                    entries = entries.slice(0, limit)

                    // Batch-fetch authors
                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                    }))
                    return {
                        success: true,
                        entries: enriched,
                        count: enriched.length,
                        degraded: false,
                        next_cursor: result.nextCursor,
                        suggestions: (result as { suggestions?: string[] }).suggestions,
                        correctedQuery: (result as { correctedQuery?: string }).correctedQuery,
                    }
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
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const {
                        start_date,
                        end_date,
                        entry_type,
                        tags,
                        limit,
                        cursor,
                        sort_by,
                        project_number,
                        include_archived,
                    } = TeamSearchByDateRangeSchema.parse(params)


                    const projectNumber = project_number

                    // Validate date range order (YYYY-MM-DD sorts lexicographically)
                    if (start_date > end_date) {
                        return {
                            success: false,
                            error: `Invalid date range: start_date (${start_date}) is after end_date (${end_date})`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Ensure start_date is before or equal to end_date',
                            recoverable: true,
                        }
                    }

                    if (projectNumber == null && entry_type && entry_type !== 'flag') {
                        return {
                            success: false,
                            error: 'Cross-project team date range searches are only permitted for flags. Provide a project_number or use entry_type="flag".',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Provide a project_number, or set entry_type to "flag"',
                            recoverable: true,
                        }
                    }

                    const result = teamDb.searchByDateRange(start_date, end_date, {
                        // Security: Enforce entryType constraint for cross-tenant searches
                        entryType: projectNumber == null ? 'flag' : entry_type,
                        tags,
                        limit,
                        cursor,
                        sortBy: sort_by,
                        projectNumber: projectNumber,
                        includeArchived: include_archived,
                    })
                    const entries = result.entries

                    // Batch-fetch authors
                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                    }))

                    return {
                        success: true,
                        entries: enriched,
                        count: enriched.length,
                        degraded: false,
                        next_cursor: result.nextCursor,
                    }
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
                    const { limit, offset, project_number } = TeamListDeletedEntriesSchema.parse(params)
                    const projectNumber = project_number
                    const result = teamDb.getDeletedEntries({ limit, offset })
                    let entries = result.entries
                    if (projectNumber != null) {
                        entries = entries.filter((e) => e.projectNumber === projectNumber)
                    }
                    const authorMap = batchFetchAuthors(teamDb, entries.map((e) => e.id))
                    const enriched = entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                    }))
                    return { success: true, entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
