/**
 * Briefing Resource — Barrel
 *
 * Composes the sub-modules (GitHub, context, user message) into the
 * single `briefingResource` definition exported for MCP registration.
 */

import { ICON_BRIEFING } from '../../../../constants/icons.js'
import {
    withPriority,
    withSessionInit,
    ASSISTANT_FOCUSED,
} from '../../../../utils/resource-annotations.js'
import { VERSION } from '../../../../version.js'
import { getGitHubIntegration } from '../../../../github/github-integration/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../../shared.js'
import { buildGitHubSection } from './github-section.js'
import {
    buildJournalContext,
    buildTeamContext,
    buildRulesFileInfo,
    buildSkillsDirInfo,
    buildFlagsContext,
} from './context-section.js'
import { formatUserMessage } from './user-message.js'
import { buildInsightsSection } from './insights-section.js'

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
    uri: 'memory://briefing/{+repo}',
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

async function buildBriefingData(
    context: ResourceContext,
    targetRepo?: string
): Promise<ResourceResult> {
    const config = { ...DEFAULT_BRIEFING_CONFIG, ...context.briefingConfig }

    let activeGithub = context.github
    let activeProjectNumber = config.defaultProjectNumber

    if (targetRepo && config.projectRegistry?.[targetRepo]) {
        const repoPath = config.projectRegistry[targetRepo].path
        activeGithub = getGitHubIntegration(repoPath, context.runtime)
        activeProjectNumber = config.projectRegistry[targetRepo].project_number ?? undefined
    }

    // Build all sections
    const journal = buildJournalContext(context, config, activeProjectNumber)
    const github = await buildGitHubSection(activeGithub, config)
    const team = buildTeamContext(context, config, activeProjectNumber)
    const rulesFile = buildRulesFileInfo(config.rulesFilePath, config.allowedIoRoots)
    const skillsDir = buildSkillsDirInfo(config.skillsDirPath, config.allowedIoRoots)
    const insights = buildInsightsSection(context)
    const flags = buildFlagsContext(context)

    // Format the latest entry preview for user message
    const latestPreview = journal.latestEntries[0]
        ? `#${journal.latestEntries[0].id} (${journal.latestEntries[0].type}): ${journal.latestEntries[0].preview}`
        : 'No entries yet'

    const summaryPreviews = journal.sessionSummaries
        ? journal.sessionSummaries.map((s) => `#${s.id} (${s.type}): ${s.preview}`)
        : null

    const userMessage = formatUserMessage({
        repoName: github?.repo ?? 'local',
        branchName: github?.branch ?? 'unknown',
        ciStatus: github?.ci ?? 'unknown',
        totalEntries: journal.totalEntries,
        latestPreview,
        summaryPreviews,
        github,
        teamTotalEntries: team?.teamInfo.totalEntries,
        rulesFile,
        skillsDir,
        analyticsInsights: insights ?? undefined,
        flagSummary: flags,
    })

    return {
        data: {
            version: VERSION,
            serverTime: new Date().toISOString(),
            localTime: new Intl.DateTimeFormat('en-US', {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }).format(new Date()),
            journal: {
                totalEntries: journal.totalEntries,
                latestEntries: journal.latestEntries,
                ...(journal.latestSessionSummary
                    ? { latestSessionSummary: journal.latestSessionSummary }
                    : {}),
            },
            github,
            teamContext: team?.teamInfo,
            ...(team?.teamLatestEntries ? { teamLatestEntries: team.teamLatestEntries } : {}),
            ...(rulesFile ? { rulesFile } : {}),
            ...(skillsDir ? { skillsDir } : {}),
            ...(insights ? { insights } : {}),
            ...(flags ? { activeFlags: flags } : {}),
            ...(config.projectRegistry ? {
                registeredWorkspaces: Object.fromEntries(
                    Object.entries(config.projectRegistry).map(([k, v]) => {
                        const strippedPath = v.path.split(/[\\/]/).pop() || v.path
                        return [k, { ...v, path: strippedPath }]
                    })
                )
            } : {}),
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
                (config.projectRegistry
                    ? '\\nMulti-project registry detected. To retrieve CI status, branch, and issues for a specific project, use the get_github_context tool or dynamic resources (e.g. memory://github/status/{repo}) with the repository name.'
                    : ''),
        },
        annotations: { lastModified: journal.lastModified },
    } satisfies ResourceResult
}
