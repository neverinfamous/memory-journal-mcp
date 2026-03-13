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
        const resolved = await resolveGitHubRepo(github)
        if (isResourceError(resolved)) return null
        const { owner, repo } = resolved

        // Parallel fetch — all four calls are independent and each has its own error handling
        const [ciStatus, issuesAndPrs, milestones, insights] = await Promise.all([
            fetchCiStatus(github, owner, repo, config),
            fetchIssuesAndPrs(github, owner, repo, config),
            fetchMilestones(github, owner, repo),
            fetchInsights(github, owner, repo),
        ])
        const { openIssues, openIssueList, openPRs, openPrList } = issuesAndPrs
        const workflowSummary = ciStatus.workflowSummary
        const copilotReviews = config.copilotReviews
            ? await fetchCopilotReviews(github, owner, repo)
            : undefined

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
                              (openPRs - (openPrList?.filter((p) => p.state === 'OPEN').length ?? 0)),
                          merged: openPrList.filter((p) => p.state === 'MERGED').length,
                          closed: openPrList.filter((p) => p.state === 'CLOSED').length,
                      },
                  }
                : {}),
            ...(workflowSummary ? { workflowSummary } : {}),
            ...(copilotReviews ? { copilotReviews } : {}),
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

        const latestRun = runs[0]
        let status: CiResult['status'] = 'unknown'
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
                                  r.status !== 'completed' ? 'pending' : (r.conclusion ?? 'unknown'),
                          })),
                      }
                    : {}),
            }
        }

        return { status, workflowSummary }
    } catch (error) {
        logger.debug('Failed to fetch CI status', { module: 'BRIEFING', operation: 'ci-status', error: error instanceof Error ? error.message : String(error) })
        return { status: 'unknown' }
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
}> {
    try {
        const issueLimit = Math.max(1, config.issueCount || 1)
        const issues = await github.getIssues(owner, repo, 'open', issueLimit)
        const openIssues = issues.length > 0 ? issues.length : 0
        const openIssueList =
            config.issueCount > 0 && issues.length > 0
                ? issues.slice(0, config.issueCount).map((i) => ({ number: i.number, title: i.title }))
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
                      title: p.title,
                      state: p.state,
                  }))
                : undefined

        return { openIssues, openPRs, openIssueList, openPrList }
    } catch (error) {
        logger.debug('Failed to fetch issues and PRs', { module: 'BRIEFING', operation: 'issues-prs', error: error instanceof Error ? error.message : String(error) })
        return { openIssues: 0, openPRs: 0 }
    }
}

async function fetchMilestones(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<{ title: string; progress: string; dueOn: string | null }[]> {
    try {
        const msList = await github.getMilestones(owner, repo, 'open', 3)
        return msList.map((m) => {
            const pct = milestoneCompletionPct(m.openIssues, m.closedIssues)
            return {
                title: m.title,
                progress: `${String(pct)}%`,
                dueOn: m.dueOn,
            }
        })
    } catch (error) {
        logger.debug('Failed to fetch milestones', { module: 'BRIEFING', operation: 'milestones', error: error instanceof Error ? error.message : String(error) })
        return []
    }
}

async function fetchInsights(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<BriefingGitHub['insights'] | undefined> {
    try {
        const repoStats = await github.getRepoStats(owner, repo)
        if (!repoStats) return undefined

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
            logger.debug('Traffic data unavailable (requires push access)', { module: 'BRIEFING', operation: 'traffic', error: error instanceof Error ? error.message : String(error) })
        }

        return result
    } catch (error) {
        logger.debug('Failed to fetch repo insights', { module: 'BRIEFING', operation: 'insights', error: error instanceof Error ? error.message : String(error) })
        return undefined
    }
}

async function fetchCopilotReviews(
    github: GitHubIntegration,
    owner: string,
    repo: string
): Promise<BriefingGitHub['copilotReviews'] | undefined> {
    try {
        const recentPrs = await github.getPullRequests(owner, repo, 'all', 10)
        let reviewed = 0
        let approved = 0
        let changesRequested = 0
        let totalComments = 0

        const summaries = await Promise.all(
            recentPrs.slice(0, 5).map((pr) =>
                github.getCopilotReviewSummary(owner, repo, pr.number)
            )
        )
        for (const summary of summaries) {
            if (summary.state !== 'none') {
                reviewed++
                if (summary.state === 'approved') approved++
                else if (summary.state === 'changes_requested') changesRequested++
                totalComments += summary.commentCount
            }
        }

        return reviewed > 0 ? { reviewed, approved, changesRequested, totalComments } : undefined
    } catch (error) {
        logger.debug('Failed to fetch Copilot reviews', {
            module: 'BRIEFING',
            operation: 'copilot-reviews',
            error,
        })
        return undefined
    }
}
