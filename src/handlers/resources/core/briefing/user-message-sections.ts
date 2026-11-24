/**
 * Section builders for the briefing user message.
 * Kept separate so each formatter stays under the 80-line review limit.
 */

import type { BriefingGitHub } from './github-section.js'
import type { GraphSummary } from './context-section.js'
import type { BriefingInsights } from './insights-section.js'
import type { GitHistorySummary } from './system-section.js'
import {
    isRecentUnlinkedAlert,
    type BriefingGraphPivots,
    type BriefingToolNaming,
} from './graph-pivots-section.js'
import { fenceNonCanonicalRefOrKey } from '../../../../utils/security-utils.js'
import {
    escapeCell,
    escapeLinkLabel,
    fenceUntrustedList,
    sanitizeDisplayIdentifier,
} from '../../fencing-helpers.js'

export interface BriefingUserMessageOptions {
    repoName: string
    branchName: string
    ciStatus: string
    ciSuppressed?: boolean | undefined
    entriesSuppressed?: boolean | undefined
    totalEntries: number
    latestPreviews: string[]
    teamLatestPreviews?: string[] | undefined
    summaryPreviews?: string[] | null | undefined
    github: BriefingGitHub | null
    teamTotalEntries?: number | undefined
    analyticsInsights?: BriefingInsights | undefined
    graphSummary?: GraphSummary | undefined
    /** Cross-source pivots (degree, commit refs, active threads); absent when disabled */
    graphPivots?: BriefingGraphPivots | undefined
    /** Operation naming for hints; `codemode` emits `mj.*` APIs (default: direct) */
    toolNaming?: BriefingToolNaming | undefined
    /** Per-tool hint overrides for mixed presets (`starter`/`essential`/`readonly`). */
    toolHints?: {
        expand?: string | undefined
        link?: string | undefined
        summary?: string | undefined
        team?: string | undefined
    } | undefined
    gitHistory?: GitHistorySummary | null | undefined
    isReadonly?: boolean | undefined
    teamConfigured?: boolean | undefined
    githubConfigured?: boolean | undefined
    ioRootCount?: number | undefined
    deprecationWarnings?: string[] | undefined
    workspaceId?: string | undefined
}

/** [BOUNDARY] Only render workflow links that point at github.com without markdown/control chars. */
const SAFE_GITHUB_URL_RE = /^https:\/\/github\.com\/[^\s()<>[\]|\\'"\p{Cc}]+$/u

/** Compute a short relative-age string (e.g. '3d ago', '5h ago') from an ISO timestamp */
const relativeAge = (isoTimestamp: string): string | null => {
    try {
        const diffMs = Date.now() - new Date(isoTimestamp).getTime()
        if (diffMs < 0) return null
        const minutes = Math.floor(diffMs / 60_000)
        if (minutes < 60) return `${String(minutes)}m ago`
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return `${String(hours)}h ago`
        const days = Math.floor(hours / 24)
        return `${String(days)}d ago`
    } catch {
        return null
    }
}

export function formatCiDisplay(opts: BriefingUserMessageOptions): string {
    const github = opts.github
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
            const runItems = ws.runs.map((r) => {
                const icon = Object.hasOwn(icons, r.conclusion) ? icons[r.conclusion] : '❓'
                const display =
                    r.url && SAFE_GITHUB_URL_RE.test(r.url)
                        ? `[${escapeLinkLabel(r.name)}](${r.url})`
                        : r.name
                return `${icon} ${display}`
            })
            ciDisplay = fenceUntrustedList(runItems, ' · ')
        } else {
            ciDisplay = formatWorkflowCounts(ws, opts.ciStatus)
        }
    } else if (opts.ciStatus === 'failing' && github?.ciName) {
        ciDisplay = `❌ ${github.ciName} (build failed)`
    } else if (opts.ciStatus === 'passing' && github?.ciName) {
        ciDisplay = `✅ ${github.ciName} (passing)`
    }

    const ciAge = github?.ciUpdatedAt ? relativeAge(github.ciUpdatedAt) : null
    if (ciAge) ciDisplay += ` (${ciAge})`
    return ciDisplay
}

function formatWorkflowCounts(
    ws: NonNullable<BriefingGitHub['workflowSummary']>,
    fallback: string,
): string {
    const parts: string[] = []
    if (ws.passing > 0) parts.push(`${String(ws.passing)} passing`)
    if (ws.failing > 0) parts.push(`${String(ws.failing)} failing`)
    if (ws.pending > 0) parts.push(`${String(ws.pending)} pending`)
    if (ws.cancelled > 0) parts.push(`${String(ws.cancelled)} cancelled`)
    return parts.join(' · ') || fallback
}

export function buildGithubParts(opts: BriefingUserMessageOptions, ciDisplay: string): string[] {
    const suppressCi = opts.ciSuppressed === true || opts.github?.ciSuppressed === true
    const githubParts = [
        `**${escapeCell(fenceNonCanonicalRefOrKey(opts.repoName))}**`,
        escapeCell(fenceNonCanonicalRefOrKey(opts.branchName)),
        ...(suppressCi ? [] : [escapeCell(ciDisplay)]),
    ]
    const local = opts.github?.localGitStatus
    if (
        local &&
        !local.isClean &&
        (local.error === undefined || local.error === '') &&
        local.degraded !== true
    ) {
        githubParts.push(`Dirty (${String(local.modified)}M, ${String(local.untracked)}U)`)
    }
    return githubParts
}

export function buildTrackingParts(github: BriefingGitHub | null): string[] {
    const trackingParts: string[] = []
    if (!github) return trackingParts
    if (github.issuesSuppressed !== true) appendIssueTracking(github, trackingParts)
    if (github.prsSuppressed !== true) appendPullRequestTracking(github, trackingParts)
    if (github.copilotReviews) {
        const cr = github.copilotReviews
        trackingParts.push(
            `GH Copilot Reviews: ${String(cr.reviewed)} reviewed · ${String(cr.approved)} approved${cr.changesRequested > 0 ? ` · ${String(cr.changesRequested)} changes requested` : ''}${cr.totalComments > 0 ? ` (${String(cr.totalComments)} comments)` : ''}`
        )
    }
    appendMilestoneTracking(github, trackingParts)
    return trackingParts
}

function appendIssueTracking(github: BriefingGitHub, trackingParts: string[]): void {
    if (github.openIssueList && github.openIssueList.length > 0) {
        const titles = fenceUntrustedList(github.openIssueList.map((i) => `#${String(i.number)} ${i.title}`))
        trackingParts.push(`Issues: ${String(github.openIssues)} open: ${escapeCell(titles)}`)
        return
    }
    trackingParts.push(`Issues: ${String(github.openIssues)} open`)
}

function formatActivePrLine(apr: NonNullable<BriefingGitHub['activePr']>): string {
    const details: string[] = []
    if (apr.reviewSuppressed !== true) {
        let reviewStr = 'Pending Review'
        if (apr.reviewStatus === 'approved') reviewStr = 'Approved'
        else if (apr.reviewStatus === 'changes_requested')
            reviewStr = `Changes Requested (${String(apr.commentCount ?? 0)} comments)`
        else if (apr.reviewStatus) reviewStr = apr.reviewStatus
        details.push(escapeCell(reviewStr))
    }
    if (apr.ciSuppressed !== true) {
        const ciStr = apr.ciStatus
            ? `CI: ${apr.ciStatus.charAt(0).toUpperCase() + apr.ciStatus.slice(1)}`
            : 'CI: Unknown'
        details.push(escapeCell(ciStr))
    }
    const suffix = details.length > 0 ? details.join(' · ') : escapeCell(apr.title)
    return `Current PR (#${String(apr.number)}): ${suffix}`
}

function appendPullRequestTracking(github: BriefingGitHub, trackingParts: string[]): void {
    if (github.activePr) {
        trackingParts.push(formatActivePrLine(github.activePr))
    }

    if (github.prStatusSummary) {
        const s = github.prStatusSummary
        const parts: string[] = []
        if (s.open > 0) parts.push(`${String(s.open)} open`)
        if (s.merged > 0) parts.push(`${String(s.merged)} merged`)
        if (s.closed > 0) parts.push(`${String(s.closed)} closed`)
        const summaryText = parts.join(', ') || '0'
        if (github.openPrList && github.openPrList.length > 0) {
            const titles = fenceUntrustedList(github.openPrList.map((p) => `#${String(p.number)} ${p.title}`))
            trackingParts.push(`PRs: ${summaryText}: ${escapeCell(titles)}`)
        } else {
            trackingParts.push(`PRs: ${summaryText}`)
        }
        return
    }
    if (github.openPrList && github.openPrList.length > 0) {
        const titles = fenceUntrustedList(github.openPrList.map((p) => `#${String(p.number)} ${p.title}`))
        trackingParts.push(`PRs: ${String(github.openPRs)} open: ${escapeCell(titles)}`)
        return
    }
    trackingParts.push(`PRs: ${String(github.openPRs)} open`)
}

function appendMilestoneTracking(github: BriefingGitHub, trackingParts: string[]): void {
    if (github.milestones.length === 0) return
    const items = github.milestones.map(
        (m) =>
            `${m.title} (${m.progress}${m.progress === '100%' ? ' ✅' : ''}${m.dueOn ? `, due ${m.dueOn.split('T')[0] ?? ''}` : ''})`,
    )
    trackingParts.push(`MS: ${escapeCell(fenceUntrustedList(items))}`)
}

export function buildJournalParts(opts: BriefingUserMessageOptions): string[] {
    const journalLine1 = [`${String(opts.totalEntries)} entries`]
    if (opts.workspaceId) {
        // [BOUNDARY] No-registry mode echoes the raw URI segment; constrain before rendering.
        journalLine1.push(`Workspace: **${sanitizeDisplayIdentifier(opts.workspaceId)}**`)
    }
    if (opts.teamTotalEntries !== undefined) {
        journalLine1.push(`Team: ${String(opts.teamTotalEntries)}`)
    }

    const journalParts = [journalLine1.join(' · ')]
    const latestPreviews = opts.latestPreviews
    const summaryPreviews = opts.summaryPreviews
    // [INTENT] One fence per row segment: list items share a single untrusted wrapper.
    if (latestPreviews.length > 0) {
        journalParts.push(`Latest: ${escapeCell(fenceUntrustedList(latestPreviews))}`)
    } else if (opts.entriesSuppressed !== true && (!summaryPreviews || summaryPreviews.length === 0)) {
        journalParts.push('Latest: No entries yet')
    }
    if (summaryPreviews && summaryPreviews.length > 0) {
        // The Graph row's Expand line already names the expansion tool when pivots are on.
        const summaryTool =
            opts.toolHints?.summary ??
            (opts.toolNaming === 'codemode' ? 'mj.core.getEntryById' : 'get_entry_by_id')
        const summaryHint = opts.graphPivots !== undefined ? '' : ` (view: \`${summaryTool}\`)`
        journalParts.push(`Summary: ${escapeCell(fenceUntrustedList(summaryPreviews))}${summaryHint}`)
    }
    if (opts.teamLatestPreviews && opts.teamLatestPreviews.length > 0) {
        const teamTool =
            opts.toolHints?.team ??
            (opts.toolNaming === 'codemode' ? 'mj.team.teamGetEntryById' : 'team_get_entry_by_id')
        journalParts.push(
            `Team: ${escapeCell(fenceUntrustedList(opts.teamLatestPreviews))} (view: \`${teamTool}\`)`
        )
    }
    return journalParts
}

export function buildConfigLines(opts: BriefingUserMessageOptions): string[] {
    const configLines: string[] = []
    const configLine1: string[] = []
    if (opts.isReadonly) configLine1.push('mode: readonly')
    if (configLine1.length) configLines.push(configLine1.join(' · '))

    const configLine2: string[] = []
    configLine2.push(`team: ${opts.teamConfigured ? 'yes' : 'no (TEAM_DB_PATH unset)'}`)
    configLine2.push(`github: ${opts.githubConfigured ? 'yes' : 'no (token unset)'}`)
    if (configLine2.length) configLines.push(configLine2.join(' · '))

    const configLine3: string[] = []
    if (opts.ioRootCount !== undefined && opts.ioRootCount > 0) {
        configLine3.push(`IO: ${String(opts.ioRootCount)} root${opts.ioRootCount !== 1 ? 's' : ''}`)
    }
    if (configLine3.length) configLines.push(configLine3.join(' · '))
    return configLines
}

export function buildInsightsLines(opts: BriefingUserMessageOptions): string[] {
    const insightsLines: string[] = []
    appendRepoInsights(opts.github, insightsLines)
    // [INTENT] With graph pivots on, density moves to the Graph row next to the other graph metrics.
    appendAnalyticsInsights(opts.analyticsInsights, insightsLines, opts.graphPivots === undefined)
    return insightsLines
}

function appendRepoInsights(github: BriefingGitHub | null, insightsLines: string[]): void {
    if (github?.insights) {
        const parts: string[] = []
        if (github.insights.stars !== null) parts.push(`⭐ ${String(github.insights.stars)}`)
        if (github.insights.forks !== null) parts.push(`🍴 ${String(github.insights.forks)}`)
        if (github.insights.clones14d !== undefined) parts.push(`📦 ${String(github.insights.clones14d)}`)
        if (github.insights.views14d !== undefined) parts.push(`👁️ ${String(github.insights.views14d)}`)
        if (parts.length > 0) {
            const trafficNote = github.insights.clones14d !== undefined ? ' (14d)' : ''
            insightsLines.push(`${parts.join(' · ')}${trafficNote}`)
        }
    }
}

function appendAnalyticsInsights(
    analyticsInsights: BriefingInsights | undefined,
    insightsLines: string[],
    includeDensity = true,
): void {
    if (analyticsInsights === undefined) return
    insightsLines.push(`📈 ${escapeCell(analyticsInsights.activityTrend)}`)
    const metricParts: string[] = []
    if (analyticsInsights.significanceSpike !== null)
        metricParts.push(`🔥 ${escapeCell(analyticsInsights.significanceSpike)}`)
    if (includeDensity && analyticsInsights.relationshipDensity !== undefined)
        metricParts.push(`🔗 Density: ${escapeCell(String(analyticsInsights.relationshipDensity))}`)
    if (metricParts.length > 0) insightsLines.push(metricParts.join(' · '))
    if (analyticsInsights.staleProjects.length > 0)
        insightsLines.push(`💤 ${String(analyticsInsights.staleProjects.length)} stale projects`)
}

export { buildGraphLines } from './graph-lines.js'

export function buildGitHistoryLines(opts: BriefingUserMessageOptions): string[] {
    const gitHistoryLines: string[] = []
    if (!opts.gitHistory || opts.gitHistory.commits.length === 0) return gitHistoryLines
    const stats = opts.gitHistory.stats
    if (stats) {
        gitHistoryLines.push(
            `Velocity (${String(stats.total)}): ${String(stats.highImpact)} high · ${String(stats.lowImpact)} low`,
        )
    }

    // [INTENT] No commit hyperlinks or tool tip: agents can derive URLs from the GitHub row, and
    // ~75 chars/commit of URL carried little signal. All commit lines share one untrusted fence.
    const commitRefs = opts.graphPivots?.commitRefs
    const commitLines = opts.gitHistory.commits.map((c) => {
        const entryRef =
            commitRefs !== undefined && Object.hasOwn(commitRefs, c.hash)
                ? commitRefs[c.hash]
                : undefined
        return formatCommitLine(c, entryRef)
    })
    gitHistoryLines.push(`Recent: ${escapeCell(fenceUntrustedList(commitLines))}`)
    return gitHistoryLines
}

function formatCommitLine(c: GitHistorySummary['commits'][number], entryRef?: number): string {
    const metaParts: string[] = []
    if (c.type) metaParts.push(c.type)
    if (c.size) metaParts.push(c.size)
    if (c.significance !== undefined) metaParts.push(`Sig:${c.significance}`)
    if (c.confidence !== undefined) metaParts.push(`Conf:${c.confidence}`)
    if (c.isBreaking) metaParts.push('🚨')
    const metaStr = metaParts.length > 0 ? ` [${metaParts.join('|')}]` : ''
    const issuesStr =
        c.associatedIssues && c.associatedIssues.length > 0 ? ` (${c.associatedIssues.join(', ')})` : ''
    const refStr = entryRef !== undefined ? ` →#${String(entryRef)}` : ''
    return `${c.hash}${metaStr} ${c.message}${issuesStr}${refStr}`
}

export function buildFlagsAlert(opts: BriefingUserMessageOptions): string {
    let flagsAlert = ''
    const graphSummary = opts.graphSummary
    const pivots = opts.graphPivots
    if (pivots !== undefined) {
        // [INTENT] Recency-scoped: the all-time ratio is diluted by historical bulk-linking.
        if (isRecentUnlinkedAlert(pivots)) {
            const actionHint =
                opts.isReadonly === true
                    ? ''
                    : ` Link via \`relationships\` on create or \`${opts.toolHints?.link ?? (opts.toolNaming === 'codemode' ? 'mj.relationships.linkEntries' : 'link_entries')}\`.`
            flagsAlert += `⚠️ **Journal Health:** ${String(pivots.unlinkedEntries)}/${String(pivots.recentEntries)} entries (${String(pivots.windowDays)}d) unlinked ⚪, at risk of auto-prune.${actionHint}\n\n`
        }
    } else if (graphSummary?.orphanRatio !== undefined && graphSummary.orphanRatio > 0.2) {
        const orphanPct = Math.round(graphSummary.orphanRatio * 100)
        const actionHint =
            opts.isReadonly === true ? '' : ' Consider running `optimize-journal`.'
        flagsAlert += `⚠️ **Journal Health:** ${orphanPct}% of entries are orphaned (0 relationships).${actionHint}\n\n`
    }
    if (opts.deprecationWarnings && opts.deprecationWarnings.length > 0) {
        flagsAlert += `⚠️ **Deprecation Warning(s):**\n${opts.deprecationWarnings.map((w) => `🚩 ${w}`).join('\n')}\n\n`
    }
    return flagsAlert
}

export function assembleBriefingTable(rows: {
    githubParts: string[]
    trackingParts: string[]
    journalParts: string[]
    configLines: string[]
    insightsLines: string[]
    graphLines: string[]
    gitHistoryLines: string[]
}): string {
    const tableRows = [
        '| Context | Details |',
        '|---------|---------|',
        `| **GitHub** | ${rows.githubParts.join('<br>')} |`,
    ]
    if (rows.trackingParts.length > 0) {
        tableRows.push(`| **Tracking** | ${rows.trackingParts.join('<br>')} |`)
    }
    tableRows.push(`| **Journal** | ${rows.journalParts.join('<br>')} |`)
    if (rows.configLines.length > 0) {
        tableRows.push(`| **Config** | ${rows.configLines.join('<br>')} |`)
    }
    if (rows.insightsLines.length > 0) {
        tableRows.push(`| **Insights** | ${rows.insightsLines.join('<br>')} |`)
    }
    if (rows.graphLines.length > 0) {
        tableRows.push(`| **Graph** | ${rows.graphLines.join('<br>')} |`)
    }
    if (rows.gitHistoryLines.length > 0) {
        tableRows.push(`| **Git History** | ${rows.gitHistoryLines.join('<br>')} |`)
    }
    return tableRows.join('\n')
}
