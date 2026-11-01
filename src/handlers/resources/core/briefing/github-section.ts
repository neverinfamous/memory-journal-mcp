/**
 * Briefing — GitHub Section Builder
 *
 * Fetches all GitHub data for the briefing resource: CI status,
 * workflow runs, issues, PRs, milestones, repo insights, and copilot reviews.
 */

import type { GitHubIntegration } from '../../../../github/github-integration/index.js'
import type { BriefingConfig } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'
import {
    resolveBriefingRepo,
    fetchCiStatus,
    fetchIssuesAndPrs,
    fetchMilestones,
    fetchInsights,
    fetchCopilotReviews,
} from './github-repo-and-kanban.js'

export {
    resolveBriefingRepo,
    fetchCiStatus,
    fetchIssuesAndPrs,
    fetchMilestones,
    fetchInsights,
    fetchCopilotReviews,
}

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
    insights?:
        | {
              stars: number | null
              forks: number | null
              clones14d?: number | undefined
              views14d?: number | undefined
          }
        | undefined
    openIssueList?: { number: number; title: string }[] | undefined
    openPrList?: { number: number; title: string; state: string }[] | undefined
    prStatusSummary?: { open: number; merged: number; closed: number } | undefined
    workflowSummary?:
        | {
              passing: number
              failing: number
              pending: number
              cancelled: number
              runs?: { name: string; conclusion: string; url?: string | undefined }[] | undefined
          }
        | undefined
    copilotReviews?:
        | {
              reviewed: number
              approved: number
              changesRequested: number
              totalComments: number
          }
        | undefined
    localGitStatus?:
        | {
              modified: number
              untracked: number
              isClean: boolean
              degraded?: boolean | undefined
          }
        | undefined
    ciName?: string | undefined
    ciUpdatedAt?: string | undefined
    activePr?:
        | {
              number: number
              title: string
              url: string
              state: string
              reviewStatus?: string | undefined
              commentCount?: number | undefined
              ciStatus?: string | undefined
          }
        | undefined
    degraded?: boolean | undefined
    degradedReasons?: string[] | undefined
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
        const resolved = await resolveBriefingRepo(github, config)
        if (!resolved) return null
        const { owner, repo } = resolved

        const batch1 = await Promise.allSettled([
            fetchCiStatus(github, owner, repo, config),
            fetchIssuesAndPrs(github, owner, repo, config),
            fetchMilestones(github, owner, repo, config.milestoneCount ?? 3),
        ])

        const batch2 = await Promise.allSettled([
            fetchInsights(github, owner, repo),
            config.copilotReviews
                ? fetchCopilotReviews(github, owner, repo)
                : Promise.resolve(undefined),
            github.getLocalGitStatus(),
        ])

        const [ciStatusResult, issuesAndPrsResult, milestonesResult] = batch1
        const [insightsResult, copilotReviewsResult, localGitStatusResult] = batch2

        const degradedReasons: string[] = []

        const ciStatus =
            ciStatusResult.status === 'fulfilled'
                ? ciStatusResult.value
                : { status: 'unknown' as const, workflowSummary: undefined, degraded: true }
        if (ciStatusResult.status === 'rejected')
            degradedReasons.push(`CI Status fetch failed: ${String(ciStatusResult.reason)}`)
        else if (ciStatus.degraded === true) degradedReasons.push('CI Status partially degraded')

        const issuesAndPrs =
            issuesAndPrsResult.status === 'fulfilled'
                ? issuesAndPrsResult.value
                : {
                      openIssues: 0,
                      openIssueList: undefined,
                      openPRs: 0,
                      openPrList: undefined,
                      allPrs: undefined,
                      degraded: true,
                  }
        if (issuesAndPrsResult.status === 'rejected')
            degradedReasons.push(`Issues/PRs fetch failed: ${String(issuesAndPrsResult.reason)}`)
        else if (issuesAndPrs.degraded === true)
            degradedReasons.push('Issues/PRs partially degraded')

        const milestonesData =
            milestonesResult.status === 'fulfilled'
                ? milestonesResult.value
                : { items: [], degraded: true }
        if (milestonesResult.status === 'rejected')
            degradedReasons.push(`Milestones fetch failed: ${String(milestonesResult.reason)}`)
        else if (milestonesData.degraded === true)
            degradedReasons.push('Milestones partially degraded')

        const insightsData =
            insightsResult.status === 'fulfilled' ? insightsResult.value : { degraded: true }
        if (insightsResult.status === 'rejected')
            degradedReasons.push(`Insights fetch failed: ${String(insightsResult.reason)}`)
        else if (insightsData.degraded === true) degradedReasons.push('Insights partially degraded')

        const copilotReviewsData =
            copilotReviewsResult.status === 'fulfilled'
                ? (copilotReviewsResult.value ?? {})
                : { degraded: true }
        if (copilotReviewsResult.status === 'rejected')
            degradedReasons.push(
                `Copilot Reviews fetch failed: ${String(copilotReviewsResult.reason)}`
            )
        else if (copilotReviewsData.degraded === true)
            degradedReasons.push('Copilot Reviews partially degraded')

        const localGitStatus =
            localGitStatusResult.status === 'fulfilled'
                ? localGitStatusResult.value
                : {
                      modified: 0,
                      untracked: 0,
                      isClean: true,
                      degraded: true,
                      resolvedIssues: undefined,
                  }

        if (localGitStatusResult.status === 'rejected')
            degradedReasons.push(
                `Local Git Status fetch failed: ${String(localGitStatusResult.reason)}`
            )

        let { openIssues, openIssueList } = issuesAndPrs
        const { openPRs, openPrList, allPrs } = issuesAndPrs
        const workflowSummary = ciStatus.workflowSummary
        const ciName = ciStatus.ciName
        const milestones = milestonesData.items ?? []
        const insights = insightsData.insights
        const copilotReviews = copilotReviewsData.reviews

        const resolvedIssues = localGitStatus.resolvedIssues
        if (
            resolvedIssues !== undefined &&
            resolvedIssues.length > 0 &&
            openIssueList !== undefined
        ) {
            const initialListLength = openIssueList.length
            openIssueList = openIssueList.filter((i) => !resolvedIssues.includes(i.number))
            const removedCount = initialListLength - openIssueList.length
            openIssues = Math.max(0, openIssues - removedCount)
        }

        const degraded = degradedReasons.length > 0

        let activePr: BriefingGitHub['activePr'] = undefined
        const localBranch = 'branch' in localGitStatus ? localGitStatus.branch : undefined
        const activePrData =
            localBranch !== undefined && localBranch !== '' && allPrs !== undefined
                ? allPrs.find((p) => p.headRef === localBranch)
                : undefined

        if (activePrData !== undefined) {
            let reviewStatus: string | undefined
            let commentCount = 0
            try {
                const reviewSummary = await github.getCopilotReviewSummary(
                    owner,
                    repo,
                    activePrData.number
                )
                if (reviewSummary.state !== 'none') {
                    reviewStatus = reviewSummary.state
                    commentCount = reviewSummary.commentCount
                }
            } catch {
                // ignore
            }

            let prCiStatus: string | undefined
            try {
                const runs = await github.getWorkflowRuns(owner, repo, 20)
                const prRun = runs.find((r) => r.headBranch === activePrData.headRef)
                if (prRun !== undefined) {
                    if (prRun.status !== 'completed') prCiStatus = 'pending'
                    else if (prRun.conclusion === 'success') prCiStatus = 'passing'
                    else if (prRun.conclusion === 'failure') prCiStatus = 'failing'
                    else if (prRun.conclusion === 'cancelled') prCiStatus = 'cancelled'
                }
            } catch {
                // ignore
            }

            activePr = {
                number: activePrData.number,
                title: activePrData.title,
                url: activePrData.url,
                state: activePrData.state,
                reviewStatus,
                commentCount,
                ciStatus: prCiStatus,
            }
        }

        return {
            repo: `${owner}/${repo}`,
            branch: resolved.branch,
            ci: ciStatus.status,
            ciName,
            ciUpdatedAt: ciStatus.ciUpdatedAt,
            localGitStatus,
            openIssues,
            openPRs,
            milestones,
            insights,
            openIssueList,
            openPrList,
            ...(activePr !== undefined ? { activePr } : {}),
            ...(config.prStatusBreakdown && openPrList !== undefined
                ? {
                      prStatusSummary: {
                          open:
                              openPrList.filter((p) => p.state === 'OPEN').length +
                              (openPRs -
                                  (openPrList.filter((p) => p.state === 'OPEN').length ?? 0)),
                          merged: openPrList.filter((p) => p.state === 'MERGED').length,
                          closed: openPrList.filter((p) => p.state === 'CLOSED').length,
                      },
                  }
                : {}),
            ...(workflowSummary !== undefined ? { workflowSummary } : {}),
            ...(copilotReviews !== undefined ? { copilotReviews } : {}),
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

export const fetchGitHubSection = buildGitHubSection
