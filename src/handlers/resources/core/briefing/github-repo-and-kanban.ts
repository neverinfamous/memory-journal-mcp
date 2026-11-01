/**
 * Briefing — GitHub Repository, CI, Issues, Milestones, Insights & Copilot Fetchers
 */

import type { GitHubIntegration } from '../../../../github/github-integration/index.js'
import type { BriefingConfig } from '../../shared.js'
import { resolveGitHubRepo, isResourceError, milestoneCompletionPct } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'
import { markUntrustedContentInline } from '../../../../utils/security-utils.js'
import type { BriefingGitHub } from './github-section.js'

export interface CiResult {
    status: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown'
    ciName?: string | undefined
    ciUpdatedAt?: string | undefined
    workflowSummary?: BriefingGitHub['workflowSummary'] | undefined
    degraded?: boolean | undefined
}

export async function resolveBriefingRepo(
    github: GitHubIntegration,
    config: BriefingConfig
): Promise<{ owner: string; repo: string; branch: string | null } | null> {
    const resolved = await resolveGitHubRepo(github, config)
    if (isResourceError(resolved)) return null
    return {
        owner: resolved.owner,
        repo: resolved.repo,
        branch: resolved.branch ?? null,
    }
}

export async function fetchCiStatus(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    config: BriefingConfig
): Promise<CiResult> {
    try {
        const runLimit = Math.max(5, config.workflowCount, config.workflowStatusBreakdown ? 10 : 1)
        const runs = await github.getWorkflowRuns(owner, repo, runLimit)
        if (runs.length === 0) return { status: 'unknown' }

        let primaryRun = runs.find((r) => {
            const name = r.name.toLowerCase()
            return name.includes('ci') || name.includes('test') || name.includes('gatekeeper')
        })

        primaryRun ??=
            runs.find(
                (r) =>
                    r.status !== 'completed' ||
                    ['success', 'failure', 'cancelled'].includes(r.conclusion ?? '')
            ) ?? runs[0]

        const latestRun = primaryRun
        let status: CiResult['status']
        if (!latestRun) {
            status = 'unknown'
        } else if (latestRun.status !== 'completed') {
            status = 'pending'
        } else {
            switch (latestRun.conclusion) {
                case 'success':
                    status = 'passing'
                    break
                case 'failure':
                    status = 'failing'
                    break
                case 'cancelled':
                    status = 'cancelled'
                    break
                default:
                    status = 'unknown'
            }
        }

        let workflowSummary: BriefingGitHub['workflowSummary'] | undefined = undefined
        if (config.workflowStatusBreakdown || config.workflowCount > 0) {
            const counts = { passing: 0, failing: 0, pending: 0, cancelled: 0 }
            for (const run of runs) {
                if (run.status !== 'completed') {
                    counts.pending++
                } else {
                    switch (run.conclusion) {
                        case 'success':
                            counts.passing++
                            break
                        case 'failure':
                            counts.failing++
                            break
                        case 'cancelled':
                            counts.cancelled++
                            break
                        default:
                            break
                    }
                }
            }
            workflowSummary = {
                ...counts,
                ...(config.workflowCount > 0
                    ? {
                          runs: runs.slice(0, config.workflowCount).map((r) => ({
                              name: markUntrustedContentInline(r.name),
                              conclusion:
                                  r.status !== 'completed'
                                      ? 'pending'
                                      : (r.conclusion ?? 'unknown'),
                              ...(r.url !== undefined ? { url: r.url } : {}),
                          })),
                      }
                    : {}),
            }
        }

        return {
            status,
            ciName: latestRun?.name ? markUntrustedContentInline(latestRun.name) : undefined,
            ciUpdatedAt: latestRun?.updatedAt,
            workflowSummary,
        }
    } catch (error) {
        logger.debug('Failed to fetch CI status', {
            module: 'BRIEFING',
            operation: 'ci-status',
            error: error instanceof Error ? error.message : String(error),
        })
        return { status: 'unknown', degraded: true }
    }
}

export async function fetchIssuesAndPrs(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    config: BriefingConfig
): Promise<{
    openIssues: number
    openPRs: number
    openIssueList?: { number: number; title: string }[] | undefined
    openPrList?: { number: number; title: string; state: string }[] | undefined
    allPrs?:
        | { number: number; title: string; url: string; state: string; headRef?: string }[]
        | undefined
    degraded?: boolean | undefined
}> {
    try {
        const issueLimit = Math.max(1, config.issueCount || 1)
        const issues = await github.getIssues(owner, repo, 'open', issueLimit)
        const openIssues = issues.length > 0 ? issues.length : 0
        const openIssueList =
            config.issueCount > 0 && issues.length > 0
                ? issues.slice(0, config.issueCount).map((i) => ({
                      number: i.number,
                      title: markUntrustedContentInline(i.title),
                  }))
                : undefined

        const prState = config.prStatusBreakdown ? ('all' as const) : ('open' as const)
        const prLimit = config.prStatusBreakdown
            ? Math.max(20, config.prCount)
            : Math.max(1, config.prCount || 1)
        const prs = await github.getPullRequests(owner, repo, prState, prLimit)

        const openPRs = config.prStatusBreakdown
            ? prs.filter((p) => p.state === 'OPEN').length
            : prs.length > 0
              ? prs.length
              : 0

        const openPrList =
            config.prCount > 0 && prs.length > 0
                ? prs.slice(0, config.prCount).map((p) => ({
                      number: p.number,
                      title: markUntrustedContentInline(p.title),
                      state: p.state,
                  }))
                : undefined

        return { openIssues, openPRs, openIssueList, openPrList, allPrs: prs }
    } catch (error) {
        logger.debug('Failed to fetch issues and PRs', {
            module: 'BRIEFING',
            operation: 'issues-prs',
            error: error instanceof Error ? error.message : String(error),
        })
        return { openIssues: 0, openPRs: 0, degraded: true }
    }
}

export async function fetchMilestones(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    limit: number
): Promise<{
    items: { title: string; progress: string; dueOn: string | null }[]
    degraded?: boolean | undefined
}> {
    if (limit <= 0) return { items: [] }

    try {
        const msList = await github.getMilestones(owner, repo, 'open', limit * 3)
        const now = Date.now()
        const twentyFourHours = 24 * 60 * 60 * 1000

        const activeMilestones = msList
            .filter((m) => {
                const pct = milestoneCompletionPct(m.openIssues, m.closedIssues)
                if (pct === 100 && m.updatedAt !== undefined && m.updatedAt !== null) {
                    const updatedTime = new Date(m.updatedAt).getTime()
                    if (now - updatedTime > twentyFourHours) {
                        return false
                    }
                }
                return true
            })
            .slice(0, limit)

        return {
            items: activeMilestones.map((m) => {
                const pct = milestoneCompletionPct(m.openIssues, m.closedIssues)
                return {
                    title: markUntrustedContentInline(m.title),
                    progress: `${String(pct)}%`,
                    dueOn: m.dueOn,
                }
            }),
        }
    } catch (error) {
        logger.debug('Failed to fetch milestones', {
            module: 'BRIEFING',
            operation: 'milestones',
            error: error instanceof Error ? error.message : String(error),
        })
        return { items: [], degraded: true }
    }
}

export async function fetchInsights(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<{
    insights?: BriefingGitHub['insights'] | undefined
    degraded?: boolean | undefined
}> {
    try {
        const repoStats = await github.getRepoStats(owner, repo)
        if (!repoStats) return { degraded: true }

        const result: NonNullable<BriefingGitHub['insights']> = {
            stars: repoStats.stars ?? null,
            forks: repoStats.forks ?? null,
        }

        try {
            const trafficData = await github.getTrafficData(owner, repo)
            if (trafficData) {
                result.clones14d = trafficData.clones.total
                result.views14d = trafficData.views.total
            }
        } catch (error) {
            logger.debug('Traffic data unavailable (requires push access)', {
                module: 'BRIEFING',
                operation: 'traffic',
                error: error instanceof Error ? error.message : String(error),
            })
            return { insights: result, degraded: true }
        }

        return { insights: result }
    } catch (error) {
        logger.debug('Failed to fetch repo insights', {
            module: 'BRIEFING',
            operation: 'insights',
            error: error instanceof Error ? error.message : String(error),
        })
        return { degraded: true }
    }
}

export async function fetchCopilotReviews(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<
    { reviews?: BriefingGitHub['copilotReviews'] | undefined; degraded?: boolean | undefined } | undefined
> {
    try {
        const recentPrs = await github.getPullRequests(owner, repo, 'all', 10)
        let reviewed = 0
        let approved = 0
        let changesRequested = 0
        let totalComments = 0

        const summaries = []
        for (const pr of recentPrs.slice(0, 5)) {
            summaries.push(await github.getCopilotReviewSummary(owner, repo, pr.number))
        }
        for (const summary of summaries) {
            if (summary.state !== 'none') {
                reviewed++
                if (summary.state === 'approved') approved++
                else if (summary.state === 'changes_requested') changesRequested++
                totalComments += summary.commentCount
            }
        }

        return reviewed > 0
            ? { reviews: { reviewed, approved, changesRequested, totalComments } }
            : undefined
    } catch (error) {
        logger.debug('Failed to fetch Copilot reviews', {
            module: 'BRIEFING',
            operation: 'copilot-reviews',
            error,
        })
        return { degraded: true }
    }
}
