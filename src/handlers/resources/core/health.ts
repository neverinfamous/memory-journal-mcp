import { getAllToolNames } from '../../../filtering/tool-filter.js'
import { ICON_HEALTH } from '../../../constants/icons.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { withResourceTokenMeta } from '../shared.js'
// globalMetrics removed

/**
 * Get total tool count for health status
 */
function getTotalToolCount(): number {
    return getAllToolNames().length
}

function collectVectorHealth(vectorManager: ResourceContext['vectorManager']): {
    available: boolean
    itemCount: number | null
    modelName: string | null
    isReady: boolean
} | null {
    if (!vectorManager) return null
    try {
        const stats = vectorManager.getStats()
        return {
            available: true,
            itemCount: stats.itemCount,
            modelName: stats.modelName,
            isReady: stats.isReady,
        }
    } catch {
        return { available: false, itemCount: 0, modelName: null, isReady: false }
    }
}

function collectMetricsSummary(runtime: ResourceContext['runtime']): {
    totalCalls: number
    totalErrors: number
    totalOutputTokens: number
    upSince: string
} | null {
    try {
        const s = runtime?.metrics.getSummary()
        if (!s) return null
        return {
            totalCalls: s.totalCalls,
            totalErrors: s.totalErrors,
            totalOutputTokens: s.totalOutputTokens,
            upSince: s.upSince,
        }
    } catch {
        return null
    }
}

function handleHealthResource(_uri: string, context: ResourceContext): ResourceResult {
    const dbHealth = context.db.getHealthStatus()
    const vectorIndex = collectVectorHealth(context.vectorManager)
    const totalTools = getTotalToolCount()
    const toolFilter = {
        active: context.filterConfig !== null && context.filterConfig !== undefined,
        enabledCount: context.filterConfig?.enabledTools.size ?? totalTools,
        totalCount: totalTools,
        filterString: context.filterConfig?.raw ?? null,
    }
    const lastModified = new Date().toISOString()

    const payloadData = {
        ...dbHealth,
        vectorIndex,
        toolFilter,
        teamDatabase: context.teamDb
            ? {
                  configured: true,
                  ...context.teamDb.getHealthStatus(),
              }
            : { configured: false },
        audit: context.runtime?.auditLogger
            ? {
                  droppedCount: context.runtime.auditLogger.droppedCount,
                  status: context.runtime.auditLogger.droppedCount > 0 ? 'degraded' : 'ok',
              }
            : { status: 'unknown' },
        metrics: collectMetricsSummary(context.runtime),
        timestamp: lastModified,
    }

    return {
        data: withResourceTokenMeta(payloadData),
        annotations: { lastModified },
    }
}

export const healthResource: InternalResourceDef = {
    uri: 'memory://health',
    name: 'Server Health',
    title: 'Server Health & Diagnostics',
    description:
        'Server health status including database, backups, vector index (real-time stats), and tool filter status',
    mimeType: 'application/json',
    icons: [ICON_HEALTH],
    annotations: withPriority(0.9, ASSISTANT_FOCUSED),
    handler: handleHealthResource,
}
