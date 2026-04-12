import { ICON_CLOCK, ICON_TEAM, ICON_FLAG } from '../../constants/icons.js'
import {
    withPriority,
    ASSISTANT_FOCUSED,
    MEDIUM_PRIORITY,
} from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import { DEFAULT_FLAG_VOCABULARY } from '../tools/team/schemas.js'

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
        const authorResult = teamDb.executeRawQuery(
            'SELECT author FROM memory_journal WHERE id = ?',
            [e.id]
        )
        const author = (authorResult[0]?.values[0]?.[0] as string) ?? null
        return { ...e, author }
    })
}

/**
 * Parse auto_context JSON to extract flag metadata.
 */
function parseFlagAutoContext(
    autoContext: string | null
): { flag_type: string; target_user: string | null; resolved: boolean; link: string | null } | null {
    if (!autoContext) return null
    try {
        const parsed: unknown = JSON.parse(autoContext)
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'flag_type' in parsed &&
            'resolved' in parsed
        ) {
            const ctx = parsed as Record<string, unknown>
            return {
                flag_type: String(ctx['flag_type']),
                target_user: typeof ctx['target_user'] === 'string' ? ctx['target_user'] : null,
                resolved: Boolean(ctx['resolved']),
                link: typeof ctx['link'] === 'string' ? ctx['link'] : null,
            }
        }
        return null
    } catch {
        return null
    }
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
        // ====================================================================
        // Flag Resources (Hush Protocol)
        // ====================================================================
        {
            uri: 'memory://flags',
            name: 'Active Flags',
            title: 'Active Team Flags Dashboard',
            description:
                'Active (unresolved) flags from the Hush Protocol. Shows machine-actionable developer signals that need attention. Requires TEAM_DB_PATH.',
            mimeType: 'application/json',
            icons: [ICON_FLAG],
            annotations: withPriority(0.8, ASSISTANT_FOCUSED),
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                if (!context.teamDb) {
                    return {
                        data: {
                            error: 'Team database not configured. Set TEAM_DB_PATH to enable.',
                            flags: [],
                            count: 0,
                        },
                    }
                }

                // Query all flag entries, then filter by resolved status in auto_context
                const flagEntries = context.teamDb.searchEntries('', {
                    entryType: 'flag',
                    limit: 100,
                })

                const enriched = enrichWithAuthor(flagEntries, context)

                const activeFlags = enriched
                    .map((entry) => {
                        const flagCtx = parseFlagAutoContext(entry.autoContext)
                        if (!flagCtx || flagCtx.resolved) return null
                        return {
                            id: entry.id,
                            flag_type: flagCtx.flag_type,
                            target_user: flagCtx.target_user,
                            link: flagCtx.link,
                            author: entry.author,
                            timestamp: entry.timestamp,
                            preview:
                                entry.content.slice(0, 120) +
                                (entry.content.length > 120 ? '...' : ''),
                            tags: entry.tags,
                            projectNumber: entry.projectNumber ?? null,
                        }
                    })
                    .filter((f): f is NonNullable<typeof f> => f !== null)

                const lastModified =
                    activeFlags[0]?.timestamp ?? new Date().toISOString()

                return {
                    data: {
                        flags: activeFlags,
                        count: activeFlags.length,
                    },
                    annotations: { lastModified },
                }
            },
        },
        {
            uri: 'memory://flags/vocabulary',
            name: 'Flag Vocabulary',
            title: 'Hush Protocol Flag Vocabulary',
            description:
                'Returns the configured flag vocabulary for the Hush Protocol. Static resource reflecting server-wide configuration.',
            mimeType: 'application/json',
            icons: [ICON_FLAG],
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                const custom = context.briefingConfig?.flagVocabulary
                const vocabulary =
                    custom && custom.length > 0 ? custom : [...DEFAULT_FLAG_VOCABULARY]

                return {
                    data: {
                        vocabulary,
                        count: vocabulary.length,
                        isDefault: !custom || custom.length === 0,
                    },
                }
            },
        },
    ]
}
