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
                'Search entries in the team database by text and/or tags. Requires TEAM_DB_PATH. 🛑 WARNING: Team DB is a shared multi-tenant domain. ALWAYS specify project_number unless you explicitly intend to search across ALL teams globally.',
            group: 'team',
            inputSchema: TeamSearchSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { query, tags, limit, sort_by, project_number } = TeamSearchSchema.parse(params)

                    const searchLimit =
                        tags && tags.length > 0 ? Math.min(Math.max(limit * 5, 50), MAX_QUERY_LIMIT) : limit

                    let entries = teamDb.searchEntries(query ?? '', {
                        limit: searchLimit,
                        sortBy: sort_by,
                        projectNumber: project_number,
                    })

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

                    return { success: true, entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_search_by_date_range',
            title: 'Search Team Entries by Date Range',
            description:
                'Search team entries within a date range with optional filters for entry type and tags. Requires TEAM_DB_PATH. 🛑 WARNING: Team DB is a shared multi-tenant domain. ALWAYS specify project_number unless you explicitly intend to search across ALL teams globally.',
            group: 'team',
            inputSchema: TeamSearchByDateRangeSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { start_date, end_date, entry_type, tags, limit, sort_by, project_number } =
                        TeamSearchByDateRangeSchema.parse(params)

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

                    const entries = teamDb.searchByDateRange(start_date, end_date, {
                        entryType: entry_type,
                        tags,
                        limit,
                        sortBy: sort_by,
                        projectNumber: project_number,
                    })

                    // Batch-fetch authors
                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
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
