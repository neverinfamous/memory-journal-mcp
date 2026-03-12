/**
 * Team Resource Definitions - 2 resources
 *
 * Resources: memory://team/recent, memory://team/statistics
 *
 * Requires TEAM_DB_PATH to be configured.
 */

import { ICON_CLOCK, ICON_TEAM } from '../../constants/icons.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Enrich entries with author column from the team database
 */
function enrichWithAuthor<T extends { id: number }>(
    entries: T[],
    context: ResourceContext
): (T & { author: string | null })[] {
    const teamDb = context.teamDb
    if (!teamDb) return entries.map((e: T) => ({ ...e, author: null }))
    return entries.map((e: T) => {
        const authorResult = teamDb.executeRawQuery('SELECT author FROM memory_journal WHERE id = ?', [e.id])
        const author = (authorResult[0]?.values[0]?.[0] as string) ?? null
        return { ...e, author }
    })
}

// ============================================================================
// Resource Definitions
// ============================================================================

/**
 * Get team resource definitions
 */
export function getTeamResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://team/recent',
            name: 'Recent Team Entries',
            title: 'Recent Team-Shared Entries',
            description:
                'Recent entries from the team database. Requires TEAM_DB_PATH configuration.',
            mimeType: 'application/json',
            icons: [ICON_CLOCK],
            annotations: {
                audience: ['assistant'],
                priority: 0.7,
            },
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                if (!context.teamDb) {
                    return {
                        data: {
                            error: 'Team database not configured. Set TEAM_DB_PATH to enable.',
                            entries: [],
                            count: 0,
                        },
                    }
                }

                const entries = context.teamDb.getRecentEntries(10)
                const lastModified = entries[0]?.timestamp ?? new Date().toISOString()
                const enriched = enrichWithAuthor(entries, context)

                return {
                    data: {
                        entries: enriched,
                        count: enriched.length,
                        source: 'team',
                    },
                    annotations: { lastModified },
                }
            },
        },
        {
            uri: 'memory://team/statistics',
            name: 'Team Statistics',
            title: 'Team Database Statistics',
            description: 'Entry counts, types, and contributor breakdown for the team database.',
            mimeType: 'application/json',
            icons: [ICON_TEAM],
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                if (!context.teamDb) {
                    return {
                        data: {
                            error: 'Team database not configured. Set TEAM_DB_PATH to enable.',
                            configured: false,
                        },
                    }
                }

                const stats = context.teamDb.getStatistics('week')

                // Author breakdown
                let authors: { author: string; count: number }[] = []
                try {
                    const authorResult = context.teamDb.executeRawQuery(
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
                    data: {
                        configured: true,
                        ...(stats as object),
                        authors,
                        source: 'team',
                    },
                }
            },
        },
    ]
}
