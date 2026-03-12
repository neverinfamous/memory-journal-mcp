import {
    ICON_CLOCK,
    ICON_HEALTH,
    ICON_STAR,
    ICON_TAG,
    ICON_ANALYTICS,
} from '../../../constants/icons.js'
import { getAllToolNames } from '../../../filtering/tool-filter.js'
import type { Tag } from '../../../types/index.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { execQuery, transformEntryRow } from '../shared.js'

const ENTRY_COLUMNS =
    'id, entry_type, content, timestamp, is_personal, significance_type, auto_context, deleted_at, ' +
    'project_number, project_owner, issue_number, issue_url, pr_number, pr_url, pr_status, ' +
    'workflow_run_id, workflow_name, workflow_status'

function getTotalToolCount(): number {
    return getAllToolNames().length
}


export function getStatsResources(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://recent',
            name: 'Recent Entries',
            title: 'Recent Journal Entries',
            description: '10 most recent journal entries',
            mimeType: 'application/json',
            icons: [ICON_CLOCK],
            annotations: {
                audience: ['assistant'],
                priority: 0.8,
            },
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                const entries = context.db.getRecentEntries(10)
                const lastModified = entries[0]?.timestamp ?? new Date().toISOString()
                return {
                    data: { entries, count: entries.length },
                    annotations: { lastModified },
                }
            },
        },
        {
            uri: 'memory://significant',
            name: 'Significant Entries',
            title: 'Significant Milestones',
            description: 'Significant milestones and breakthroughs',
            mimeType: 'application/json',
            icons: [ICON_STAR],
            annotations: {
                audience: ['assistant'],
                priority: 0.7,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const rows = execQuery(
                    context.db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE significance_type IS NOT NULL
                    AND deleted_at IS NULL
                `
                )
                const entriesWithImportance: (Record<string, unknown> & { importance: number })[] =
                    rows.map((row) => {
                        const entry = transformEntryRow(row)
                        const { score: importance } = context.db.calculateImportance(
                            entry['id'] as number
                        )
                        return { ...entry, importance }
                    })
                entriesWithImportance.sort((a, b) => {
                    if (b.importance !== a.importance) {
                        return b.importance - a.importance
                    }
                    const aTime = new Date(a['timestamp'] as string).getTime()
                    const bTime = new Date(b['timestamp'] as string).getTime()
                    return bTime - aTime
                })
                const top20 = entriesWithImportance.slice(0, 20)
                return { entries: top20, count: top20.length }
            },
        },

        {
            uri: 'memory://tags',
            name: 'All Tags',
            title: 'Tag List',
            description: 'All available tags with usage counts',
            mimeType: 'application/json',
            icons: [ICON_TAG],
            annotations: {
                audience: ['assistant'],
                priority: 0.4,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const tags: Tag[] = context.db.listTags()
                const mappedTags = tags.map((t) => ({
                    id: t.id,
                    name: t.name,
                    count: t.usageCount,
                }))
                return { tags: mappedTags, count: mappedTags.length }
            },
        },
        {
            uri: 'memory://statistics',
            name: 'Statistics',
            title: 'Journal Statistics',
            description: 'Overall journal statistics',
            mimeType: 'application/json',
            icons: [ICON_ANALYTICS],
            annotations: {
                audience: ['assistant'],
                priority: 0.4,
            },
            handler: (_uri: string, context: ResourceContext) => {
                return context.db.getStatistics('week')
            },
        },
        {
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
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const dbHealth = context.db.getHealthStatus()

                let vectorIndex: {
                    available: boolean
                    itemCount: number
                    modelName: string | null
                } | null = null
                if (context.vectorManager) {
                    try {
                        const stats = await context.vectorManager.getStats()
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
    ]
}
