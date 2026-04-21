import { ICON_CLOCK, ICON_TEAM, ICON_FLAG } from '../../constants/icons.js'
import {
    withPriority,
    ASSISTANT_FOCUSED,
    MEDIUM_PRIORITY,
} from '../../utils/resource-annotations.js'
import type {
    InternalResourceDef,
    ResourceContext,
    ResourceResult,
    BriefingConfig,
} from './shared.js'
import { DEFAULT_FLAG_VOCABULARY } from '../tools/team/schemas.js'
import { parseFlagContext } from '../../types/auto-context.js'
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

                const entries = context.teamDb.getRecentEntries(10)
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
                            activeFlags: [],
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
                        const flagCtx = parseFlagContext(entry.autoContext)
                        if (!flagCtx || flagCtx.resolved) return null
                        return {
                            id: entry.id,
                            flag_type: flagCtx.flag_type,
                            target_user: flagCtx.target_user,
                            link: flagCtx.link,
                            author: entry.author ? sanitizeAuthor(entry.author) : null,
                            timestamp: entry.timestamp,
                            preview: markUntrustedContent(
                                entry.content.slice(0, 120) +
                                    (entry.content.length > 120 ? '...' : '')
                            ),
                            tags: entry.tags,
                            projectNumber: entry.projectNumber ?? null,
                        }
                    })
                    .filter((f): f is NonNullable<typeof f> => f !== null)

                const lastModified = activeFlags[0]?.timestamp ?? new Date().toISOString()

                return {
                    data: {
                        activeFlags,
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
                const config: BriefingConfig | undefined = context.briefingConfig
                const custom: string[] | undefined = config?.flagVocabulary
                const hasCustom = Array.isArray(custom) && custom.length > 0

                const vocabulary: string[] = hasCustom
                    ? custom.map(String)
                    : [...DEFAULT_FLAG_VOCABULARY]

                return {
                    data: {
                        vocabulary,
                        count: vocabulary.length,
                        isDefault: !hasCustom,
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
