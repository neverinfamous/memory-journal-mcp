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
            const matrix = context.teamDb.getTeamCollaborationMatrix({
                period: 'month',
                limit: 100,
            })
            return {
                data: { success: true, matrix },
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

// Removed computeTeamCollaborationMatrix (migrated to SQLite adapter)

/**
 * Get all insight resource definitions
 */
export function getInsightResourceDefinitions(): InternalResourceDef[] {
    return [digestInsightsResource, teamCollaborationResource]
}
