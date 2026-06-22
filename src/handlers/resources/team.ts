import { ICON_CLOCK, ICON_TEAM } from '../../constants/icons.js'
import {
    withPriority,
    ASSISTANT_FOCUSED,
    MEDIUM_PRIORITY,
} from '../../utils/resource-annotations.js'
import type {
    InternalResourceDef,
    ResourceContext,
    ResourceResult,
} from './shared.js'
import { logger } from '../../utils/logger.js'
import { markUntrustedContent, sanitizeAuthor } from '../../utils/security-utils.js'

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
    if (!teamDb || entries.length === 0) return entries.map((e: T) => ({ ...e, author: null }))

    const ids = entries.map((e) => e.id)
    const authorMap = teamDb.getAuthorsForEntries(ids)

    return entries.map((e: T) => ({
        ...e,
        author: authorMap.get(e.id) ?? null,
    }))
}

// ============================================================================
// Resource Definitions
// ============================================================================

/**
 * Get team resource definitions
 */
export function getTeamResourceDefinitions(): InternalResourceDef[] {
    const resources: InternalResourceDef[] = [
        {
            uri: 'memory://team/recent',
            name: 'Recent Team Entries',
            title: 'Recent Team-Shared Entries',
            description:
                'Recent entries from the team database. Requires TEAM_DB_PATH configuration.',
            mimeType: 'application/json',
            icons: [ICON_CLOCK],
            annotations: withPriority(0.7, ASSISTANT_FOCUSED),
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

                const { entries } = context.teamDb.getRecentEntries(10)
                const lastModified = entries[0]?.timestamp ?? new Date().toISOString()
                const enriched = enrichWithAuthor(entries, context)

                return {
                    data: {
                        entries: enriched.map((e) => ({
                            ...e,
                            content: markUntrustedContent(e.content),
                            author: e.author ? sanitizeAuthor(e.author) : null,
                        })),
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
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
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
                    authors = context.teamDb.getAuthorStatistics()
                } catch (error: unknown) {
                    logger.warning('Failed to get team author statistics', {
                        module: 'ResourceHandler',
                        error: error instanceof Error ? error.message : 'Unknown error',
                    })
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

    return resources.map((resource) => ({
        ...resource,
        capabilities: {
            ...resource.capabilities,
            requiresTeamScope: true,
        },
    }))
}
