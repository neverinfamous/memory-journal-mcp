/**
 * Team Analytics Tools - 1 tool
 *
 * Tools: team_get_statistics
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_NOT_CONFIGURED } from './helpers.js'
import {
    TeamGetStatisticsSchema,
    TeamGetStatisticsSchemaMcp,
    TeamStatisticsOutputSchema,
} from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAnalyticsTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_get_statistics',
            title: 'Get Team Statistics',
            description:
                'Get statistics for the team database including entry counts, types, top tags, and contributor breakdown. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamGetStatisticsSchemaMcp,
            outputSchema: TeamStatisticsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { group_by } = TeamGetStatisticsSchema.parse(params)
                    const stats = teamDb.getStatistics(group_by)

                    // Author breakdown
                    let authors: { author: string; count: number }[] = []
                    try {
                        const authorResult = teamDb.executeRawQuery(
                            `SELECT COALESCE(author, 'unknown') as author, COUNT(*) as count
                             FROM memory_journal
                             WHERE deleted_at IS NULL
                             GROUP BY COALESCE(author, 'unknown')
                             ORDER BY count DESC`
                        )
                        if (authorResult[0]) {
                            authors = authorResult[0].values.map((row: unknown[]) => ({
                                author: row[0] as string,
                                count: row[1] as number,
                            }))
                        }
                    } catch {
                        // Author column may not exist yet
                    }

                    return {
                        success: true,
                        ...(stats as object),
                        authors,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
