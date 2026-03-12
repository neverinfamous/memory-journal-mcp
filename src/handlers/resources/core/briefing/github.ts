import type { ResourceContext } from '../../shared.js'
import type { GitHubBriefingContext } from './types.js'

export async function getGitHubContext(
    context: ResourceContext,
    config: NonNullable<ResourceContext['briefingConfig']>
): Promise<GitHubBriefingContext | null> {
    if (!context.github) return null

    try {
        const repoInfo = await context.github.getRepoInfo()
        const owner = repoInfo.owner
        const repo = repoInfo.repo

        if (!owner || !repo) return null

        // Get CI status
        let ciStatus: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown' = 'unknown'
        let workflowSummary: GitHubBriefingContext['workflowSummary'] = undefined
        try {
            const runLimit = Math.max(1, config.workflowCount, config.workflowStatusBreakdown ? 10 : 1)
            const runs = await context.github.getWorkflowRuns(owner, repo, runLimit)
            
            if (runs.length > 0) {
                const latestRun = runs[0]
                if (!latestRun) {
                    ciStatus = 'unknown'
                } else if (latestRun.status !== 'completed') {
                    ciStatus = 'pending'
                } else {
                    switch (latestRun.conclusion) {
                        case 'success': ciStatus = 'passing'; break
                        case 'failure': ciStatus = 'failing'; break
                        case 'cancelled': ciStatus = 'cancelled'; break
                        default: ciStatus = 'unknown'
                    }
                }

                if (config.workflowStatusBreakdown || config.workflowCount > 0) {
                    const counts = { passing: 0, failing: 0, pending: 0, cancelled: 0 }
                    for (const run of runs) {
                        if (run.status !== 'completed') {
                            counts.pending++
                        } else {
                            switch (run.conclusion) {
                                case 'success': counts.passing++; break
                                case 'failure': counts.failing++; break
                                case 'cancelled': counts.cancelled++; break
                            }
                        }
                    }
                    workflowSummary = {
                        ...counts,
                        ...(config.workflowCount > 0
                            ? {
                                  runs: runs.slice(0, config.workflowCount).map((r) => ({
                                      name: r.name,
                                      conclusion: r.status !== 'completed' ? 'pending' : (r.conclusion ?? 'unknown'),
                                  })),
                              }
                            : {}),
                    }
                }
            }
        } catch {
            // CI status unavailable
        }

        // Get issue/PR counts
        let openIssues = 0
        let openPRs = 0
        let openIssueList: GitHubBriefingContext['openIssueList'] = undefined
        let openPrList: GitHubBriefingContext['openPrList'] = undefined
        try {
            const issueLimit = Math.max(1, config.issueCount || 1)
            const issues = await context.github.getIssues(owner, repo, 'open', issueLimit)
            openIssues = issues.length > 0 ? issues.length : 0

            if (config.issueCount > 0 && issues.length > 0) {
                openIssueList = issues
                    .slice(0, config.issueCount)
                    .map((i) => ({ number: i.number, title: i.title }))
            }

            const prState = config.prStatusBreakdown ? 'all' as const : 'open' as const
            const prLimit = config.prStatusBreakdown
                ? Math.max(20, config.prCount)
                : Math.max(1, config.prCount || 1)
            const prs = await context.github.getPullRequests(owner, repo, prState, prLimit)

            if (config.prStatusBreakdown) {
                openPRs = prs.filter((p) => p.state === 'OPEN').length
            } else {
                openPRs = prs.length > 0 ? prs.length : 0
            }

            if (config.prCount > 0 && prs.length > 0) {
                openPrList = prs
                    .slice(0, config.prCount)
                    .map((p) => ({
                        number: p.number,
                        title: p.title,
                        state: p.state,
                    }))
            }
        } catch {
            // Counts unavailable
        }

        // Get milestone summary
        let milestones: GitHubBriefingContext['milestones'] = []
        try {
            const msList = await context.github.getMilestones(owner, repo, 'open', 3)
            milestones = msList.map((m) => {
                const total = m.closedIssues + m.openIssues
                const pct = total > 0 ? Math.round((m.closedIssues / total) * 100) : 0
                return {
                    title: m.title,
                    progress: `${String(pct)}%`,
                    dueOn: m.dueOn,
                }
            })
        } catch {
            // Milestones unavailable
        }

        // Get repo insights
        let insights: GitHubBriefingContext['insights'] = undefined
        try {
            const repoStats = await context.github.getRepoStats(owner, repo)
            if (repoStats) {
                insights = {
                    stars: repoStats.stars ?? null,
                    forks: repoStats.forks ?? null,
                }
                try {
                    const trafficData = await context.github.getTrafficData(owner, repo)
                    if (trafficData) {
                        insights.clones14d = trafficData.clones.total
                        insights.views14d = trafficData.views.total
                    }
                } catch {
                    // Traffic data unavailable
                }
            }
        } catch {
            // Repo stats unavailable
        }

        const prStatusSummaryOptions = config.prStatusBreakdown && openPrList
            ? {
                  prStatusSummary: {
                      open: openPrList.filter((p) => p.state === 'OPEN').length +
                          (openPRs - (openPrList.filter((p) => p.state === 'OPEN').length)),
                      merged: openPrList.filter((p) => p.state === 'MERGED').length,
                      closed: openPrList.filter((p) => p.state === 'CLOSED').length,
                  },
              }
            : {}

        const copilotReviewsOptions = await (async () => {
            if (!config.copilotReviews || !context.github) return {}
            try {
                const recentPrs = await context.github.getPullRequests(owner, repo, 'all', 10)
                let reviewed = 0
                let approved = 0
                let changesRequested = 0
                let totalComments = 0
                for (const pr of recentPrs.slice(0, 5)) {
                    const summary = await context.github.getCopilotReviewSummary(owner, repo, pr.number)
                    if (summary.state !== 'none') {
                        reviewed++
                        if (summary.state === 'approved') approved++
                        else if (summary.state === 'changes_requested') changesRequested++
                        totalComments += summary.commentCount
                    }
                }
                if (reviewed > 0) {
                    return {
                        copilotReviews: { reviewed, approved, changesRequested, totalComments },
                    }
                }
                return {}
            } catch {
                return {}
            }
        })()

        return {
            repo: `${owner}/${repo}`,
            branch: repoInfo.branch ?? null,
            ci: ciStatus,
            openIssues,
            openPRs,
            milestones,
            insights,
            openIssueList,
            openPrList,
            ...prStatusSummaryOptions,
            ...(workflowSummary ? { workflowSummary } : {}),
            ...copilotReviewsOptions,
        }
    } catch {
        return null
    }
}
