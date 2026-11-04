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
import {
    assembleBriefingGitHub,
    hideResolvedIssues,
    loadActivePr,
    unpackGitHubFetches,
} from './github-section-settle.js'

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
    config: BriefingConfig,
): Promise<BriefingGitHub | null> {
    if (!github) return null

    try {
        const resolved = await resolveBriefingRepo(github, config)
        if (!resolved) return null
        const { owner, repo } = resolved
        const [
            ciStatusResult,
            issuesAndPrsResult,
            milestonesResult,
            insightsResult,
            copilotReviewsResult,
            localGitStatusResult,
        ] = await Promise.allSettled([
            fetchCiStatus(github, owner, repo, config),
            fetchIssuesAndPrs(github, owner, repo, config),
            fetchMilestones(github, owner, repo, config.milestoneCount ?? 3),
            fetchInsights(github, owner, repo),
            config.copilotReviews ? fetchCopilotReviews(github, owner, repo) : Promise.resolve(undefined),
            github.getLocalGitStatus(),
        ])
        const unpacked = unpackGitHubFetches({
            ciStatusResult,
            issuesAndPrsResult,
            milestonesResult,
            insightsResult,
            copilotReviewsResult,
            localGitStatusResult,
        })
        const issues = hideResolvedIssues(unpacked.issuesAndPrs, unpacked.localGitStatus.resolvedIssues)
        const localBranch =
            'branch' in unpacked.localGitStatus ? unpacked.localGitStatus.branch : undefined
        const activePr = await loadActivePr(
            github,
            owner,
            repo,
            unpacked.issuesAndPrs.allPrs,
            localBranch,
        )
        return assembleBriefingGitHub({
            owner,
            repo,
            branch: resolved.branch,
            unpacked,
            openIssues: issues.openIssues,
            openIssueList: issues.openIssueList,
            activePr,
            config,
        })
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
