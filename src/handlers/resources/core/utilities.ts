import type { Tag } from '../../../types/index.js'
import { ICON_CLOCK, ICON_STAR, ICON_TAG, ICON_ANALYTICS } from '../../../constants/icons.js'
import { RAW_ENTRY_COLUMNS as ENTRY_COLUMNS } from '../../../database/core/entry-columns.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { execQuery, transformEntryRow } from '../shared.js'

export const recentResource: InternalResourceDef = {
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
}

export const significantResource: InternalResourceDef = {
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
}

export const tagsResource: InternalResourceDef = {
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
}

export const statisticsResource: InternalResourceDef = {
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
}
