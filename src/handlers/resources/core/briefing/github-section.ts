/**
 * Briefing — GitHub Section Builder
 *
 * Fetches all GitHub data for the briefing resource: CI status,
 * workflow runs, issues, PRs, milestones, repo insights, and copilot reviews.
 */

import type { GitHubIntegration } from '../../../../github/github-integration/index.js'
import type { BriefingConfig } from '../../shared.js'
import { resolveGitHubRepo, isResourceError, milestoneCompletionPct } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'

/**
 * Shape of the assembled GitHub context for the briefing.
 */
export interface BriefingGitHub {
    repo: string | null
    branch: string | null
    ci: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown'
    openIssues: number
    openPRs: number
    milestones: { title: string; progress: string; dueOn: string | null }[]
    insights?: {
        stars: number | null
        forks: number | null
        clones14d?: number
        views14d?: number
    }
    openIssueList?: { number: number; title: string }[]
    openPrList?: { number: number; title: string; state: string }[]
    prStatusSummary?: { open: number; merged: number; closed: number }
    workflowSummary?: {
        passing: number
        failing: number
        pending: number
        cancelled: number
        runs?: { name: string; conclusion: string }[]
    }
    copilotReviews?: {
        reviewed: number
        approved: number
        changesRequested: number
        totalComments: number
    }
    degraded?: boolean
    degradedReasons?: string[]
}

/**
 * Fetch all GitHub context for the briefing.
 * Returns null if GitHub is unavailable or un-configured.
 */
export async function buildGitHubSection(
    github: GitHubIntegration | null | undefined,
    config: BriefingConfig
): Promise<BriefingGitHub | null> {
    if (!github) return null

    try {
        const resolved = await resolveGitHubRepo(github, config)
        if (isResourceError(resolved)) return null
        const { owner, repo } = resolved

        // Parallel fetch — bounded to prevent API exhaustion (Batch 1: core status)
        const batch1 = await Promise.allSettled([
            fetchCiStatus(github, owner, repo, config),
            fetchIssuesAndPrs(github, owner, repo, config),
            fetchMilestones(github, owner, repo, config.milestoneCount ?? 3),
        ]);

        // Batch 2: insights and copilot reviews
        const batch2 = await Promise.allSettled([
            fetchInsights(github, owner, repo),
            config.copilotReviews
                ? fetchCopilotReviews(github, owner, repo)
                : Promise.resolve(undefined),
        ]);

        const [ciStatusResult, issuesAndPrsResult, milestonesResult] = batch1;
        const [insightsResult, copilotReviewsResult] = batch2;

        const degradedReasons: string[] = []

        const ciStatus = ciStatusResult.status === 'fulfilled' ? ciStatusResult.value : { status: 'unknown' as const, workflowSummary: undefined, degraded: true }
        if (ciStatusResult.status === 'rejected') degradedReasons.push(`CI Status fetch failed: ${String(ciStatusResult.reason)}`)
        else if (ciStatus.degraded) degradedReasons.push('CI Status partially degraded')

        const issuesAndPrs = issuesAndPrsResult.status === 'fulfilled' ? issuesAndPrsResult.value : { openIssues: 0, openIssueList: undefined, openPRs: 0, openPrList: undefined, degraded: true }
        if (issuesAndPrsResult.status === 'rejected') degradedReasons.push(`Issues/PRs fetch failed: ${String(issuesAndPrsResult.reason)}`)
        else if (issuesAndPrs.degraded) degradedReasons.push('Issues/PRs partially degraded')

        const milestonesData = milestonesResult.status === 'fulfilled' ? milestonesResult.value : { items: [], degraded: true }
        if (milestonesResult.status === 'rejected') degradedReasons.push(`Milestones fetch failed: ${String(milestonesResult.reason)}`)
        else if (milestonesData.degraded) degradedReasons.push('Milestones partially degraded')

        const insightsData = insightsResult.status === 'fulfilled' ? insightsResult.value : { degraded: true }
        if (insightsResult.status === 'rejected') degradedReasons.push(`Insights fetch failed: ${String(insightsResult.reason)}`)
        else if (insightsData.degraded) degradedReasons.push('Insights partially degraded')

        const copilotReviewsData = copilotReviewsResult.status === 'fulfilled' ? (copilotReviewsResult.value ?? {}) : { degraded: true }
        if (copilotReviewsResult.status === 'rejected') degradedReasons.push(`Copilot Reviews fetch failed: ${String(copilotReviewsResult.reason)}`)
        else if (copilotReviewsData.degraded) degradedReasons.push('Copilot Reviews partially degraded')

        const { openIssues, openIssueList, openPRs, openPrList } = issuesAndPrs
        const workflowSummary = ciStatus.workflowSummary
        const milestones = milestonesData.items ?? []
        const insights = insightsData.insights
        const copilotReviews = copilotReviewsData.reviews
        const degraded = degradedReasons.length > 0

        return {
            repo: `${owner}/${repo}`,
            branch: resolved.branch,
            ci: ciStatus.status,
            openIssues,
            openPRs,
            milestones,
            insights,
            openIssueList,
            openPrList,
            ...(config.prStatusBreakdown && openPrList
                ? {
                      prStatusSummary: {
                          open:
                              openPrList.filter((p) => p.state === 'OPEN').length +
                              (openPRs -
                                  (openPrList?.filter((p) => p.state === 'OPEN').length ?? 0)),
                          merged: openPrList.filter((p) => p.state === 'MERGED').length,
                          closed: openPrList.filter((p) => p.state === 'CLOSED').length,
                      },
                  }
                : {}),
            ...(workflowSummary ? { workflowSummary } : {}),
            ...(copilotReviews ? { copilotReviews } : {}),
            ...(degraded ? { degraded: true, degradedReasons } : {}),
        }
    } catch (error) {
        logger.debug('Failed to build GitHub briefing section', {
            module: 'BRIEFING',
            operation: 'github-section',
            error,
        })
        return null
    }
}

// ============================================================================
// Private Helpers
// ============================================================================

interface CiResult {
    status: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown'
    workflowSummary?: BriefingGitHub['workflowSummary']
    degraded?: boolean
}

async function fetchCiStatus(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    config: BriefingConfig
): Promise<CiResult> {
    try {
        const runLimit = Math.max(1, config.workflowCount, config.workflowStatusBreakdown ? 10 : 1)
        const runs = await github.getWorkflowRuns(owner, repo, runLimit)
        if (runs.length === 0) return { status: 'unknown' }

        const primaryRun =
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
                              name: r.name,
                              conclusion:
                                  r.status !== 'completed'
                                      ? 'pending'
                                      : (r.conclusion ?? 'unknown'),
                          })),
                      }
                    : {}),
            }
        }

        return { status, workflowSummary }
    } catch (error) {
        logger.debug('Failed to fetch CI status', {
            module: 'BRIEFING',
            operation: 'ci-status',
            error: error instanceof Error ? error.message : String(error),
        })
        return { status: 'unknown', degraded: true }
    }
}

async function fetchIssuesAndPrs(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    config: BriefingConfig
): Promise<{
    openIssues: number
    openPRs: number
    openIssueList?: { number: number; title: string }[]
    openPrList?: { number: number; title: string; state: string }[]
    degraded?: boolean
}> {
    try {
        const issueLimit = Math.max(1, config.issueCount || 1)
        const issues = await github.getIssues(owner, repo, 'open', issueLimit)
        const openIssues = issues.length > 0 ? issues.length : 0
        const openIssueList =
            config.issueCount > 0 && issues.length > 0
                ? issues
                      .slice(0, config.issueCount)
                      .map((i) => ({ number: i.number, title: `<untrusted_remote_content>${i.title}</untrusted_remote_content>` }))
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
                      title: `<untrusted_remote_content>${p.title}</untrusted_remote_content>`,
                      state: p.state,
                  }))
                : undefined

        return { openIssues, openPRs, openIssueList, openPrList }
    } catch (error) {
        logger.debug('Failed to fetch issues and PRs', {
            module: 'BRIEFING',
            operation: 'issues-prs',
            error: error instanceof Error ? error.message : String(error),
        })
        return { openIssues: 0, openPRs: 0, degraded: true }
    }
}

async function fetchMilestones(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    limit: number
): Promise<{ items: { title: string; progress: string; dueOn: string | null }[], degraded?: boolean }> {
    if (limit <= 0) return { items: [] }

    try {
        const msList = await github.getMilestones(owner, repo, 'open', limit)
        return {
            items: msList.map((m) => {
                const pct = milestoneCompletionPct(m.openIssues, m.closedIssues)
                return {
                    title: m.title,
                    progress: `${String(pct)}%`,
                    dueOn: m.dueOn,
                }
            })
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

async function fetchInsights(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<{ insights?: BriefingGitHub['insights'], degraded?: boolean }> {
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

async function fetchCopilotReviews(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<{ reviews?: BriefingGitHub['copilotReviews'], degraded?: boolean } | undefined> {
    try {
        const recentPrs = await github.getPullRequests(owner, repo, 'all', 10)
        let reviewed = 0
        let approved = 0
        let changesRequested = 0
        let totalComments = 0

        const summaries = [];
        for (const pr of recentPrs.slice(0, 5)) {
            summaries.push(await github.getCopilotReviewSummary(owner, repo, pr.number));
        }
        for (const summary of summaries) {
            if (summary.state !== 'none') {
                reviewed++
                if (summary.state === 'approved') approved++
                else if (summary.state === 'changes_requested') changesRequested++
                totalComments += summary.commentCount
            }
        }

        return reviewed > 0 ? { reviews: { reviewed, approved, changesRequested, totalComments } } : undefined
    } catch (error) {
        logger.debug('Failed to fetch Copilot reviews', {
            module: 'BRIEFING',
            operation: 'copilot-reviews',
            error,
        })
        return { degraded: true }
    }
}
