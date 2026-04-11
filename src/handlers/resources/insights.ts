/**
 * Memory Journal MCP Server - Insights Resources
 *
 * Resources for surfacing pre-computed analytics on demand.
 * - memory://insights/digest — Latest full digest snapshot
 * - memory://insights/team-collaboration — Team collaboration matrix
 */

import { ICON_ANALYTICS } from '../../constants/icons.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'

// ============================================================================
// memory://insights/digest
// ============================================================================

export const digestInsightsResource: InternalResourceDef = {
    uri: 'memory://insights/digest',
    name: 'Analytics Digest',
    title: 'Latest Analytics Digest Snapshot',
    description:
        'Full pre-computed analytics digest with activity trends, significance spikes, stale projects, relationship density, and top importance entries. Updated by the scheduled digest job.',
    mimeType: 'application/json',
    icons: [ICON_ANALYTICS],
    annotations: {
        ...withPriority(0.5, ASSISTANT_FOCUSED),
    },
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const lastModified = new Date().toISOString()

        // Try scheduler first, then persisted DB snapshot
        const schedulerDigest = context.scheduler?.getLatestDigest?.()
        if (schedulerDigest) {
            return {
                data: { success: true, snapshot: schedulerDigest },
                annotations: { lastModified },
            }
        }

        const dbSnapshot = context.db?.getLatestAnalyticsSnapshot?.('digest')
        if (dbSnapshot) {
            return {
                data: {
                    success: true,
                    snapshot: dbSnapshot.data,
                    computedAt: dbSnapshot.createdAt,
                    source: 'persisted',
                },
                annotations: { lastModified: dbSnapshot.createdAt },
            }
        }

        return {
            data: {
                success: true,
                snapshot: null,
                message:
                    'No digest available — enable with --digest-interval <minutes> (HTTP transport only)',
            },
            annotations: { lastModified },
        }
    },
}

// ============================================================================
// memory://insights/team-collaboration
// ============================================================================

export const teamCollaborationResource: InternalResourceDef = {
    uri: 'memory://insights/team-collaboration',
    name: 'Team Collaboration Matrix',
    title: 'Team Collaboration Insights',
    description:
        'Cross-author collaboration metrics: activity heatmap, cross-linking patterns, and impact factor per contributor. Requires TEAM_DB_PATH.',
    mimeType: 'application/json',
    icons: [ICON_ANALYTICS],
    annotations: {
        ...withPriority(0.4, ASSISTANT_FOCUSED),
    },
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const lastModified = new Date().toISOString()

        if (!context.teamDb) {
            return {
                data: {
                    success: true,
                    matrix: null,
                    message: 'Team database not configured — set TEAM_DB_PATH to enable.',
                },
                annotations: { lastModified },
            }
        }

        // Compute collaboration matrix live from team DB
        try {
            const matrix = computeTeamCollaborationMatrix(context.teamDb)
            return {
                data: { success: true, ...matrix },
                annotations: { lastModified },
            }
        } catch (error) {
            return {
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                },
                annotations: { lastModified },
            }
        }
    },
}

// ============================================================================
// Team Collaboration Matrix Computation
// ============================================================================

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { execQuery } from './shared.js'

interface AuthorActivity {
    author: string
    period: string
    entryCount: number
}

interface CrossAuthorLink {
    fromAuthor: string
    toAuthor: string
    linkCount: number
}

interface AuthorImpact {
    author: string
    inboundLinks: number
}

interface CollaborationMatrix {
    authorActivity: AuthorActivity[]
    crossAuthorLinks: CrossAuthorLink[]
    impactFactor: AuthorImpact[]
    totalAuthors: number
    totalEntries: number
}

function computeTeamCollaborationMatrix(teamDb: IDatabaseAdapter): CollaborationMatrix {
    // Author activity heatmap (entries per author per month)
    const activityRows = execQuery(
        teamDb,
        `SELECT
            COALESCE(author, 'unknown') AS author,
            strftime('%Y-%m', timestamp) AS period,
            COUNT(*) AS entry_count
        FROM memory_journal
        WHERE deleted_at IS NULL
        GROUP BY author, period
        ORDER BY period DESC, entry_count DESC
        LIMIT 100`
    )
    const authorActivity: AuthorActivity[] = activityRows.map((r) => ({
        author: r['author'] as string,
        period: r['period'] as string,
        entryCount: r['entry_count'] as number,
    }))

    // Cross-author linking (who links to whose entries)
    const crossLinkRows = execQuery(
        teamDb,
        `SELECT
            COALESCE(m1.author, 'unknown') AS from_author,
            COALESCE(m2.author, 'unknown') AS to_author,
            COUNT(*) AS link_count
        FROM relationships r
        JOIN memory_journal m1 ON r.from_entry_id = m1.id
        JOIN memory_journal m2 ON r.to_entry_id = m2.id
        WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL
            AND COALESCE(m1.author, 'unknown') != COALESCE(m2.author, 'unknown')
        GROUP BY from_author, to_author
        ORDER BY link_count DESC
        LIMIT 50`
    )
    const crossAuthorLinks: CrossAuthorLink[] = crossLinkRows.map((r) => ({
        fromAuthor: r['from_author'] as string,
        toAuthor: r['to_author'] as string,
        linkCount: r['link_count'] as number,
    }))

    // Impact factor (whose entries are linked TO the most)
    const impactRows = execQuery(
        teamDb,
        `SELECT
            COALESCE(m2.author, 'unknown') AS author,
            COUNT(*) AS inbound_links
        FROM relationships r
        JOIN memory_journal m2 ON r.to_entry_id = m2.id
        WHERE m2.deleted_at IS NULL
        GROUP BY author
        ORDER BY inbound_links DESC
        LIMIT 20`
    )
    const impactFactor: AuthorImpact[] = impactRows.map((r) => ({
        author: r['author'] as string,
        inboundLinks: r['inbound_links'] as number,
    }))

    // Totals
    const totalsRow = execQuery(
        teamDb,
        `SELECT
            COUNT(DISTINCT COALESCE(author, 'unknown')) AS total_authors,
            COUNT(*) AS total_entries
        FROM memory_journal
        WHERE deleted_at IS NULL`
    )
    const totalAuthors = (totalsRow[0]?.['total_authors'] as number) ?? 0
    const totalEntries = (totalsRow[0]?.['total_entries'] as number) ?? 0

    return {
        authorActivity,
        crossAuthorLinks,
        impactFactor,
        totalAuthors,
        totalEntries,
    }
}

/**
 * Get all insight resource definitions
 */
export function getInsightResourceDefinitions(): InternalResourceDef[] {
    return [digestInsightsResource, teamCollaborationResource]
}
