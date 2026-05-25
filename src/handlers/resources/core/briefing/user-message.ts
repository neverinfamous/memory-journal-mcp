/**
 * Briefing — User Message Formatter
 *
 * Formats the briefing as a hybrid markdown layout:
 * - Table rows for dense groups (GitHub, Journal, System) — compresses
 *   multiple data points into single rows using · separators.
 * - Flat lines for metrics/analytics — emoji-heavy content reads better
 *   as standalone lines.
 *
 * No HTML `<br>` tags are used — table cells use · separators for
 * universal renderer compatibility.
 */

import type { BriefingGitHub } from './github-section.js'
import type { RulesFile, SkillsDir, FlagSummary, GraphSummary } from './context-section.js'
import type { BriefingInsights } from './insights-section.js'
import type { UnreleasedSummary, TestHealth } from './system-section.js'

const escapeContent = (text: string): string =>
    text.replace(/<\/?untrusted_remote_content[^>]*>/gi, '').replace(/\r?\n/g, ' ')

/** Escape pipe characters for use inside markdown table cells */
const escapeCell = (text: string): string => escapeContent(text).replace(/\|/g, '\\|')

/**
 * Build the user-facing markdown output for the briefing.
 */
export function formatUserMessage(opts: {
    repoName: string
    branchName: string
    ciStatus: string
    totalEntries: number
    latestPreviews: string[]
    summaryPreviews?: string[] | null
    github: BriefingGitHub | null
    teamTotalEntries?: number
    rulesFile?: RulesFile
    skillsDir?: SkillsDir
    analyticsInsights?: BriefingInsights
    flagSummary?: FlagSummary
    graphSummary?: GraphSummary
    version?: string
    toolCount?: number
    resourceCount?: number
    promptCount?: number
    localTime?: string
    unreleasedSummary?: UnreleasedSummary
    testHealth?: TestHealth
    filterSummary?: string | null
    instructionLevel?: string
    registryRepos?: string[] | null
    ioRootCount?: number
    hasCodeMap?: boolean
}): string {
    const {
        repoName,
        branchName,
        totalEntries,
        latestPreviews,
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

    // ========================================================================
    // TABLE ROW 1: GitHub
    // ========================================================================
    const githubParts = [
        escapeCell(repoName),
        `${escapeCell(branchName)} · ${escapeCell(ciDisplay)}`,
    ]

    // ========================================================================
    // TABLE ROW 2: Tracking (Issues · PRs · Milestones)
    // ========================================================================
    const trackingParts: string[] = []

    if (github) {
        // Issues
        if (github.openIssueList && github.openIssueList.length > 0) {
            const titles = github.openIssueList
                .map((i) => `#${String(i.number)} ${i.title}`)
                .join(' · ')
            trackingParts.push(`Issues: ${String(github.openIssues)} open: ${escapeCell(titles)}`)
        } else {
            trackingParts.push(`Issues: ${String(github.openIssues)} open`)
        }

        // PRs
        if (github.prStatusSummary) {
            const s = github.prStatusSummary
            const parts: string[] = []
            if (s.open > 0) parts.push(`${String(s.open)} open`)
            if (s.merged > 0) parts.push(`${String(s.merged)} merged`)
            if (s.closed > 0) parts.push(`${String(s.closed)} closed`)
            trackingParts.push(`PRs: ${parts.join(', ') || '0'}`)
        } else if (github.openPrList && github.openPrList.length > 0) {
            const titles = github.openPrList.map((p) => `#${String(p.number)} ${p.title}`).join(' · ')
            trackingParts.push(`PRs: ${String(github.openPRs)} open: ${escapeCell(titles)}`)
        } else {
            trackingParts.push(`PRs: ${String(github.openPRs)} open`)
        }

        // Milestones
        if (github.milestones.length > 0) {
            trackingParts.push(
                `MS: ${escapeCell(
                    github.milestones
                        .map(
                            (m) =>
                                `${m.title} (${m.progress}${m.progress === '100%' ? ' ✅' : ''}${m.dueOn ? `, due ${m.dueOn.split('T')[0] ?? ''}` : ''})`
                        )
                        .join(', ')
                )}`
            )
        }
    }

    // ========================================================================
    // TABLE ROW 2: Journal
    // ========================================================================
    const journalParts = [`${String(totalEntries)} entries`]
    if (opts.teamTotalEntries !== undefined) {
        journalParts.push(`Team: ${String(opts.teamTotalEntries)}`)
    }
    if (latestPreviews.length > 0) {
        journalParts.push(`Latest: ${escapeCell(latestPreviews[0] ?? '')}`)
        for (let i = 1; i < latestPreviews.length; i++) {
            journalParts.push(`Entry: ${escapeCell(latestPreviews[i] ?? '')}`)
        }
    } else {
        journalParts.push('Latest: No entries yet')
    }
    if (summaryPreviews && summaryPreviews.length > 0) {
        for (const s of summaryPreviews) {
            journalParts.push(`Summary: ${escapeCell(s)}`)
        }
    }

    // ========================================================================
    // TABLE ROW 3: System
    // ========================================================================
    const systemParts: string[] = []

    // Version + surface area
    if (opts.version) systemParts.push(`v${opts.version}`)
    if (opts.toolCount !== undefined) {
        if (opts.filterSummary) {
            // Show filter annotation: "70 tools (filter: codemode → 1)"
            systemParts.push(`${String(opts.toolCount)} tools (filter: ${escapeCell(opts.filterSummary)})`)
        } else {
            systemParts.push(`${String(opts.toolCount)} tools`)
        }
    }
    if (opts.resourceCount !== undefined) systemParts.push(`${String(opts.resourceCount)} res`)
    if (opts.promptCount !== undefined) systemParts.push(`${String(opts.promptCount)} prompts`)

    // Test health
    if (opts.testHealth) {
        const th = opts.testHealth
        const covStr = th.coverage > 0 ? ` (${String(Math.round(th.coverage))}%)` : ''
        systemParts.push(`Tests: ${String(th.unitTests)}+${String(th.e2eTests)} E2E${covStr}`)
    }

    // Local time
    if (opts.localTime) systemParts.push(opts.localTime)

    // Rules + Skills
    if (rulesFile) {
        systemParts.push(
            `${escapeCell(rulesFile.name)} (${String(rulesFile.sizeKB)} KB)`
        )
    }
    if (skillsDir) {
        systemParts.push(`${String(skillsDir.count)} skill${skillsDir.count !== 1 ? 's' : ''}`)
    }
    // Code-map indicator
    if (opts.hasCodeMap) {
        systemParts.push('📋 code-map')
    }

    // ========================================================================
    // TABLE ROW 4: Config (only when non-default values present)
    // ========================================================================
    const configParts: string[] = []

    if (opts.filterSummary) {
        configParts.push(`filter: ${escapeCell(opts.filterSummary)}`)
    }
    if (opts.instructionLevel && opts.instructionLevel !== 'standard') {
        configParts.push(`level: ${opts.instructionLevel}`)
    }
    if (opts.ioRootCount !== undefined && opts.ioRootCount > 0) {
        configParts.push(`IO: ${String(opts.ioRootCount)} root${opts.ioRootCount !== 1 ? 's' : ''}`)
    }
    if (opts.registryRepos && opts.registryRepos.length > 0) {
        const repoNames = opts.registryRepos.slice(0, 3).join(', ')
        const suffix = opts.registryRepos.length > 3 ? ` +${String(opts.registryRepos.length - 3)}` : ''
        configParts.push(`registry: ${escapeCell(repoNames)}${suffix}`)
    }

    // ========================================================================
    // FLAT LINES: Insights + Analytics
    // ========================================================================
    const flatLines: string[] = []

    // Insights
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
            flatLines.push(`**Insights:** ${parts.join(' · ')}${trafficNote}`)
        }
    }
    if (github?.copilotReviews) {
        const cr = github.copilotReviews
        flatLines.push(
            `**Copilot:** ${String(cr.reviewed)} reviewed · ${String(cr.approved)} approved${cr.changesRequested > 0 ? ` · ${String(cr.changesRequested)} changes requested` : ''}${cr.totalComments > 0 ? ` (${String(cr.totalComments)} comments)` : ''}`
        )
    }

    // Analytics
    if (analyticsInsights) {
        flatLines.push(`📈 ${analyticsInsights.activityTrend}`)
        const metricParts: string[] = []
        if (analyticsInsights.significanceSpike !== null)
            metricParts.push(`🔥 ${analyticsInsights.significanceSpike}`)
        if (analyticsInsights.relationshipDensity !== undefined)
            metricParts.push(`🔗 Density: ${analyticsInsights.relationshipDensity}`)
        if (metricParts.length > 0) flatLines.push(metricParts.join(' · '))
        if (analyticsInsights.staleProjects.length > 0)
            flatLines.push(`💤 ${analyticsInsights.staleProjects.length} stale projects`)
    }

    // Graph (suppress when zero)
    if (graphSummary && graphSummary.totalRelationships > 0) {
        const topTypes = Object.entries(graphSummary.causalMetrics)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type}: ${String(count)}`)
            .join(', ') || 'none'
        flatLines.push(
            `**Graph:** ${String(graphSummary.totalRelationships)} relationships · Top: ${escapeContent(topTypes)}`
        )
    }

    // Unreleased
    if (opts.unreleasedSummary) {
        const u = opts.unreleasedSummary
        const parts: string[] = []
        if (u.added > 0) parts.push(`${String(u.added)} added`)
        if (u.changed > 0) parts.push(`${String(u.changed)} changed`)
        if (u.fixed > 0) parts.push(`${String(u.fixed)} fixed`)
        if (u.security > 0) parts.push(`${String(u.security)} security`)
        if (u.removed > 0) parts.push(`${String(u.removed)} removed`)
        if (parts.length > 0) {
            let line = `**Unreleased:** ${parts.join(' · ')}`
            if ((u.keyItems?.length ?? 0) > 0) {
                line += ` | Key: ${u.keyItems.join(', ')}`
            }
            flatLines.push(line)
        }
    }

    // ========================================================================
    // Assembly
    // ========================================================================
    let flagsAlert = ''
    if (opts.flagSummary && opts.flagSummary.count > 0) {
        flagsAlert = `⚠️ **${String(opts.flagSummary.count)} active flag(s)** — review before proceeding.\n${opts.flagSummary.flags.map((f) => `🚩 ${f.flag_type}${f.target_user ? ` → @${f.target_user}` : ''}: ${f.fullContent.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')}`).join('\n')}\n\n`
    }

    // Build table
    const tableRows = [
        '| Context | Details |',
        '|---------|---------|',
        `| **GitHub** | ${githubParts.join(' · ')} |`,
    ]
    if (trackingParts.length > 0) {
        tableRows.push(`| **Tracking** | ${trackingParts.join(' · ')} |`)
    }
    tableRows.push(`| **Journal** | ${journalParts.join(' · ')} |`)
    if (systemParts.length > 0) {
        tableRows.push(`| **System** | ${systemParts.join(' · ')} |`)
    }
    if (configParts.length > 0) {
        tableRows.push(`| **Config** | ${configParts.join(' · ')} |`)
    }

    const sections: string[] = [tableRows.join('\n')]
    if (flatLines.length > 0) sections.push(flatLines.join('\n'))

    return `${flagsAlert}${sections.join('\n')}`
}
