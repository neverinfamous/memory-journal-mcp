/**
 * Briefing Resource — Barrel
 *
 * Composes the sub-modules (GitHub, context, user message) into the
 * single `briefingResource` definition exported for MCP registration.
 */

import { ICON_BRIEFING } from '../../../../constants/icons.js'
import pkg from '../../../../../package.json' with { type: 'json' }
import { DEFAULT_BRIEFING_CONFIG } from '../../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { buildGitHubSection } from './github-section.js'
import {
    buildJournalContext,
    buildTeamContext,
    buildRulesFileInfo,
    buildSkillsDirInfo,
} from './context-section.js'
import { formatUserMessage } from './user-message.js'

export const briefingResource: InternalResourceDef = {
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
        const config = context.briefingConfig ?? DEFAULT_BRIEFING_CONFIG

        // Build all sections
        const journal = buildJournalContext(context, config)
        const github = await buildGitHubSection(context.github, config)
        const team = buildTeamContext(context, config)
        const rulesFile = buildRulesFileInfo(config.rulesFilePath)
        const skillsDir = buildSkillsDirInfo(config.skillsDirPath)

        // Format the latest entry preview for user message
        const latestPreview = journal.latestEntries[0]
            ? `#${journal.latestEntries[0].id} (${journal.latestEntries[0].type}): ${journal.latestEntries[0].preview}`
            : 'No entries yet'

        const userMessage = formatUserMessage({
            repoName: github?.repo ?? 'local',
            branchName: github?.branch ?? 'unknown',
            ciStatus: github?.ci ?? 'unknown',
            totalEntries: journal.totalEntries,
            latestPreview,
            github,
            teamTotalEntries: team?.teamInfo.totalEntries,
            rulesFile,
            skillsDir,
        })

        return {
            data: {
                version: pkg.version,
                serverTime: new Date().toISOString(),
                journal: {
                    totalEntries: journal.totalEntries,
                    latestEntries: journal.latestEntries,
                },
                github,
                teamContext: team?.teamInfo,
                ...(team?.teamLatestEntries ? { teamLatestEntries: team.teamLatestEntries } : {}),
                ...(rulesFile ? { rulesFile } : {}),
                ...(skillsDir ? { skillsDir } : {}),
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
                clientNote:
                    'For complete tool reference and field notes, read memory://instructions.',
            },
            annotations: { lastModified: journal.lastModified },
        } satisfies ResourceResult
    },
}
