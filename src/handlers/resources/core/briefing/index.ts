import { ICON_BRIEFING } from '../../../../constants/icons.js'
import pkg from '../../../../../package.json' with { type: 'json' }
import { DEFAULT_BRIEFING_CONFIG } from '../../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { getGitHubContext } from './github.js'
import { getTeamContext } from './team.js'
import { getSystemContext } from './system.js'
import { formatUserMessage } from './formatter.js'

export function getBriefingResource(): InternalResourceDef {
    return {
        uri: 'memory://briefing',
        name: 'Initial Briefing',
        title: 'Session Initialization Context',
        description: 'AUTO-READ AT SESSION START: Project context for AI agents (~300 tokens). Contains userMessage to show user.',
        mimeType: 'application/json',
        icons: [ICON_BRIEFING],
        annotations: {
            audience: ['assistant'],
            priority: 1.0,
            autoRead: true,
            sessionInit: true,
        },
        handler: async (_uri: string, context: ResourceContext) => {
            const config = context.briefingConfig ?? DEFAULT_BRIEFING_CONFIG

            // Get latest entries (configurable count)
            const recentEntries = context.db.getRecentEntries(config.entryCount)
            const latestEntries = recentEntries.map((e) => ({
                id: e.id,
                timestamp: e.timestamp,
                type: e.entryType,
                preview: e.content.slice(0, 80) + (e.content.length > 80 ? '...' : ''),
            }))

            const totalEntries = context.db.getStatistics('week').totalEntries ?? 0

            const github = await getGitHubContext(context, config)
            const team = getTeamContext(context, config)
            const system = getSystemContext(config)

            const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString()

            const userMessage = formatUserMessage(
                github,
                totalEntries,
                latestEntries,
                team.teamContext,
                system.rulesFile,
                system.skillsDir
            )

            return {
                data: {
                    version: pkg.version,
                    serverTime: new Date().toISOString(),
                    journal: {
                        totalEntries,
                        latestEntries,
                    },
                    github,
                    teamContext: team.teamContext,
                    ...(team.teamLatestEntries ? { teamLatestEntries: team.teamLatestEntries } : {}),
                    ...(system.rulesFile ? { rulesFile: system.rulesFile } : {}),
                    ...(system.skillsDir ? { skillsDir: system.skillsDir } : {}),
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
                    userMessage,
                    clientNote: 'For complete tool reference and field notes, read memory://instructions.',
                },
                annotations: { lastModified },
            } satisfies ResourceResult
        },
    }
}
