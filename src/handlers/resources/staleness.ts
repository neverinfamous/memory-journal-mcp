import { z } from 'zod'
import { withPriority, ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type {
    InternalResourceDef,
    ResourceContext,
    ResourceResult,
} from './shared.js'
import { formatHandlerError } from '../../utils/error-helpers.js'

const EnvConfig = z.object({
    STALENESS_ACTIVE_HOURS: z.coerce.number().default(24),
    STALENESS_RECENT_DAYS: z.coerce.number().default(7),
    STALENESS_STALE_DAYS: z.coerce.number().default(30),
})

function getEnvConfig(): { STALENESS_ACTIVE_HOURS: number; STALENESS_RECENT_DAYS: number; STALENESS_STALE_DAYS: number } {
    return EnvConfig.parse(process.env)
}

function calculateStaleness(lastEntryDateStr: string | undefined): 'active' | 'recent' | 'stale' | 'inactive' {
    if (!lastEntryDateStr) return 'inactive'
    
    const env = getEnvConfig()
    const now = Date.now()
    const lastDate = new Date(lastEntryDateStr).getTime()
    const diffHours = (now - lastDate) / (1000 * 60 * 60)
    const diffDays = diffHours / 24

    if (diffHours <= env.STALENESS_ACTIVE_HOURS) return 'active'
    if (diffDays <= env.STALENESS_RECENT_DAYS) return 'recent'
    if (diffDays <= env.STALENESS_STALE_DAYS) return 'stale'
    return 'inactive'
}

export function getStalenessResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://staleness',
            name: 'Project Staleness',
            title: 'Project Staleness Overview',
            description: 'Overview of project staleness based on recent journal entries.',
            mimeType: 'application/json',
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                try {
                    const registry = context.briefingConfig?.projectRegistry ?? {}
                    
                    interface StalenessProject {
                        name: string;
                        project_number: number;
                        path: string;
                        last_entry_date: string | null;
                        last_entry_id: number | null;
                        last_entry_type: string | null;
                    }

                    const result: Record<string, StalenessProject[]> = {
                        active: [],
                        recent: [],
                        stale: [],
                        inactive: [],
                    }

                    for (const [name, entry] of Object.entries(registry)) {
                        if (entry.project_number === undefined || entry.project_number === null) {
                            continue
                        }

                        const searchResult = context.db.searchEntries('', {
                            projectNumber: entry.project_number,
                            limit: 1,
                            sortBy: 'timestamp'
                        })

                        const latestEntry = searchResult.entries[0]
                        const status = calculateStaleness(latestEntry?.timestamp)
                        
                        const projectData = {
                            name,
                            project_number: entry.project_number,
                            path: entry.path,
                            last_entry_date: latestEntry?.timestamp ?? null,
                            last_entry_id: latestEntry?.id ?? null,
                            last_entry_type: latestEntry?.entryType ?? null,
                        }
                        
                        const list = result[status] ?? []
                        list.push(projectData)
                        result[status] = list
                    }

                    const responseData = {
                        thresholds: getEnvConfig(),
                        projects: result,
                    }
                    const tokenEstimate = Math.ceil(JSON.stringify(responseData).length / 4)

                    return {
                        data: {
                            ...responseData,
                            _meta: { tokenEstimate }
                        }
                    }
                } catch (error) {
                    return { data: { ...formatHandlerError(error), code: -32603 } }
                }
            }
        },
        {
            uri: 'memory://staleness/{project_number}',
            name: 'Project Staleness Details',
            title: 'Project Staleness Detailed Breakdown',
            description: 'Detailed staleness breakdown for a single project.',
            mimeType: 'application/json',
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: (uri: string, context: ResourceContext): ResourceResult => {
                try {
                    const match = /^memory:\/\/staleness\/([^/]+)$/.exec(uri)
                    if (!match) {
                        return { data: { error: 'Invalid project number in URI', code: -32002 } }
                    }

                    const matchedId = match[1]
                    if (matchedId === undefined) {
                        return { data: { error: 'Invalid project number in URI', code: -32002 } }
                    }
                    const projectNumber = parseInt(matchedId, 10)
                    if (isNaN(projectNumber)) {
                        return { data: { error: 'Project number must be a valid integer', code: -32002 } }
                    }
                    
                    const searchResult = context.db.searchEntries('', {
                        projectNumber,
                        limit: 5,
                        sortBy: 'timestamp'
                    })

                    const tagsBreakdown: Record<string, number> = {}
                    const typeBreakdown: Record<string, number> = {}
                    
                    const facets = context.db.getSearchFacets('', {
                        projectNumber
                    })
                    
                    for (const tag of facets.tags) {
                        tagsBreakdown[tag.name] = tag.count
                    }
                    
                    for (const type of facets.entryTypes) {
                        typeBreakdown[type.name] = type.count
                    }
                    
                    const now = new Date()
                    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
                    const recentSearch = context.db.searchByDateRange(
                        oneWeekAgo.toISOString(),
                        now.toISOString(),
                        { projectNumber }
                    )

                    const latestEntry = searchResult.entries[0]
                    const status = calculateStaleness(latestEntry?.timestamp)

                    const responseData = {
                        project_number: projectNumber,
                        status,
                        last_5_entries: searchResult.entries.map(e => ({
                            id: e.id,
                            timestamp: e.timestamp,
                            type: e.entryType,
                            preview: e.content.length > 100 ? e.content.slice(0, 100) + '...' : e.content,
                        })),
                        tag_breakdown: tagsBreakdown,
                        type_breakdown: typeBreakdown,
                        weekly_trend: {
                            new_entries_last_7_days: recentSearch.entries.length
                        }
                    }
                    const tokenEstimate = Math.ceil(JSON.stringify(responseData).length / 4)

                    return {
                        data: {
                            ...responseData,
                            _meta: { tokenEstimate }
                        }
                    }
                } catch (error) {
                    return { data: { ...formatHandlerError(error), code: -32603 } }
                }
            }
        }
    ]
}
