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

export interface BriefingUserMessageOptions {
    repoName: string
    branchName: string
    ciStatus: string
    ciSuppressed?: boolean
    entriesSuppressed?: boolean
    totalEntries: number
    latestPreviews: string[]
    teamLatestPreviews?: string[]
    summaryPreviews?: string[] | null
    github: BriefingGitHub | null
    teamTotalEntries?: number
    analyticsInsights?: BriefingInsights
    graphSummary?: GraphSummary
    /** Cross-source pivots (degree, commit refs, active threads); absent when disabled */
    graphPivots?: BriefingGraphPivots
    /** Operation naming for hints; `codemode` emits `mj.*` APIs (default: legacy mixed hints) */
    toolNaming?: BriefingToolNaming
    gitHistory?: GitHistorySummary | null
    isReadonly?: boolean
    teamConfigured?: boolean
    githubConfigured?: boolean
    ioRootCount?: number
    deprecationWarnings?: string[]
    workspaceId?: string
}

const escapeContent = (text: string): string =>
    text.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\p{Cc}/gu, '')

/** Escape pipe characters for use inside markdown table cells */
const escapeCell = (text: string): string =>
    escapeContent(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')

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
            ciDisplay = ws.runs
                .map((r) => `${icons[r.conclusion] ?? '❓'} ${r.url ? `[${r.name}](${r.url})` : r.name}`)
                .join(' · ')
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
        `**${escapeCell(opts.repoName)}**`,
        escapeCell(fenceNonCanonicalRefOrKey(opts.branchName)),
        ...(suppressCi ? [] : [escapeCell(ciDisplay)]),
    ]
    const local = opts.github?.localGitStatus
    if (local && !local.isClean) {
        githubParts.push(`Dirty (${String(local.modified)}M, ${String(local.untracked)}U)`)
    }
    return githubParts
}

export function buildTrackingParts(github: BriefingGitHub | null): string[] {
    const trackingParts: string[] = []
    if (!github) return trackingParts
    if (github.issuesSuppressed !== true) appendIssueTracking(github, trackingParts)
    if (github.prsSuppressed !== true) appendPullRequestTracking(github, trackingParts)
    appendMilestoneTracking(github, trackingParts)
    return trackingParts
}

function appendIssueTracking(github: BriefingGitHub, trackingParts: string[]): void {
    if (github.openIssueList && github.openIssueList.length > 0) {
        const titles = github.openIssueList.map((i) => `#${String(i.number)} ${i.title}`).join(' · ')
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
            const titles = github.openPrList.map((p) => `#${String(p.number)} ${p.title}`).join(' · ')
            trackingParts.push(`PRs: ${summaryText}: ${escapeCell(titles)}`)
        } else {
            trackingParts.push(`PRs: ${summaryText}`)
        }
        return
    }
    if (github.openPrList && github.openPrList.length > 0) {
        const titles = github.openPrList.map((p) => `#${String(p.number)} ${p.title}`).join(' · ')
        trackingParts.push(`PRs: ${String(github.openPRs)} open: ${escapeCell(titles)}`)
        return
    }
    trackingParts.push(`PRs: ${String(github.openPRs)} open`)
}

function appendMilestoneTracking(github: BriefingGitHub, trackingParts: string[]): void {
    if (github.milestones.length === 0) return
    trackingParts.push(
        `MS: ${escapeCell(
            github.milestones
                .map(
                    (m) =>
                        `${m.title} (${m.progress}${m.progress === '100%' ? ' ✅' : ''}${m.dueOn ? `, due ${m.dueOn.split('T')[0] ?? ''}` : ''})`,
                )
                .join(', '),
        )}`,
    )
}

export function buildJournalParts(opts: BriefingUserMessageOptions): string[] {
    const journalLine1 = [`${String(opts.totalEntries)} entries`]
    if (opts.workspaceId) {
        journalLine1.push(`Workspace: **${escapeCell(opts.workspaceId)}**`)
    }
    if (opts.teamTotalEntries !== undefined) {
        journalLine1.push(`Team: ${String(opts.teamTotalEntries)}`)
    }

    const journalParts = [journalLine1.join(' · ')]
    const latestPreviews = opts.latestPreviews
    const summaryPreviews = opts.summaryPreviews
    if (latestPreviews.length > 0) {
        journalParts.push(`Latest: ${escapeCell(latestPreviews[0] ?? '')}`)
        for (let i = 1; i < latestPreviews.length; i++) {
            journalParts.push(`Entry: ${escapeCell(latestPreviews[i] ?? '')}`)
        }
    } else if (opts.entriesSuppressed !== true && (!summaryPreviews || summaryPreviews.length === 0)) {
        journalParts.push('Latest: No entries yet')
    }
    if (summaryPreviews && summaryPreviews.length > 0) {
        const summaryHint =
            opts.toolNaming === 'direct'
                ? '`get_entry_by_id`'
                : '`mj.core.getEntryById` via `mj_execute_code`'
        for (const s of summaryPreviews) {
            const cleaned = s.replace(/#+\s/g, '').replace(/\*\*/g, '').replace(/[-*]\s/g, '• ')
            journalParts.push(
                `Summary: ${escapeCell(cleaned)} (Use ${summaryHint} to view full entry)`,
            )
        }
    }
    if (opts.teamLatestPreviews && opts.teamLatestPreviews.length > 0) {
        const teamHint = opts.toolNaming === 'direct' ? '`team_get_entry_by_id`' : '`mj.team.teamGetEntryById`'
        for (const teamEntry of opts.teamLatestPreviews) {
            journalParts.push(
                `Team: ${escapeCell(teamEntry)} (Use ${teamHint} to view full team entry)`,
            )
        }
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
    if (github?.copilotReviews) {
        const cr = github.copilotReviews
        insightsLines.push(
            `GH Copilot Reviews: ${String(cr.reviewed)} reviewed · ${String(cr.approved)} approved${cr.changesRequested > 0 ? ` · ${String(cr.changesRequested)} changes requested` : ''}${cr.totalComments > 0 ? ` (${String(cr.totalComments)} comments)` : ''}`,
        )
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
            `**Velocity (Last ${stats.total}):** ${stats.highImpact} High Impact | ${stats.lowImpact} Low Impact | Avg Conf: ${stats.avgConfidence.toFixed(2)}`,
        )
    }

    const rawRepo = opts.github?.repo
    const repoPathUrl =
        typeof rawRepo === 'string' && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(rawRepo)
            ? `https://github.com/${rawRepo}/commit/`
            : null
    const commitRefs = opts.graphPivots?.commitRefs
    const shortCommits = opts.gitHistory.commits
        .map((c) => formatCommitLine(c, repoPathUrl, commitRefs?.[c.hash]))
        .join('<br>')
    gitHistoryLines.push(`**Recent Changes:**<br>${shortCommits}`)
    const historyHint =
        opts.toolNaming === 'codemode'
            ? '`mj.git.getCommitHistory` or `mj.git.searchCommits`'
            : '`get_commit_history` or `search_commits`'
    gitHistoryLines.push(
        `💡 **Tip:** Use ${historyHint} for deep Git history analysis instead of raw git commands.`,
    )
    return gitHistoryLines
}

function formatCommitLine(
    c: GitHistorySummary['commits'][number],
    repoPathUrl: string | null,
    entryRef?: number,
): string {
    const safeHash = escapeCell(fenceNonCanonicalRefOrKey(c.hash))
    const isValidHexSha = /^[0-9a-f]{4,64}$/i.test(c.hash)
    const shaText =
        c.isPushed && repoPathUrl !== null && isValidHexSha
            ? `[\`${safeHash}\`](${repoPathUrl}${c.hash})`
            : `\`${safeHash}\``
    const metaParts: string[] = []
    if (c.type) metaParts.push(escapeCell(fenceNonCanonicalRefOrKey(c.type)))
    if (c.size) metaParts.push(escapeCell(fenceNonCanonicalRefOrKey(c.size)))
    if (c.significance !== undefined) metaParts.push(`Sig:${c.significance}`)
    if (c.confidence !== undefined) metaParts.push(`Conf:${c.confidence}`)
    if (c.isBreaking) metaParts.push('🚨')
    const metaStr = metaParts.length > 0 ? ` [${metaParts.join('|')}]` : ''
    const issuesStr =
        c.associatedIssues && c.associatedIssues.length > 0
            ? ` (${c.associatedIssues.map((i) => escapeCell(i)).join(', ')})`
            : ''
    const refStr = entryRef !== undefined ? ` →#${String(entryRef)}` : ''
    return `${shaText}${metaStr} ${escapeCell(c.message)}${issuesStr}${refStr}`
}

export function buildFlagsAlert(opts: BriefingUserMessageOptions): string {
    let flagsAlert = ''
    const graphSummary = opts.graphSummary
    const pivots = opts.graphPivots
    if (pivots !== undefined) {
        // [INTENT] Recency-scoped: the all-time ratio is diluted by historical bulk-linking.
        if (isRecentUnlinkedAlert(pivots)) {
            const linkHint = opts.toolNaming === 'codemode' ? '`mj.relationships.linkEntries`' : '`link_entries`'
            flagsAlert += `⚠️ **Journal Health:** ${String(pivots.unlinkedEntries)}/${String(pivots.recentEntries)} entries from the last ${String(pivots.windowDays)} days are unlinked (⚪) and at risk of auto-prune. Link them via \`relationships\` on create or ${linkHint}.\n\n`
        }
    } else if (graphSummary?.orphanRatio !== undefined && graphSummary.orphanRatio > 0.2) {
        const orphanPct = Math.round(graphSummary.orphanRatio * 100)
        flagsAlert += `⚠️ **Journal Health:** ${orphanPct}% of entries are orphaned (0 relationships). Consider running \`optimize-journal\`.\n\n`
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
