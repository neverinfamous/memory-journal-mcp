/**
 * Briefing — User Message Formatter
 *
 * Formats the briefing as a hybrid markdown layout:
 * - Table rows for dense groups (GitHub, Journal, System) — compresses
 *   data points using `<br>` and `·` separators for human readability.
 * - Flat lines for metrics/analytics — emoji-heavy content reads better
 *   as standalone lines.
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
    isReadonly?: boolean
    teamConfigured?: boolean
    githubConfigured?: boolean
    instructionLevel?: string
    registryRepos?: string[] | null
    ioRootCount?: number
    hasCodeMap?: boolean
    lastReleaseDaysAgo?: number
    localCheck?: boolean
    deprecationWarnings?: string[]
    /** Registered workspace paths for non-IDE agents: { repoName: diskPath } */
    registryPaths?: Record<string, string>
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
    } else if (opts.ciStatus === 'failing' && github?.ciName) {
        ciDisplay = `❌ ${github.ciName} (build failed)`
    } else if (opts.ciStatus === 'passing' && github?.ciName) {
        ciDisplay = `✅ ${github.ciName} (passing)`
    }

    // ========================================================================
    // TABLE ROW 1: GitHub
    // ========================================================================
    let gitStatus = ''
    if (github?.localGitStatus) {
        const { modified, untracked, isClean } = github.localGitStatus
        if (isClean) {
            gitStatus = ' · Git: Clean'
        } else {
            const parts: string[] = []
            if (modified > 0) parts.push(`${String(modified)} modified`)
            if (untracked > 0) parts.push(`${String(untracked)} untracked`)
            gitStatus = ` · Git: ${parts.join(', ')}`
        }
    }

    const githubParts = [
        `**${escapeCell(repoName)}**`,
        `${escapeCell(branchName)}${escapeCell(gitStatus)}`,
        escapeCell(ciDisplay),
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
    // TABLE ROW 3: Journal
    // ========================================================================
    const journalLine1 = [`${String(totalEntries)} entries`]
    if (opts.teamTotalEntries !== undefined) {
        journalLine1.push(`Team: ${String(opts.teamTotalEntries)}`)
    }
    
    const journalParts = [journalLine1.join(' · ')]
    
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
    // TABLE ROW 4: System
    // ========================================================================
    const sysLines: string[] = []

    const sysLine1 = []
    if (opts.version) sysLine1.push(`v${opts.version}`)
    if (opts.toolCount !== undefined) {
        if (opts.filterSummary) {
            const isCodeMode = opts.filterSummary.includes('codemode')
            const codeModeNote = isCodeMode ? ' (100KB cap) — use mj.* API' : ''
            sysLine1.push(`${String(opts.toolCount)} tools (filter: ${escapeCell(opts.filterSummary)}${codeModeNote})`)
        } else {
            sysLine1.push(`${String(opts.toolCount)} tools`)
        }
    }
    if (opts.resourceCount !== undefined) sysLine1.push(`${String(opts.resourceCount)} res`)
    if (opts.promptCount !== undefined) sysLine1.push(`${String(opts.promptCount)} prompts`)
    if (sysLine1.length) sysLines.push(sysLine1.join(' · '))

    const sysLine2 = ['📊 memory://metrics/summary']
    if (opts.testHealth) {
        const th = opts.testHealth
        const covStr = th.coverage > 0 ? ` (${String(Math.round(th.coverage))}%)` : ''
        sysLine2.push(`Tests: ${String(th.unitTests)}+${String(th.e2eTests)} E2E${covStr}`)
    }
    if (opts.localCheck !== undefined) {
        sysLine2.push(`Local Check: ${opts.localCheck ? '✅' : '❌'}`)
    }
    sysLines.push(sysLine2.join(' · '))

    const sysLine3 = []
    if (opts.localTime) sysLine3.push(opts.localTime)
    if (rulesFile) sysLine3.push(`${escapeCell(rulesFile.name)} (${String(rulesFile.sizeKB)} KB)`)
    if (skillsDir) sysLine3.push(`${String(skillsDir.count)} skill${skillsDir.count !== 1 ? 's' : ''}`)
    if (sysLine3.length) sysLines.push(sysLine3.join(' · '))

    if (opts.hasCodeMap) {
        sysLines.push('📋 code-map (test-server/code-map.md) · 🛠️ tools (test-server/tool-reference.md)')
    }

    // ========================================================================
    // TABLE ROW 5: Config (only when non-default values present)
    // ========================================================================
    const configLines: string[] = []
    
    const configLine1: string[] = []
    if (opts.isReadonly) configLine1.push('mode: readonly')
    configLine1.push(`team: ${opts.teamConfigured ? 'yes' : 'no'}`)
    configLine1.push(`github: ${opts.githubConfigured ? 'yes' : 'no'}`)
    if (opts.instructionLevel) configLine1.push(`level: ${opts.instructionLevel}`)
    if (configLine1.length) configLines.push(configLine1.join(' · '))
    
    const configLine2: string[] = []
    if (opts.ioRootCount !== undefined && opts.ioRootCount > 0) {
        configLine2.push(`IO: ${String(opts.ioRootCount)} root${opts.ioRootCount !== 1 ? 's' : ''}`)
    }
    if (opts.registryRepos && opts.registryRepos.length > 0) {
        const repoNames = opts.registryRepos.slice(0, 3).join(', ')
        const suffix = opts.registryRepos.length > 3 ? ` +${String(opts.registryRepos.length - 3)}` : ''
        configLine2.push(`registry: ${escapeCell(repoNames)}${suffix}`)
    }
    if (configLine2.length) configLines.push(configLine2.join(' · '))

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
            `**Graph:** ${String(graphSummary.totalRelationships)} relationships · Top: ${escapeContent(topTypes)} (view: memory://graph/recent)`
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
            const ageStr = opts.lastReleaseDaysAgo !== undefined
                ? `(${String(opts.lastReleaseDaysAgo)}d) `
                : ''
            let line = `**Unreleased:** ${ageStr}${parts.join(' · ')}`
            if ((u.keyItems?.length ?? 0) > 0) {
                line += ` | Recent focus: ${u.keyItems.join(', ')}`
            }
            flatLines.push(line)
        }
    }

    // Registered workspace paths (useful for non-IDE agents without <user_information>)
    if (opts.registryPaths) {
        const entries = Object.entries(opts.registryPaths)
        if (entries.length > 0) {
            const pathList = entries
                .map(([name, diskPath]) => {
                    const isActive = name === repoName || name === repoName.split('/').pop()
                    const formatted = `${escapeContent(name)}: ${escapeContent(diskPath)}`
                    return isActive ? `**${formatted}** (active)` : formatted
                })
                .join('<br>')
            flatLines.push(`**Workspaces:**<br>${pathList}`)
        }
    }

    // ========================================================================
    // Assembly
    // ========================================================================
    let flagsAlert = ''
    if (opts.flagSummary && opts.flagSummary.count > 0) {
        flagsAlert = `⚠️ **${String(opts.flagSummary.count)} active flag(s)** — review before proceeding.\n${opts.flagSummary.flags.map((f) => `🚩 ${f.flag_type}${f.target_user ? ` → @${f.target_user}` : ''}: ${f.fullContent.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')}`).join('\n')}\n\n`
    }

    if (opts.deprecationWarnings && opts.deprecationWarnings.length > 0) {
        flagsAlert += `⚠️ **Deprecation Warning(s):**\n${opts.deprecationWarnings.map((w) => `🚩 ${w}`).join('\n')}\n\n`
    }

    // Build table
    const tableRows = [
        '| Context | Details |',
        '|---------|---------|',
        `| **GitHub** | ${githubParts.join('<br>')} |`,
    ]
    if (trackingParts.length > 0) {
        tableRows.push(`| **Tracking** | ${trackingParts.join('<br>')} |`)
    }
    tableRows.push(`| **Journal** | ${journalParts.join('<br>')} |`)
    if (sysLines.length > 0) {
        tableRows.push(`| **System** | ${sysLines.join('<br>')} |`)
    }
    if (configLines.length > 0) {
        tableRows.push(`| **Config** | ${configLines.join('<br>')} |`)
    }

    const sections: string[] = [tableRows.join('\n')]
    if (flatLines.length > 0) sections.push(flatLines.join('\n\n'))

    return `${flagsAlert}${sections.join('\n')}`
}
