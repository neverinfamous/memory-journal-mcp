/**
 * Briefing — User Message Formatter
 *
 * Formats the briefing summary table displayed to the user.
 */

import type { BriefingGitHub } from './github-section.js'
import type { RulesFile, SkillsDir, FlagSummary, GraphSummary } from './context-section.js'
import type { BriefingInsights } from './insights-section.js'

const escapeTableCell = (text: string): string =>
    text
        .replace(/<\/?untrusted_remote_content[^>]*>/gi, '')
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>')

/**
 * Build the user-facing markdown table for the briefing.
 */
export function formatUserMessage(opts: {
    repoName: string
    branchName: string
    ciStatus: string
    totalEntries: number
    latestPreview: string
    summaryPreviews?: string[] | null
    github: BriefingGitHub | null
    teamTotalEntries?: number
    rulesFile?: RulesFile
    skillsDir?: SkillsDir
    analyticsInsights?: BriefingInsights
    flagSummary?: FlagSummary
    graphSummary?: GraphSummary
}): string {
    const {
        repoName,
        branchName,
        totalEntries,
        latestPreview,
        summaryPreviews,
        github,
        rulesFile,
        skillsDir,
        analyticsInsights,
        graphSummary,
    } = opts

    // Build enhanced CI display
    let ciDisplay = opts.ciStatus
    if (github?.workflowSummary) {
        const ws = github.workflowSummary
        if (ws.runs && ws.runs.length > 0) {
            const icons: Record<string, string> = {
                success: '✅',
                failure: '❌',
                pending: '⏳',
                cancelled: '⛔',
                unknown: '❓',
            }
            ciDisplay = ws.runs.map((r) => `${icons[r.conclusion] ?? '❓'} ${r.name}`).join(' · ')
        } else {
            const parts: string[] = []
            if (ws.passing > 0) parts.push(`${String(ws.passing)} passing`)
            if (ws.failing > 0) parts.push(`${String(ws.failing)} failing`)
            if (ws.pending > 0) parts.push(`${String(ws.pending)} pending`)
            if (ws.cancelled > 0) parts.push(`${String(ws.cancelled)} cancelled`)
            ciDisplay = parts.join(' · ') || opts.ciStatus
        }
    }

    // ------------------------------------------------------------------------
    // Group 1: GitHub / Repo
    // ------------------------------------------------------------------------
    const repoLines = [
        `**Repo:** ${escapeTableCell(repoName)}`,
        `**Branch:** ${escapeTableCell(branchName)}`,
        `**CI:** ${escapeTableCell(ciDisplay)}`,
    ]

    if (github) {
        if (github.openIssueList && github.openIssueList.length > 0) {
            const titles = github.openIssueList
                .map((i) => `#${String(i.number)} ${i.title}`)
                .join(' · ')
            repoLines.push(`**Issues:** ${String(github.openIssues)} open: ${escapeTableCell(titles)}`)
        } else {
            repoLines.push(`**Issues:** ${String(github.openIssues)} open`)
        }

        if (github.prStatusSummary) {
            const s = github.prStatusSummary
            const parts: string[] = []
            if (s.open > 0) parts.push(`${String(s.open)} open`)
            if (s.merged > 0) parts.push(`${String(s.merged)} merged`)
            if (s.closed > 0) parts.push(`${String(s.closed)} closed`)
            repoLines.push(`**PRs:** ${parts.join(' · ') || '0'}`)
        } else if (github.openPrList && github.openPrList.length > 0) {
            const titles = github.openPrList.map((p) => `#${String(p.number)} ${p.title}`).join(' · ')
            repoLines.push(`**PRs:** ${String(github.openPRs)} open: ${escapeTableCell(titles)}`)
        } else {
            repoLines.push(`**PRs:** ${String(github.openPRs)} open`)
        }

        if (github.milestones && github.milestones.length > 0) {
            repoLines.push(
                `**Milestones:** ${escapeTableCell(
                    github.milestones
                        .map(
                            (m) =>
                                `${m.title} (${m.progress}${m.dueOn ? `, due ${m.dueOn.split('T')[0] ?? ''}` : ''})`
                        )
                        .join(', ')
                )}`
            )
        }
    }
    const githubGroup = `| **GitHub** | ${repoLines.join('<br>')} |`

    // ------------------------------------------------------------------------
    // Group 2: Journal
    // ------------------------------------------------------------------------
    const journalLines = [`**DB:** ${String(totalEntries)} entries`]
    if (opts.teamTotalEntries !== undefined) {
        journalLines.push(`**Team DB:** ${String(opts.teamTotalEntries)} entries`)
    }
    journalLines.push(`**Latest:** ${escapeTableCell(latestPreview)}`)
    if (summaryPreviews && summaryPreviews.length > 0) {
        for (const s of summaryPreviews) {
            journalLines.push(`**Summary:** ${escapeTableCell(s)}`)
        }
    }
    const journalGroup = `| **Journal** | ${journalLines.join('<br>')} |`

    // ------------------------------------------------------------------------
    // Group 3: Insights & Copilot
    // ------------------------------------------------------------------------
    const insightsLines: string[] = []
    if (github?.insights) {
        const parts: string[] = []
        if (github.insights.stars !== null) parts.push(`⭐ ${String(github.insights.stars)}`)
        if (github.insights.forks !== null) parts.push(`🍴 ${String(github.insights.forks)}`)
        if (github.insights.clones14d !== undefined)
            parts.push(`📦 ${String(github.insights.clones14d)}`)
        if (github.insights.views14d !== undefined)
            parts.push(`👁️ ${String(github.insights.views14d)}`)
        if (parts.length > 0) {
            const trafficNote = github.insights.clones14d !== undefined ? ' (14d)' : ''
            insightsLines.push(`${parts.join(' · ')}${trafficNote}`)
        }
    }
    if (github?.copilotReviews) {
        const cr = github.copilotReviews
        insightsLines.push(
            `**Copilot:** ${String(cr.reviewed)} reviewed · ${String(cr.approved)} approved${cr.changesRequested > 0 ? ` · ${String(cr.changesRequested)} changes requested` : ''}${cr.totalComments > 0 ? ` (${String(cr.totalComments)} comments)` : ''}`
        )
    }
    const insightsGroup =
        insightsLines.length > 0 ? `\n| **Insights** | ${insightsLines.join('<br>')} |` : ''

    // ------------------------------------------------------------------------
    // Group 4: Analytics & Graph
    // ------------------------------------------------------------------------
    const analyticsLines: string[] = []
    if (analyticsInsights) {
        analyticsLines.push(`📈 ${analyticsInsights.activityTrend}`)
        if (analyticsInsights.significanceSpike !== null)
            analyticsLines.push(`🔥 ${analyticsInsights.significanceSpike}`)
        if (analyticsInsights.relationshipDensity !== undefined)
            analyticsLines.push(`🔗 Density: ${analyticsInsights.relationshipDensity}`)
        if (analyticsInsights.staleProjects.length > 0)
            analyticsLines.push(`💤 ${analyticsInsights.staleProjects.length} stale projects`)
    }
    if (graphSummary) {
        const topTypes = Object.entries(graphSummary.causalMetrics)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type}: ${String(count)}`)
            .join(', ') || 'none'
        analyticsLines.push(
            `**Graph:** ${String(graphSummary.totalRelationships)} relationships · Top: ${escapeTableCell(topTypes)}`
        )
    }
    const analyticsGroup =
        analyticsLines.length > 0 ? `\n| **Analytics** | ${escapeTableCell(analyticsLines.join('<br>'))} |` : ''

    // ------------------------------------------------------------------------
    // Group 5: System
    // ------------------------------------------------------------------------
    const systemLines: string[] = []
    if (rulesFile)
        systemLines.push(
            `**Rules:** ${escapeTableCell(rulesFile.name)} (${String(rulesFile.sizeKB)} KB, updated ${rulesFile.lastModified})`
        )
    if (skillsDir)
        systemLines.push(
            `**Skills:** ${String(skillsDir.count)} skill${skillsDir.count !== 1 ? 's' : ''} available`
        )
    const systemGroup =
        systemLines.length > 0 ? `\n| **System** | ${systemLines.join('<br>')} |` : ''

    // ------------------------------------------------------------------------
    // Assembly
    // ------------------------------------------------------------------------
    let flagsAlert = ''
    if (opts.flagSummary && opts.flagSummary.count > 0) {
        flagsAlert = `⚠️ **${String(opts.flagSummary.count)} active flag(s)** — review before proceeding.\n${opts.flagSummary.flags.map((f) => `🚩 ${f.flag_type}${f.target_user ? ` → @${f.target_user}` : ''}: ${f.fullContent.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')}`).join('\n')}\n\n`
    }

    const tableOutput = `${flagsAlert}📋 **Session Context Loaded**\n\n| Context | Value |\n|---------|-------|\n${githubGroup}\n${journalGroup}${insightsGroup}${analyticsGroup}${systemGroup}`

    if (graphSummary?.mermaidGraph) {
        return `${tableOutput}\n\n**Relationship Graph**\n\`\`\`mermaid\n${graphSummary.mermaidGraph}\n\`\`\``
    }

    return tableOutput
}
