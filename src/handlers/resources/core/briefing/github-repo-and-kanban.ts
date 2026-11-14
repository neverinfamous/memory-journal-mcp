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
    config: BriefingConfig,
    targetRepo?: string
): Promise<{ owner: string; repo: string; branch: string | null; github: GitHubIntegration } | null> {
    const resolved = await resolveGitHubRepo(github, config, targetRepo)
    if (isResourceError(resolved)) return null
    return {
        owner: resolved.owner,
        repo: resolved.repo,
        branch: resolved.branch ?? null,
        github: resolved.github ?? github,
    }
}

interface WorkflowRunLike {
    name: string
    status: string
    conclusion?: string | null | undefined
    url?: string | undefined
}

/** Map a completed run's conclusion onto the CI status vocabulary. */
function classifyRunConclusion(conclusion: string | null | undefined): CiResult['status'] {
    switch (conclusion) {
        case 'success':
            return 'passing'
        case 'failure':
            return 'failing'
        case 'cancelled':
            return 'cancelled'
        default:
            return 'unknown'
    }
}

/** Choose the run that best represents CI (a ci/test run, else the latest decisive run). */
function pickPrimaryRun<T extends WorkflowRunLike>(runs: T[]): T | undefined {
    const named = runs.find((r) => /\b(?:ci|test|tests|gatekeeper)\b/i.test(r.name))
    if (named) return named
    return (
        runs.find(
            (r) =>
                r.status !== 'completed' ||
                ['success', 'failure', 'cancelled'].includes(r.conclusion ?? '')
        ) ?? runs[0]
    )
}

function buildWorkflowSummary(
    runs: WorkflowRunLike[],
    config: BriefingConfig
): BriefingGitHub['workflowSummary'] {
    const counts = { passing: 0, failing: 0, pending: 0, cancelled: 0 }
    for (const run of runs) {
        if (run.status !== 'completed') {
            counts.pending++
            continue
        }
        const classified = classifyRunConclusion(run.conclusion)
        if (classified !== 'unknown') counts[classified]++
    }
    return {
        ...counts,
        ...(config.workflowCount > 0
            ? {
                  runs: runs.slice(0, config.workflowCount).map((r) => ({
                      name: markUntrustedContentInline(r.name),
                      conclusion:
                          r.status !== 'completed' ? 'pending' : (r.conclusion ?? 'unknown'),
                      ...(r.url !== undefined ? { url: r.url } : {}),
                  })),
              }
            : {}),
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

        const latestRun = pickPrimaryRun(runs)
        let status: CiResult['status']
        if (!latestRun) {
            status = 'unknown'
        } else if (latestRun.status !== 'completed') {
            status = 'pending'
        } else {
            status = classifyRunConclusion(latestRun.conclusion)
        }

        const workflowSummary =
            config.workflowStatusBreakdown || config.workflowCount > 0
                ? buildWorkflowSummary(runs, config)
                : undefined

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
        // [INVARIANT] H29: When issueCount/prCount is 0 (summary count only), fetch enough items
        // for accurate totals instead of capping at 1, while slicing lists to 0 below.
        const issueLimit = config.issueCount > 0 ? config.issueCount : 100
        const prState = config.prStatusBreakdown ? ('all' as const) : ('open' as const)
        const prLimit = config.prStatusBreakdown
            ? Math.max(20, config.prCount)
            : config.prCount > 0
              ? config.prCount
              : 100

        const [issues, prs] = await Promise.all([
            github.getIssues(owner, repo, 'open', issueLimit),
            github.getPullRequests(owner, repo, prState, prLimit),
        ])

        const openIssues = issues.length > 0 ? issues.length : 0
        const openIssueList =
            config.issueCount > 0 && issues.length > 0
                ? issues.slice(0, config.issueCount).map((i) => ({
                      number: i.number,
                      title: markUntrustedContentInline(i.title),
                  }))
                : undefined

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
        const [repoStats, trafficResult] = await Promise.all([
            github.getRepoStats(owner, repo),
            github
                .getTrafficData(owner, repo)
                .then((data) => ({ ok: true as const, data }))
                .catch((error: unknown) => ({ ok: false as const, error })),
        ])
        if (!repoStats) return { degraded: true }

        const result: NonNullable<BriefingGitHub['insights']> = {
            stars: repoStats.stars ?? null,
            forks: repoStats.forks ?? null,
        }

        if (!trafficResult.ok) {
            logger.debug('Traffic data unavailable (requires push access)', {
                module: 'BRIEFING',
                operation: 'traffic',
                error:
                    trafficResult.error instanceof Error
                        ? trafficResult.error.message
                        : String(trafficResult.error),
            })
            return { insights: result, degraded: true }
        }

        if (trafficResult.data) {
            result.clones14d = trafficResult.data.clones.total
            result.views14d = trafficResult.data.views.total
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

function aggregateCopilotReviewSummaries(
    summaries: readonly { state: string; commentCount: number }[]
): { reviewed: number; approved: number; changesRequested: number; totalComments: number } {
    let reviewed = 0
    let approved = 0
    let changesRequested = 0
    let totalComments = 0
    for (const summary of summaries) {
        if (summary.state === 'none') continue
        reviewed++
        if (summary.state === 'approved') approved++
        else if (summary.state === 'changes_requested') changesRequested++
        totalComments += summary.commentCount
    }
    return { reviewed, approved, changesRequested, totalComments }
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
        const summaries = await Promise.all(
            recentPrs.slice(0, 5).map((pr) => github.getCopilotReviewSummary(owner, repo, pr.number))
        )
        const aggregated = aggregateCopilotReviewSummaries(summaries)
        return aggregated.reviewed > 0 ? { reviews: aggregated } : undefined
    } catch (error) {
        logger.debug('Failed to fetch Copilot reviews', {
            module: 'BRIEFING',
            operation: 'copilot-reviews',
            error,
        })
        return { degraded: true }
    }
}
