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
import type { GitHistorySummary, TestHealth } from './system-section.js'

const escapeContent = (text: string): string =>
    text.replace(/<\/?untrusted_remote_content[^>]*>/gi, '').replace(/\r?\n/g, ' ')

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
    gitHistory?: GitHistorySummary | null
    testHealth?: TestHealth
    filterSummary?: string | null
    isReadonly?: boolean
    teamConfigured?: boolean
    githubConfigured?: boolean
    registryRepos?: string[] | null
    ioRootCount?: number
    hasCodeMap?: boolean
    lastReleaseDaysAgo?: number
    localCheck?: boolean
    deprecationWarnings?: string[]
    workspaceId?: string
    /** Registered workspace paths for non-IDE agents: { repoName: diskPath } */
    registryPaths?: Record<string, string>
    /** Registered project numbers for display: { repoName: numericId } */
    registryProjectNumbers?: Record<string, number>
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
            ciDisplay = ws.runs.map((r) => `${icons[r.conclusion] ?? '❓'} ${r.url ? `[${r.name}](${r.url})` : r.name}`).join(' · ')
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

    // Append relative age to CI display if timestamp available
    const ciAge = github?.ciUpdatedAt ? relativeAge(github.ciUpdatedAt) : null
    if (ciAge) ciDisplay += ` (${ciAge})`

    // ========================================================================
    // TABLE ROW 1: GitHub
    // ========================================================================
    const githubParts = [
        `**${escapeCell(repoName)}**`,
        escapeCell(branchName),
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
        if (github.activePr) {
            const apr = github.activePr
            let reviewStr = 'Pending Review'
            if (apr.reviewStatus === 'approved') reviewStr = 'Approved'
            else if (apr.reviewStatus === 'changes_requested') reviewStr = `Changes Requested (${String(apr.commentCount ?? 0)} comments)`
            else if (apr.reviewStatus) reviewStr = apr.reviewStatus
            
            const ciStr = apr.ciStatus ? `CI: ${apr.ciStatus.charAt(0).toUpperCase() + apr.ciStatus.slice(1)}` : 'CI: Unknown'
            trackingParts.push(`Current PR (#${String(apr.number)}): ${escapeCell(reviewStr)} · ${escapeCell(ciStr)}`)
        }

        if (github.prStatusSummary) {
            const s = github.prStatusSummary
            const parts: string[] = []
            if (s.open > 0) parts.push(`${String(s.open)} open`)
            if (s.merged > 0) parts.push(`${String(s.merged)} merged`)
            if (s.closed > 0) parts.push(`${String(s.closed)} closed`)
            trackingParts.push(`PRs: ${parts.join(', ') || '0'}`)
        } else if (github.openPrList && github.openPrList.length > 0) {
            const titles = github.openPrList
                .map((p) => `#${String(p.number)} ${p.title}`)
                .join(' · ')
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
    if (opts.workspaceId) {
        journalLine1.push(`Workspace: **${escapeCell(opts.workspaceId)}**`)
    }
    if (opts.teamTotalEntries !== undefined) {
        journalLine1.push(`Team: ${String(opts.teamTotalEntries)}`)
    }

    const journalParts = [journalLine1.join(' · ')]

    if (latestPreviews.length > 0) {
        journalParts.push(`Latest: ${escapeCell(latestPreviews[0] ?? '')}`)
        for (let i = 1; i < latestPreviews.length; i++) {
            journalParts.push(`Entry: ${escapeCell(latestPreviews[i] ?? '')}`)
        }
    } else if (!summaryPreviews || summaryPreviews.length === 0) {
        journalParts.push('Latest: No entries yet')
    }
    if (summaryPreviews && summaryPreviews.length > 0) {
        for (const s of summaryPreviews) {
            const cleaned = s.replace(/#+\s/g, '').replace(/\*\*/g, '').replace(/[-*]\s/g, '• ')
            journalParts.push(`Summary: ${escapeCell(cleaned)}`)
        }
    }

    // ========================================================================
    // TABLE ROW 4: System
    // ========================================================================
    const sysLines: string[] = []

    const sysLine1 = []
    if (opts.version) sysLine1.push(`v${opts.version}`)
    if (opts.resourceCount !== undefined) sysLine1.push(`${String(opts.resourceCount)} resources`)
    if (opts.promptCount !== undefined) sysLine1.push(`${String(opts.promptCount)} prompts`)
    if (sysLine1.length) sysLines.push(sysLine1.join(' · '))

    if (opts.toolCount !== undefined) {
        if (opts.filterSummary) {
            const isCodeMode = opts.filterSummary.includes('codemode')
            const codeModeNote = isCodeMode ? ' | 100KB Cap | Prefers: mj.* API' : ''
            sysLines.push(
                `${String(opts.toolCount)} tools | Filter: ${escapeCell(opts.filterSummary)}${codeModeNote}`
            )
        } else {
            sysLines.push(`${String(opts.toolCount)} tools`)
        }
    }
    sysLines.push('📊 memory://metrics/summary')
    sysLines.push('📍 memory://agent-context/{repo}')

    const testLines: string[] = []
    if (opts.testHealth) {
        const th = opts.testHealth
        const covStr = th.coverage > 0 ? ` (${String(Math.round(th.coverage))}% cov)` : ''
        testLines.push(`Tests: ${String(th.unitTests)} pass + ${String(th.e2eTests)} E2E${covStr}`)
    }
    if (opts.localCheck !== undefined) {
        testLines.push(`Lint & Typecheck: ${opts.localCheck ? '✅' : '❌'}`)
    }
    if (testLines.length) sysLines.push(testLines.join(' · '))

    const sysLine3 = []
    if (rulesFile)
        sysLine3.push(`📄 ${escapeCell(rulesFile.name)} (${String(rulesFile.sizeKB)} KB)`)
    if (skillsDir)
        sysLine3.push(`🧠 [${String(skillsDir.count)} skill${skillsDir.count !== 1 ? 's' : ''}](file:///${skillsDir.absolutePath.replace(/\\/g, '/')})`)
    if (sysLine3.length) sysLines.push(sysLine3.join(' · '))

    if (opts.hasCodeMap) {
        sysLines.push(
            '📋 code-map (test-server/code-map.md) · 🛠️ tools (test-server/tool-reference.md)'
        )
    }

    if (opts.localTime) sysLines.push(`🕒 ${opts.localTime}`)
    if (opts.workspaceId) sysLines.push(`Tenant: **${escapeCell(opts.workspaceId)}**`)

    // ========================================================================
    // TABLE ROW 5: Config (only when non-default values present)
    // ========================================================================
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
    if (opts.registryRepos && opts.registryRepos.length > 0) {
        const repoNames = opts.registryRepos.slice(0, 3).map((name) => {
            const projNum = opts.registryProjectNumbers?.[name]
            return projNum !== undefined ? `${name} (#${String(projNum)})` : name
        }).join(', ')
        const suffix =
            opts.registryRepos.length > 3 ? ` +${String(opts.registryRepos.length - 3)}` : ''
        configLine3.push(`registry: ${escapeCell(repoNames)}${suffix}`)
    }
    if (configLine3.length) configLines.push(configLine3.join(' · '))

    // ========================================================================
    // TABLE ROW 6: Insights + Analytics
    // ========================================================================
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
            `GH Copilot Reviews: ${String(cr.reviewed)} reviewed · ${String(cr.approved)} approved${cr.changesRequested > 0 ? ` · ${String(cr.changesRequested)} changes requested` : ''}${cr.totalComments > 0 ? ` (${String(cr.totalComments)} comments)` : ''}`
        )
    }

    if (analyticsInsights) {
        insightsLines.push(`📈 ${escapeCell(analyticsInsights.activityTrend)}`)
        const metricParts: string[] = []
        if (analyticsInsights.significanceSpike !== null)
            metricParts.push(`🔥 ${escapeCell(analyticsInsights.significanceSpike)}`)
        if (analyticsInsights.relationshipDensity !== undefined)
            metricParts.push(
                `🔗 Density: ${escapeCell(String(analyticsInsights.relationshipDensity))}`
            )
        if (metricParts.length > 0) insightsLines.push(metricParts.join(' · '))
        if (analyticsInsights.staleProjects.length > 0)
            insightsLines.push(
                `💤 ${String(analyticsInsights.staleProjects.length)} stale projects`
            )
    }

    // ========================================================================
    // TABLE ROW 7: Graph
    // ========================================================================
    const graphLines: string[] = []
    if (graphSummary && graphSummary.totalRelationships > 0) {
        const topTypes =
            Object.entries(graphSummary.causalMetrics)
                .filter(([_, count]) => count > 0)
                .map(([type, count]) => `${type}: ${String(count)}`)
                .join(', ') || 'none'
        
        const orphanAlert = graphSummary.orphanRatio !== undefined && graphSummary.orphanRatio > 0.2 ? '🔴 ' : ''
        let graphText = `${orphanAlert}${String(graphSummary.totalRelationships)} relationships<br>Causal: ${escapeCell(topTypes)} (view: memory://graph/recent)`
        
        if (graphSummary.topHubs.length > 0) {
            const hubsStr = graphSummary.topHubs
                .map(h => `#${String(h.id)}${h.preview ? ` ${h.preview}` : ''}`.trim())
                .join(', ')
            graphText += `<br>Context Hubs: ${escapeCell(hubsStr)}`
        }

        graphLines.push(graphText)
    }

    // ========================================================================
    // TABLE ROW 8: Git History
    // ========================================================================
    const gitHistoryLines: string[] = []
    if (opts.gitHistory) {
        const changelog = opts.gitHistory.changelog as { totalCount?: number; categories?: Record<string, unknown[]> } | undefined;
        if (changelog && typeof changelog.totalCount === 'number' && changelog.totalCount > 0 && changelog.categories) {
            const cl = changelog;
            const catSummary = Object.entries(cl.categories ?? {})
                .map(([cat, entries]) => `${escapeCell(cat)} (${String(entries.length)})`)
                .join(' · ');
            gitHistoryLines.push(`**Unreleased (${String(cl.totalCount)}):** ${catSummary}`);
        } else if (opts.gitHistory.commits.length > 0) {
            // Only show fallback commits if we don't have the rich changelog categories
            const shortCommits = opts.gitHistory.commits.slice(0, 3).map(c => `\`${c.hash}\``).join(', ');
            gitHistoryLines.push(`**Recent Commits:** ${shortCommits}`);
        }
    }

    // ========================================================================
    // TABLE ROW 9: Workspaces
    // ========================================================================
    const workspacesLines: string[] = []
    if (opts.registryPaths) {
        const entries = Object.entries(opts.registryPaths)
        if (entries.length > 0) {
            // Compute common prefix for path compression
            const allPaths = entries.map(([_, p]) => p.replace(/\\/g, '/'))
            let commonPrefix = ''
            if (allPaths.length > 1) {
                // Find longest common prefix across ALL paths
                let prefix = allPaths[0] ?? ''
                for (let p = 1; p < allPaths.length; p++) {
                    const path = allPaths[p] ?? ''
                    let i = 0
                    while (i < prefix.length && i < path.length && prefix[i] === path[i]) i++
                    prefix = prefix.slice(0, i)
                    if (prefix.length === 0) break
                }
                // Snap to last slash boundary
                const lastSlash = prefix.lastIndexOf('/')
                if (lastSlash > 0) {
                    commonPrefix = prefix.slice(0, lastSlash)
                }
            }

            const pathList = entries
                .map(([name, diskPath]) => {
                    const isActive = name === repoName || name === repoName.split('/').pop()
                    const projNum = opts.registryProjectNumbers?.[name]
                    const nameLabel = projNum !== undefined ? `${name} (#${projNum})` : name
                    // Use forward slashes and strip common prefix
                    let displayPath = diskPath.replace(/\\/g, '/')
                    if (commonPrefix && displayPath.startsWith(commonPrefix)) {
                        displayPath = displayPath.slice(commonPrefix.length)
                    }
                    const formatted = `${escapeCell(nameLabel)}: ${escapeCell(displayPath)}`
                    return isActive ? `**${formatted}** (active)` : formatted
                })
                .join('<br>')

            let legend = ''
            if (commonPrefix) {
                legend = `[${escapeCell(commonPrefix)}]<br>`
            }
            workspacesLines.push(`${legend}${pathList}`)
        }
    }

    // ========================================================================
    // Assembly
    // ========================================================================
    let flagsAlert = '💡 **Anti-Hallucination:** If you encounter MCP API confusion or hallucinations, immediately run the `mcp-heal` prompt to fix the codebase.\n\n'
    if (opts.flagSummary && opts.flagSummary.count > 0) {
        flagsAlert += `⚠️ **${String(opts.flagSummary.count)} active flag(s)** — review before proceeding.\n${opts.flagSummary.flags.map((f) => `🚩 ${f.flag_type}${f.target_user ? ` → @${f.target_user}` : ''}: ${f.fullContent.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')}`).join('\n')}\n\n`
    }

    if (graphSummary?.orphanRatio !== undefined && graphSummary.orphanRatio > 0.2) {
        const orphanPct = Math.round(graphSummary.orphanRatio * 100)
        flagsAlert += `⚠️ **Journal Health:** ${orphanPct}% of entries are orphaned (0 relationships). Consider running \`mj-mcp-optimize\`.\n\n`
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
    if (totalEntries > 0) {
        tableRows.push(`| **Journal** | ${journalParts.join('<br>')} |`)
    }
    if (sysLines.length > 0) {
        tableRows.push(`| **System** | ${sysLines.join('<br>')} |`)
    }
    if (configLines.length > 0) {
        tableRows.push(`| **Config** | ${configLines.join('<br>')} |`)
    }
    if (insightsLines.length > 0) {
        tableRows.push(`| **Insights** | ${insightsLines.join('<br>')} |`)
    }
    if (graphLines.length > 0) {
        tableRows.push(`| **Graph** | ${graphLines.join('<br>')} |`)
    }
    if (gitHistoryLines.length > 0) {
        tableRows.push(`| **Git History** | ${gitHistoryLines.join('<br>')} |`)
    }
    if (workspacesLines.length > 0) {
        tableRows.push(`| **Workspaces** | ${workspacesLines.join('<br>')} |`)
    }

    return `${flagsAlert}${tableRows.join('\n')}`
}
