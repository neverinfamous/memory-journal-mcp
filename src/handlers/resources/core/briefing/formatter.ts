import type { GitHubBriefingContext, TeamBriefingContext, SystemBriefingContext } from './types.js'

export function formatUserMessage(
    github: GitHubBriefingContext | null,
    totalEntries: number,
    latestEntries: { id: number; timestamp: string; type: string; preview: string }[],
    teamContext: TeamBriefingContext['teamContext'],
    rulesFile: SystemBriefingContext['rulesFile'],
    skillsDir: SystemBriefingContext['skillsDir']
): string {
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

    let insightsRow = ''
    if (github?.insights) {
        const parts: string[] = []
        if (github.insights.stars !== null) parts.push(`⭐ ${String(github.insights.stars)} stars`)
        if (github.insights.forks !== null) parts.push(`🍴 ${String(github.insights.forks)} forks`)
        if (github.insights.clones14d !== undefined) parts.push(`📦 ${String(github.insights.clones14d)} clones`)
        if (github.insights.views14d !== undefined) parts.push(`👁️ ${String(github.insights.views14d)} views`)
        if (parts.length > 0) {
            const trafficNote = github.insights.clones14d !== undefined ? ' (14d)' : ''
            insightsRow = `\n| **Insights** | ${parts.join(' · ')}${trafficNote} |`
        }
    }

    let issuesRow = ''
    let prsRow = ''
    if (github) {
        if (github.openIssueList && github.openIssueList.length > 0) {
            const titles = github.openIssueList.map((i) => `#${String(i.number)} ${i.title}`).join(' · ')
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
            const titles = github.openPrList.map((p) => `#${String(p.number)} ${p.title}`).join(' · ')
            prsRow = `\n| **PRs** | ${String(github.openPRs)} open: ${titles} |`
        } else {
            prsRow = `\n| **PRs** | ${String(github.openPRs)} open |`
        }
    }

    let ciDisplay = ciStatus as string
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
            ciDisplay = parts.join(' · ') || ciStatus
        }
    }

    const teamRow = teamContext ? `\n| **Team DB** | ${teamContext.totalEntries} entries |` : ''
    const copilotRow = github?.copilotReviews
        ? `\n| **Copilot** | ${String(github.copilotReviews.reviewed)} reviewed · ${String(github.copilotReviews.approved)} approved${github.copilotReviews.changesRequested > 0 ? ` · ${String(github.copilotReviews.changesRequested)} changes requested` : ''}${github.copilotReviews.totalComments > 0 ? ` (${String(github.copilotReviews.totalComments)} comments)` : ''} |`
        : ''
    const rulesRow = rulesFile ? `\n| **Rules** | ${rulesFile.name} (${String(rulesFile.sizeKB)} KB, updated ${rulesFile.lastModified}) |` : ''
    const skillsRow = skillsDir ? `\n| **Skills** | ${String(skillsDir.count)} skill${skillsDir.count !== 1 ? 's' : ''} available |` : ''

    return `📋 **Session Context Loaded**
| Context | Value |
|---------|-------|
| **Project** | ${repoName} |
| **Branch** | ${branchName} |
| **CI** | ${ciDisplay} |
| **Journal** | ${totalEntries} entries |${teamRow}
| **Latest** | ${latestPreview} |${issuesRow}${prsRow}${milestoneRow}${insightsRow}${copilotRow}${rulesRow}${skillsRow}`
}
