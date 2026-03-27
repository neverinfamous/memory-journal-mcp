/**
 * Briefing Resource — Barrel
 *
 * Composes the sub-modules (GitHub, context, user message) into the
 * single `briefingResource` definition exported for MCP registration.
 */

import { ICON_BRIEFING } from '../../../../constants/icons.js'
import { withPriority, withSessionInit, ASSISTANT_FOCUSED } from '../../../../utils/resource-annotations.js'
import { VERSION } from '../../../../version.js'
import { GitHubIntegration } from '../../../../github/github-integration/index.js'
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
        ...withSessionInit(withPriority(1.0, ASSISTANT_FOCUSED)),
        autoRead: true,
    },
    handler: async (_uri: string, context: ResourceContext) => {
        return buildBriefingData(context)
    },
}

export const dynamicBriefingResource: InternalResourceDef = {
    uri: 'memory://briefing/{repo}',
    name: 'Dynamic Briefing',
    title: 'Project-Specific Session Context',
    description:
        'Project-specific briefing context for AI agents. Same as memory://briefing but targets a specific repository name from the registered workspaces.',
    mimeType: 'application/json',
    icons: [ICON_BRIEFING],
    annotations: {
        ...withPriority(0.8, ASSISTANT_FOCUSED),
    },
    handler: async (uri: string, context: ResourceContext) => {
        const match = /memory:\/\/briefing\/(.+)/.exec(uri)
        const repoName = match?.[1] ? decodeURIComponent(match[1]) : undefined
        return buildBriefingData(context, repoName)
    },
}

async function buildBriefingData(context: ResourceContext, targetRepo?: string): Promise<ResourceResult> {
    const config = context.briefingConfig ?? DEFAULT_BRIEFING_CONFIG

    // If targetRepo is provided, override the GitHubIntegration just for this briefing call
    let activeGithub = context.github
    if (targetRepo && config.projectRegistry?.[targetRepo]) {
        const repoPath = config.projectRegistry[targetRepo].path
        activeGithub = new GitHubIntegration(repoPath)
    }

    // Build all sections
    const journal = buildJournalContext(context, config)
    const github = await buildGitHubSection(activeGithub, config)
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
            version: VERSION,
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
            ...(config.projectRegistry ? { registeredWorkspaces: config.projectRegistry } : {}),
            behaviors: {
                create: 'implementations, decisions, bug-fixes, milestones',
                search: 'before decisions, referencing prior work',
                link: 'implementation→spec, bugfix→issue',
            },
            templateResources: [
                'memory://github/status/{repo}',
                'memory://github/insights/{repo}',
                'memory://github/milestones/{repo}',
                'memory://milestones/{repo}/{number}',
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
                'For full tool reference and field notes, read memory://instructions — only if your client did NOT auto-inject server instructions at session start (most modern clients including AntiGravity do this automatically).\\n' +
                (config.projectRegistry ? '\\nMulti-project registry detected. To retrieve CI status, branch, and issues for a specific project, use the get_github_context tool or dynamic resources (e.g. memory://github/status/{repo}) with the repository name.' : ''),
        },
        annotations: { lastModified: journal.lastModified },
    } satisfies ResourceResult
}
