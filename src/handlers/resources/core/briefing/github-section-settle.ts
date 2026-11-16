/**
 * Settled-result unpacking for the briefing GitHub section.
 */

import type { GitHubIntegration } from '../../../../github/github-integration/index.js'
import type { LocalGitStatus } from '../../../../github/github-integration/types.js'
import type { BriefingConfig } from '../../shared.js'
import { markUntrustedContentInline } from '../../../../utils/security-utils.js'
import { logger } from '../../../../utils/logger.js'
import type { CiResult } from './github-repo-and-kanban.js'
import type { BriefingGitHub } from './github-section.js'

interface IssuesAndPrs {
    openIssues: number
    openPRs: number
    openIssueList?: { number: number; title: string }[] | undefined
    openPrList?: { number: number; title: string; state: string }[] | undefined
    allPrs?:
        | { number: number; title: string; url: string; state: string; headRef?: string }[]
        | undefined
    degraded?: boolean | undefined
}

interface MilestonesData {
    items: { title: string; progress: string; dueOn: string | null }[]
    degraded?: boolean | undefined
}

interface InsightsData {
    insights?: BriefingGitHub['insights'] | undefined
    degraded?: boolean | undefined
}

interface CopilotData {
    reviews?: BriefingGitHub['copilotReviews'] | undefined
    degraded?: boolean | undefined
}

export interface GitHubFetchResults {
    ciStatusResult: PromiseSettledResult<CiResult>
    issuesAndPrsResult: PromiseSettledResult<IssuesAndPrs>
    milestonesResult: PromiseSettledResult<MilestonesData>
    insightsResult: PromiseSettledResult<InsightsData>
    copilotReviewsResult: PromiseSettledResult<CopilotData | undefined>
    localGitStatusResult: PromiseSettledResult<LocalGitStatus>
}

export interface UnpackedGitHubFetches {
    ciStatus: CiResult
    issuesAndPrs: IssuesAndPrs
    milestones: BriefingGitHub['milestones']
    insights: BriefingGitHub['insights']
    copilotReviews: BriefingGitHub['copilotReviews']
    localGitStatus: LocalGitStatus & { degraded?: boolean }
    degradedReasons: string[]
}

function takeSettled<T>(
    result: PromiseSettledResult<T>,
    rejectedFallback: T,
    label: string,
    reasons: string[],
    isDegraded: (value: T) => boolean,
): T {
    if (result.status === 'rejected') {
        reasons.push(`${label} fetch failed: ${String(result.reason)}`)
        return rejectedFallback
    }
    if (isDegraded(result.value)) reasons.push(`${label} partially degraded`)
    return result.value
}

export function unpackGitHubFetches(results: GitHubFetchResults): UnpackedGitHubFetches {
    const degradedReasons: string[] = []
    const ciStatus = takeSettled(
        results.ciStatusResult,
        { status: 'unknown', workflowSummary: undefined, degraded: true },
        'CI Status',
        degradedReasons,
        (value) => value.degraded === true,
    )
    const issuesAndPrs = takeSettled(
        results.issuesAndPrsResult,
        {
            openIssues: 0,
            openIssueList: undefined,
            openPRs: 0,
            openPrList: undefined,
            allPrs: undefined,
            degraded: true,
        },
        'Issues/PRs',
        degradedReasons,
        (value) => value.degraded === true,
    )
    const milestonesData = takeSettled(
        results.milestonesResult,
        { items: [], degraded: true },
        'Milestones',
        degradedReasons,
        (value) => value.degraded === true,
    )
    const insightsData = takeSettled(
        results.insightsResult,
        { degraded: true },
        'Insights',
        degradedReasons,
        (value) => value.degraded === true,
    )
    const copilotReviewsData = unpackCopilot(results.copilotReviewsResult, degradedReasons)
    const localGitStatus = unpackLocalGit(results.localGitStatusResult, degradedReasons)
    return {
        ciStatus,
        issuesAndPrs,
        milestones: milestonesData.items ?? [],
        insights: insightsData.insights,
        copilotReviews: copilotReviewsData.reviews,
        localGitStatus,
        degradedReasons,
    }
}

function unpackCopilot(
    result: PromiseSettledResult<CopilotData | undefined>,
    reasons: string[],
): CopilotData {
    if (result.status === 'rejected') {
        reasons.push(`Copilot Reviews fetch failed: ${String(result.reason)}`)
        return { degraded: true }
    }
    const value = result.value ?? {}
    if (value.degraded === true) reasons.push('Copilot Reviews partially degraded')
    return value
}

function unpackLocalGit(
    result: PromiseSettledResult<LocalGitStatus>,
    reasons: string[],
): LocalGitStatus & { degraded?: boolean } {
    if (result.status === 'rejected') {
        reasons.push(`Local Git Status fetch failed: ${String(result.reason)}`)
        return { modified: 0, untracked: 0, isClean: false, degraded: true }
    }
    return result.value
}

export function hideResolvedIssues(
    issuesAndPrs: IssuesAndPrs,
    resolvedIssues: number[] | undefined,
): { openIssues: number; openIssueList: IssuesAndPrs['openIssueList'] } {
    let { openIssues, openIssueList } = issuesAndPrs
    if (resolvedIssues !== undefined && resolvedIssues.length > 0 && openIssueList !== undefined) {
        const initialListLength = openIssueList.length
        openIssueList = openIssueList.filter((issue) => !resolvedIssues.includes(issue.number))
        const removedCount = initialListLength - openIssueList.length
        openIssues = Math.max(0, openIssues - removedCount)
    }
    return { openIssues, openIssueList }
}

export async function loadActivePr(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    allPrs: IssuesAndPrs['allPrs'],
    localBranch: string | null | undefined,
): Promise<BriefingGitHub['activePr']> {
    const activePrData =
        localBranch !== undefined && localBranch !== '' && allPrs !== undefined
            ? allPrs.find((pr) => pr.headRef === localBranch)
            : undefined
    if (activePrData === undefined) return undefined

    const review = await readReviewSummary(github, owner, repo, activePrData.number)
    const ciStatus = await readPullRequestCi(github, owner, repo, activePrData.headRef)
    return {
        number: activePrData.number,
        title: markUntrustedContentInline(activePrData.title),
        url: activePrData.url,
        state: activePrData.state,
        reviewStatus: review.reviewStatus,
        commentCount: review.commentCount,
        ciStatus,
    }
}

async function readReviewSummary(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<{ reviewStatus: string | undefined; commentCount: number }> {
    try {
        const reviewSummary = await github.getCopilotReviewSummary(owner, repo, prNumber)
        if (reviewSummary.state !== 'none') {
            return { reviewStatus: reviewSummary.state, commentCount: reviewSummary.commentCount }
        }
    } catch (err) {
        logger.debug('Copilot review summary unavailable', {
            module: 'Briefing',
            prNumber,
            error: err instanceof Error ? err.message : String(err),
        })
    }
    return { reviewStatus: undefined, commentCount: 0 }
}

async function readPullRequestCi(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    headRef: string | undefined,
): Promise<string | undefined> {
    try {
        const runs = await github.getWorkflowRuns(owner, repo, 20)
        const prRun = runs.find((run) => run.headBranch === headRef)
        if (prRun === undefined) return undefined
        if (prRun.status !== 'completed') return 'pending'
        if (prRun.conclusion === 'success') return 'passing'
        if (prRun.conclusion === 'failure') return 'failing'
        if (prRun.conclusion === 'cancelled') return 'cancelled'
    } catch (err) {
        logger.debug('Pull request CI status unavailable', {
            module: 'Briefing',
            headRef,
            error: err instanceof Error ? err.message : String(err),
        })
    }
    return undefined
}

export function assembleBriefingGitHub(input: {
    owner: string
    repo: string
    branch: string | null
    unpacked: UnpackedGitHubFetches
    openIssues: number
    openIssueList: IssuesAndPrs['openIssueList']
    activePr: BriefingGitHub['activePr']
    config: BriefingConfig
}): BriefingGitHub {
    const { unpacked } = input
    const { openPRs, openPrList, allPrs } = unpacked.issuesAndPrs
    const prSummarySource = allPrs ?? openPrList
    const degraded = unpacked.degradedReasons.length > 0
    return {
        repo: `${input.owner}/${input.repo}`,
        branch: input.branch,
        ci: unpacked.ciStatus.status,
        ciName: unpacked.ciStatus.ciName,
        ciUpdatedAt: unpacked.ciStatus.ciUpdatedAt,
        localGitStatus: unpacked.localGitStatus,
        openIssues: input.openIssues,
        openPRs,
        milestones: unpacked.milestones,
        insights: unpacked.insights,
        openIssueList: input.openIssueList,
        openPrList,
        ...(input.activePr !== undefined ? { activePr: input.activePr } : {}),
        ...(input.config.prStatusBreakdown && prSummarySource !== undefined
            ? { prStatusSummary: summarizePrStates(prSummarySource, openPRs) }
            : {}),
        ...(unpacked.ciStatus.workflowSummary !== undefined
            ? { workflowSummary: unpacked.ciStatus.workflowSummary }
            : {}),
        ...(unpacked.copilotReviews !== undefined ? { copilotReviews: unpacked.copilotReviews } : {}),
        ...(degraded ? { degraded: true, degradedReasons: unpacked.degradedReasons } : {}),
    }
}

function summarizePrStates(
    openPrList: { state: string }[],
    openPRs: number,
): { open: number; merged: number; closed: number } {
    const openListed = openPrList.filter((pr) => pr.state === 'OPEN').length
    return {
        open: openListed + (openPRs - (openListed ?? 0)),
        merged: openPrList.filter((pr) => pr.state === 'MERGED').length,
        closed: openPrList.filter((pr) => pr.state === 'CLOSED').length,
    }
}
