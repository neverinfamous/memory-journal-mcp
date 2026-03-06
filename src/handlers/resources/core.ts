/**
 * Memory Journal MCP Server - Core Resource Definitions
 *
 * Resources: briefing, instructions, recent, significant, tags, statistics, health
 */

import type { Tag } from '../../types/index.js'
import { getAllToolNames } from '../../filtering/ToolFilter.js'
import { generateInstructions, type InstructionLevel } from '../../constants/ServerInstructions.js'
import { getPrompts } from '../prompts/index.js'
import {
    ICON_BRIEFING,
    ICON_CLOCK,
    ICON_HEALTH,
    ICON_STAR,
    ICON_TAG,
    ICON_ANALYTICS,
} from '../../constants/icons.js'
import pkg from '../../../package.json' with { type: 'json' }
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import { execQuery, transformEntryRow } from './shared.js'

/**
 * Get total tool count for health status
 */
function getTotalToolCount(): number {
    return getAllToolNames().length
}

/**
 * Get core resource definitions
 */
export function getCoreResourceDefinitions(): InternalResourceDef[] {
    return [
        // Session initialization resource - highest priority
        {
            uri: 'memory://briefing',
            name: 'Initial Briefing',
            title: 'Session Initialization Context',
            description:
                'AUTO-READ AT SESSION START: Project context for AI agents (~300 tokens). Contains userMessage to show user.',
            mimeType: 'application/json',
            icons: [ICON_BRIEFING],
            annotations: {
                audience: ['assistant'],
                priority: 1.0,
                autoRead: true,
                sessionInit: true,
            },
            handler: async (_uri: string, context: ResourceContext) => {
                // Get latest 3 entries (compact)
                const recentEntries = context.db.getRecentEntries(3)
                const latestEntries = recentEntries.map((e) => ({
                    id: e.id,
                    timestamp: e.timestamp,
                    type: e.entryType,
                    preview: e.content.slice(0, 80) + (e.content.length > 80 ? '...' : ''),
                }))

                // Get compact GitHub status if available
                let github: {
                    repo: string | null
                    branch: string | null
                    ci: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown'
                    openIssues: number
                    openPRs: number
                    milestones: { title: string; progress: string; dueOn: string | null }[]
                    insights?: {
                        stars: number | null
                        forks: number | null
                        clones14d?: number
                        views14d?: number
                    }
                } | null = null

                if (context.github) {
                    try {
                        const repoInfo = await context.github.getRepoInfo()
                        const owner = repoInfo.owner
                        const repo = repoInfo.repo

                        if (owner && repo) {
                            // Get CI status (based on latest run only)
                            let ciStatus:
                                | 'passing'
                                | 'failing'
                                | 'pending'
                                | 'cancelled'
                                | 'unknown' = 'unknown'
                            try {
                                const runs = await context.github.getWorkflowRuns(owner, repo, 1)
                                if (runs.length > 0) {
                                    const latestRun = runs[0]
                                    if (!latestRun) {
                                        ciStatus = 'unknown'
                                    } else if (latestRun.status !== 'completed') {
                                        ciStatus = 'pending'
                                    } else {
                                        switch (latestRun.conclusion) {
                                            case 'success':
                                                ciStatus = 'passing'
                                                break
                                            case 'failure':
                                                ciStatus = 'failing'
                                                break
                                            case 'cancelled':
                                                ciStatus = 'cancelled'
                                                break
                                            default:
                                                ciStatus = 'unknown'
                                        }
                                    }
                                }
                            } catch {
                                // CI status unavailable
                            }

                            // Get issue/PR counts
                            let openIssues = 0
                            let openPRs = 0
                            try {
                                const issues = await context.github.getIssues(
                                    owner,
                                    repo,
                                    'open',
                                    1
                                )
                                openIssues = issues.length > 0 ? issues.length : 0
                                const prs = await context.github.getPullRequests(
                                    owner,
                                    repo,
                                    'open',
                                    1
                                )
                                openPRs = prs.length > 0 ? prs.length : 0
                            } catch {
                                // Counts unavailable
                            }

                            // Get milestone summary for briefing
                            let milestones: {
                                title: string
                                progress: string
                                dueOn: string | null
                            }[] = []
                            try {
                                const msList = await context.github.getMilestones(
                                    owner,
                                    repo,
                                    'open',
                                    3
                                )
                                milestones = msList.map((m) => {
                                    const total = m.closedIssues + m.openIssues
                                    const pct =
                                        total > 0 ? Math.round((m.closedIssues / total) * 100) : 0
                                    return {
                                        title: m.title,
                                        progress: `${String(pct)}%`,
                                        dueOn: m.dueOn,
                                    }
                                })
                            } catch {
                                // Milestones unavailable
                            }

                            // Get repo insights (stars, forks, traffic)
                            let insights:
                                | {
                                      stars: number | null
                                      forks: number | null
                                      clones14d?: number
                                      views14d?: number
                                  }
                                | undefined = undefined
                            try {
                                const repoStats = await context.github.getRepoStats(owner, repo)
                                if (repoStats) {
                                    insights = {
                                        stars: repoStats.stars ?? null,
                                        forks: repoStats.forks ?? null,
                                    }
                                    // Traffic requires push access - may fail
                                    try {
                                        const trafficData = await context.github.getTrafficData(
                                            owner,
                                            repo
                                        )
                                        if (trafficData) {
                                            insights.clones14d = trafficData.clones.total
                                            insights.views14d = trafficData.views.total
                                        }
                                    } catch {
                                        // Traffic data unavailable (requires push access)
                                    }
                                }
                            } catch {
                                // Repo stats unavailable
                            }

                            github = {
                                repo: `${owner}/${repo}`,
                                branch: repoInfo.branch ?? null,
                                ci: ciStatus,
                                openIssues,
                                openPRs,
                                milestones,
                                insights,
                            }
                        }
                    } catch {
                        // GitHub unavailable
                    }
                }

                // Get entry count for context
                const stats = context.db.getStatistics('week')
                const totalEntries = stats.totalEntries ?? 0

                // Team DB context (if configured)
                let teamContext:
                    | { totalEntries: number; latestPreview: string | null }
                    | undefined = undefined
                if (context.teamDb) {
                    try {
                        const teamStats = context.teamDb.getStatistics('week')
                        const teamRecent = context.teamDb.getRecentEntries(1)
                        const teamLatest = teamRecent[0]
                            ? `#${teamRecent[0].id}: ${teamRecent[0].content.slice(0, 60)}${teamRecent[0].content.length > 60 ? '...' : ''}`
                            : null
                        teamContext = {
                            totalEntries: teamStats.totalEntries ?? 0,
                            latestPreview: teamLatest,
                        }
                    } catch {
                        // Team DB unavailable
                    }
                }

                // Determine lastModified from most recent entry or current time
                const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString()

                // Build acknowledgment message for user
                const repoName = github?.repo ?? 'local'
                const branchName = github?.branch ?? 'unknown'
                const ciStatus = github?.ci ?? 'unknown'
                const latestPreview = latestEntries[0]
                    ? `#${latestEntries[0].id} (${latestEntries[0].type}): ${latestEntries[0].preview}`
                    : 'No entries yet'

                const milestoneRow =
                    github?.milestones && github.milestones.length > 0
                        ? `\n| **Milestones** | ${github.milestones.map((m) => `${m.title} (${m.progress}${m.dueOn ? `, due ${m.dueOn.split('T')[0] ?? ''}` : ''})`).join(', ')} |`
                        : ''

                // Build insights row for userMessage
                let insightsRow = ''
                if (github?.insights) {
                    const parts: string[] = []
                    if (github.insights.stars !== null)
                        parts.push(`⭐ ${String(github.insights.stars)} stars`)
                    if (github.insights.forks !== null)
                        parts.push(`🍴 ${String(github.insights.forks)} forks`)
                    if (github.insights.clones14d !== undefined)
                        parts.push(`📦 ${String(github.insights.clones14d)} clones`)
                    if (github.insights.views14d !== undefined)
                        parts.push(`👁️ ${String(github.insights.views14d)} views`)
                    if (parts.length > 0) {
                        const trafficNote = github.insights.clones14d !== undefined ? ' (14d)' : ''
                        insightsRow = `\n| **Insights** | ${parts.join(' · ')}${trafficNote} |`
                    }
                }

                return {
                    data: {
                        version: pkg.version,
                        serverTime: new Date().toISOString(),
                        journal: {
                            totalEntries,
                            latestEntries,
                        },
                        github,
                        teamContext,
                        behaviors: {
                            create: 'implementations, decisions, bug-fixes, milestones',
                            search: 'before decisions, referencing prior work',
                            link: 'implementation→spec, bugfix→issue',
                        },
                        templateResources: [
                            'memory://projects/{number}/timeline',
                            'memory://issues/{issue_number}/entries',
                            'memory://prs/{pr_number}/entries',
                            'memory://prs/{pr_number}/timeline',
                            'memory://kanban/{project_number}',
                            'memory://kanban/{project_number}/diagram',
                            'memory://milestones/{number}',
                        ],
                        more: {
                            fullHealth: 'memory://health',
                            allRecent: 'memory://recent',
                            githubStatus: 'memory://github/status',
                            repoInsights: 'memory://github/insights',
                            contextBundle: 'get-context-bundle prompt',
                        },
                        // IMPORTANT: Agent should relay this message to the user
                        userMessage: `📋 **Session Context Loaded**
| Context | Value |
|---------|-------|
| **Project** | ${repoName} |
| **Branch** | ${branchName} |
| **CI Status** | ${ciStatus} |
| **Journal** | ${totalEntries} entries |${teamContext ? `\n| **Team DB** | ${teamContext.totalEntries} entries |` : ''}
| **Latest** | ${latestPreview} |${milestoneRow}${insightsRow}

I have project memory access and will create entries for significant work.`,
                        // Note for clients that don't auto-inject ServerInstructions
                        clientNote:
                            'For complete tool reference and field notes, read memory://instructions.',
                    },
                    annotations: { lastModified },
                } satisfies ResourceResult
            },
        },
        // Server instructions resource
        {
            uri: 'memory://instructions',
            name: 'Server Instructions',
            title: 'Full Server Behavioral Guidance',
            description: 'Full server instructions for AI agents.',
            mimeType: 'text/markdown',
            icons: [ICON_BRIEFING],
            annotations: {
                audience: ['assistant'],
                priority: 0.95,
            },
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const level: InstructionLevel = 'full'

                const allToolNames = new Set(getAllToolNames())
                const enabledTools = context.filterConfig?.enabledTools ?? allToolNames

                const prompts = getPrompts().map((p) => {
                    const prompt = p as { name: string; description?: string }
                    return { name: prompt.name, description: prompt.description }
                })

                // Deferred import to avoid circular dependency (core → index → core)
                const { getResources } = await import('./index.js')
                const resources = getResources().map((r) => {
                    const res = r as { uri: string; name: string; description?: string }
                    return { uri: res.uri, name: res.name, description: res.description }
                })

                const instructions = generateInstructions(
                    enabledTools,
                    resources,
                    prompts,
                    undefined,
                    level
                )

                return {
                    data: instructions,
                }
            },
        },
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
                    SELECT * FROM memory_journal
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
        },
    ]
}
