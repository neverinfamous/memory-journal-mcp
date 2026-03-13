import { getAllToolNames } from '../../../filtering/tool-filter.js'
import { ICON_HEALTH } from '../../../constants/icons.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'

/**
 * Get total tool count for health status
 */
function getTotalToolCount(): number {
    return getAllToolNames().length
}

export const healthResource: InternalResourceDef = {
    uri: 'memory://health',
    name: 'Server Health',
    title: 'Server Health & Diagnostics',
    description:
        'Server health status including database, backups, vector index (real-time stats), and tool filter status',
    mimeType: 'application/json',
    icons: [ICON_HEALTH],
    annotations: {
        audience: ['assistant'],
        priority: 0.9,
    },
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const dbHealth = context.db.getHealthStatus()

        let vectorIndex: {
            available: boolean
            itemCount: number
            modelName: string | null
        } | null = null
        if (context.vectorManager) {
            try {
                const stats = context.vectorManager.getStats()
                vectorIndex = {
                    available: true,
                    itemCount: stats.itemCount,
                    modelName: stats.modelName,
                }
            } catch {
                vectorIndex = { available: false, itemCount: 0, modelName: null }
            }
        }

        const totalTools = getTotalToolCount()
        const toolFilter = {
            active: context.filterConfig !== null && context.filterConfig !== undefined,
            enabledCount: context.filterConfig?.enabledTools.size ?? totalTools,
            totalCount: totalTools,
            filterString: context.filterConfig?.raw ?? null,
        }

        const lastModified = new Date().toISOString()

        return {
            data: {
                ...dbHealth,
                vectorIndex,
                toolFilter,
                teamDatabase: context.teamDb
                    ? {
                          configured: true,
                          ...context.teamDb.getHealthStatus(),
                      }
                    : { configured: false },
                scheduler: context.scheduler
                    ? context.scheduler.getStatus()
                    : { active: false, jobs: [] },
                timestamp: lastModified,
            },
            annotations: { lastModified },
        }
    },
}
