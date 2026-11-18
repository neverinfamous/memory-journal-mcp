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
import { resourceProjectNumber, resourceWorkspace, sliceUntrustedInline } from './shared.js'
import { sanitizeAuthor } from '../../utils/security-utils.js'
import { enforceTeamResourceRbac } from './team.js'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'

const DIGEST_PREVIEW_LIMIT = 200

function sanitizeDigestSnapshot(snapshot: unknown): unknown {
    if (
        typeof snapshot !== 'object' ||
        snapshot === null ||
        Array.isArray(snapshot) ||
        !('topImportanceEntries' in snapshot)
    ) {
        return snapshot
    }
    const rawTop: unknown = Reflect.get(snapshot, 'topImportanceEntries')
    if (!Array.isArray(rawTop)) return snapshot
    return {
        ...snapshot,
        topImportanceEntries: rawTop.map((item: unknown) => {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
            const preview: unknown = Reflect.get(item, 'preview')
            if (typeof preview !== 'string') return item
            return {
                ...item,
                preview: sliceUntrustedInline(preview, DIGEST_PREVIEW_LIMIT, '...'),
            }
        }),
    }
}

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
        const wsId = resourceWorkspace(context)

        // Try scheduler first, then persisted DB snapshot
        const schedulerDigest = context.scheduler?.getLatestDigest?.(wsId)
        if (schedulerDigest) {
            const data = { success: true, snapshot: sanitizeDigestSnapshot(schedulerDigest) }
            const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
            return {
                data: { ...data, _meta: { tokenEstimate } },
                annotations: { lastModified },
            }
        }

        // Live compute fallback (stdio transport, fresh databases)
        try {
            const liveDigest = context.db?.computeDigest?.(wsId)
            if (liveDigest !== undefined) {
                const data = {
                    success: true,
                    snapshot: sanitizeDigestSnapshot(liveDigest),
                    source: 'computed',
                }
                const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
                return {
                    data: { ...data, _meta: { tokenEstimate } },
                    annotations: { lastModified },
                }
            }
        } catch {
            // Non-critical — fall through to "no digest available" message or persisted snapshot
        }

        const dbSnapshot = context.db?.getLatestAnalyticsSnapshot?.('digest', wsId)
        if (dbSnapshot) {
            const data = {
                success: true,
                snapshot: sanitizeDigestSnapshot(dbSnapshot.data),
                computedAt: dbSnapshot.createdAt,
                source: 'persisted',
            }
            const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
            return {
                data: { ...data, _meta: { tokenEstimate } },
                annotations: { lastModified: dbSnapshot.createdAt },
            }
        }

        throw new ProtocolError(ProtocolErrorCode.InternalError, 
            'No digest available — enable with --digest-interval <minutes> (HTTP transport only)'
        )
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
    capabilities: { requiresTeamScope: true },
    icons: [ICON_ANALYTICS],
    annotations: {
        ...withPriority(0.4, ASSISTANT_FOCUSED),
    },
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const lastModified = new Date().toISOString()

        if (!context.teamDb) {
            throw new ProtocolError(ProtocolErrorCode.InternalError,  'Team database not configured — set TEAM_DB_PATH to enable.')
        }

        const wsId = resourceWorkspace(context)
        const projectNumber = resourceProjectNumber(context, wsId)
        enforceTeamResourceRbac(context, wsId)

        // Compute collaboration matrix live from team DB
        try {
            const matrix = context.teamDb.getTeamCollaborationMatrix({
                period: 'month',
                limit: 100,
                workspaceId: wsId,
                ...(projectNumber !== undefined ? { projectNumber } : {}),
            })
            const sanitizedMatrix = {
                ...matrix,
                authorActivity: Array.isArray(matrix.authorActivity)
                    ? matrix.authorActivity.map((a) => ({
                          ...a,
                          ...(typeof a.author === 'string'
                              ? { author: sanitizeAuthor(a.author) }
                              : {}),
                      }))
                    : [],
                crossAuthorLinks: Array.isArray(matrix.crossAuthorLinks)
                    ? matrix.crossAuthorLinks.map((l) => ({
                          ...l,
                          ...(typeof l.fromAuthor === 'string'
                              ? { fromAuthor: sanitizeAuthor(l.fromAuthor) }
                              : {}),
                          ...(typeof l.toAuthor === 'string'
                              ? { toAuthor: sanitizeAuthor(l.toAuthor) }
                              : {}),
                      }))
                    : [],
                impactFactor: Array.isArray(matrix.impactFactor)
                    ? matrix.impactFactor.map((f) => ({
                          ...f,
                          ...(typeof f.author === 'string'
                              ? { author: sanitizeAuthor(f.author) }
                              : {}),
                      }))
                    : [],
            }
            const data = { success: true, matrix: sanitizedMatrix }
            const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
            return {
                data: { ...data, _meta: { tokenEstimate } },
                annotations: { lastModified },
            }
        } catch (error) {
            throw new ProtocolError(ProtocolErrorCode.InternalError,  error instanceof Error ? error.message : String(error))
        }
    },
}

// ============================================================================
// memory://insights/reports
// ============================================================================

export const reportHistoryResource: InternalResourceDef = {
    uri: 'memory://insights/reports',
    name: 'Report History',
    title: 'Recent Scheduled Digest Reports',
    description:
        'The last 5 generated digest report snapshots. Updated by the scheduled report job.',
    mimeType: 'application/json',
    icons: [ICON_ANALYTICS],
    annotations: {
        ...withPriority(0.3, ASSISTANT_FOCUSED),
    },
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const lastModified = new Date().toISOString()

        try {
            const snapshots = context.db.getAnalyticsSnapshots?.('report', 5, resourceWorkspace(context)) ?? []
            
            const reports = snapshots.map(snapshot => {
                const data = snapshot.data
                const topEntries = data['topImportanceEntries'] as { preview?: string }[] | undefined
                const rawPreview = (data['preview'] as string | undefined) ?? topEntries?.[0]?.preview
                return {
                    computedAt: snapshot.createdAt,
                    preview:
                        typeof rawPreview === 'string' && rawPreview.length > 0
                            ? sliceUntrustedInline(rawPreview, DIGEST_PREVIEW_LIMIT, '...')
                            : 'No preview available',
                }
            })

            const data = { success: true, reports }
            const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
            return {
                data: { ...data, _meta: { tokenEstimate } },
                annotations: { lastModified: reports[0]?.computedAt ?? lastModified },
            }
        } catch (error) {
            throw new ProtocolError(ProtocolErrorCode.InternalError,  error instanceof Error ? error.message : String(error))
        }
    },
}

// ============================================================================

// Removed computeTeamCollaborationMatrix (migrated to SQLite adapter)

/**
 * Get all insight resource definitions
 */
export function getInsightResourceDefinitions(): InternalResourceDef[] {
    return [digestInsightsResource, teamCollaborationResource, reportHistoryResource]
}
