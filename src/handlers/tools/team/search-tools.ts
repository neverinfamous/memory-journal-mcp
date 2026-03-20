/**
 * Team Search Tools - 2 tools
 *
 * Tools: team_search, team_search_by_date_range
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_NOT_CONFIGURED, batchFetchAuthors } from './helpers.js'
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
                'Search entries in the team database by text and/or tags. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamSearchSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { query, tags, limit } = TeamSearchSchema.parse(params)

                    let entries
                    if (query) {
                        entries = teamDb.searchEntries(query, { limit })
                    } else {
                        entries = teamDb.getRecentEntries(limit)
                    }

                    // Filter by tags if provided (batch query instead of N+1)
                    if (tags && tags.length > 0) {
                        const entryIds = entries.map((e) => e.id)
                        if (entryIds.length > 0) {
                            const placeholders = entryIds.map(() => '?').join(',')
                            const tagResult = teamDb.executeRawQuery(
                                `SELECT et.entry_id, t.name FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id IN (${placeholders})`,
                                entryIds
                            )
                            const entryTagMap = new Map<number, string[]>()
                            if (tagResult[0]) {
                                for (const row of tagResult[0].values) {
                                    const entryId = row[0] as number
                                    const tagName = row[1] as string
                                    const existing = entryTagMap.get(entryId) ?? []
                                    existing.push(tagName)
                                    entryTagMap.set(entryId, existing)
                                }
                            }
                            entries = entries.filter((e) => {
                                const entryTags = entryTagMap.get(e.id) ?? []
                                return tags.some((t: string) => entryTags.includes(t))
                            })
                        }
                    }

                    // Batch-fetch authors
                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                    }))

                    return { entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_search_by_date_range',
            title: 'Search Team Entries by Date Range',
            description:
                'Search team entries within a date range with optional filters for entry type and tags. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamSearchByDateRangeSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { start_date, end_date, entry_type, tags, limit } =
                        TeamSearchByDateRangeSchema.parse(params)

                    const entries = teamDb.searchByDateRange(start_date, end_date, {
                        entryType: entry_type,
                        tags,
                        limit,
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

                    return { entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
