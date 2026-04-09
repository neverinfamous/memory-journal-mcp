/**
 * Briefing — User Message Formatter
 *
 * Formats the briefing summary table displayed to the user.
 */

import type { BriefingGitHub } from './github-section.js'
import type { RulesFile, SkillsDir } from './context-section.js'

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

    // Issue/PR rows
    let issuesRow = ''
    let prsRow = ''
    if (github) {
        if (github.openIssueList && github.openIssueList.length > 0) {
            const titles = github.openIssueList
                .map((i) => `#${String(i.number)} ${i.title}`)
                .join(' · ')
            issuesRow = `\n| **Issues** | ${String(github.openIssues)} open: ${titles} |`
        } else {
            issuesRow = `\n| **Issues** | ${String(github.openIssues)} open |`
        }

        if (github.prStatusSummary) {
            const s = github.prStatusSummary
            const parts: string[] = []
            if (s.open > 0) parts.push(`${String(s.open)} open`)
            if (s.merged > 0) parts.push(`${String(s.merged)} merged`)
            if (s.closed > 0) parts.push(`${String(s.closed)} closed`)
            prsRow = `\n| **PRs** | ${parts.join(' · ') || '0'} |`
        } else if (github.openPrList && github.openPrList.length > 0) {
            const titles = github.openPrList
                .map((p) => `#${String(p.number)} ${p.title}`)
                .join(' · ')
            prsRow = `\n| **PRs** | ${String(github.openPRs)} open: ${titles} |`
        } else {
            prsRow = `\n| **PRs** | ${String(github.openPRs)} open |`
        }
    }

    // Milestone row
    const milestoneRow =
        github?.milestones && github.milestones.length > 0
            ? `\n| **Milestones** | ${github.milestones.map((m) => `${m.title} (${m.progress}${m.dueOn ? `, due ${m.dueOn.split('T')[0] ?? ''}` : ''})`).join(', ')} |`
            : ''

    // Insights row
    let insightsRow = ''
    if (github?.insights) {
        const parts: string[] = []
        if (github.insights.stars !== null) parts.push(`⭐ ${String(github.insights.stars)} stars`)
        if (github.insights.forks !== null) parts.push(`🍴 ${String(github.insights.forks)} forks`)
        if (github.insights.clones14d !== undefined)
            parts.push(`📦 ${String(github.insights.clones14d)} clones`)
        if (github.insights.views14d !== undefined)
            parts.push(`👁️ ${String(github.insights.views14d)} views`)
        if (parts.length > 0) {
            const trafficNote = github.insights.clones14d !== undefined ? ' (14d)' : ''
            insightsRow = `\n| **Insights** | ${parts.join(' · ')}${trafficNote} |`
        }
    }

    // Copilot row
    const copilotRow = github?.copilotReviews
        ? `\n| **Copilot** | ${String(github.copilotReviews.reviewed)} reviewed · ${String(github.copilotReviews.approved)} approved${github.copilotReviews.changesRequested > 0 ? ` · ${String(github.copilotReviews.changesRequested)} changes requested` : ''}${github.copilotReviews.totalComments > 0 ? ` (${String(github.copilotReviews.totalComments)} comments)` : ''} |`
        : ''

    const escapeTableCell = (text: string): string =>
        text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>')

    const summariesOutput =
        summaryPreviews && summaryPreviews.length > 0
            ? summaryPreviews.map((s) => `\n| **Summary** | ${escapeTableCell(s)} |`).join('')
            : ''

    return `📋 **Session Context Loaded**
| Context | Value |
|---------|-------|
| **Project** | ${escapeTableCell(repoName)} |
| **Branch** | ${escapeTableCell(branchName)} |
| **CI** | ${escapeTableCell(ciDisplay)} |
| **Journal** | ${totalEntries} entries |${opts.teamTotalEntries !== undefined ? `\n| **Team DB** | ${opts.teamTotalEntries} entries |` : ''}
| **Latest** | ${escapeTableCell(latestPreview)} |${summariesOutput}${issuesRow}${prsRow}${milestoneRow}${insightsRow}${copilotRow}${rulesFile ? `\n| **Rules** | ${escapeTableCell(rulesFile.name)} (${String(rulesFile.sizeKB)} KB, updated ${rulesFile.lastModified}) |` : ''}${skillsDir ? `\n| **Skills** | ${String(skillsDir.count)} skill${skillsDir.count !== 1 ? 's' : ''} available |` : ''}`
}
