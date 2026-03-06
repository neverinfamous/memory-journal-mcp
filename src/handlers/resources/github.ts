/**
 * Memory Journal MCP Server - GitHub Resource Definitions
 *
 * Resources: github/status, github/insights, github/milestones, milestones/{number}
 */

import { ICON_GITHUB, ICON_ANALYTICS, ICON_MILESTONE } from '../../constants/icons.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'

/**
 * Get GitHub resource definitions
 */
export function getGitHubResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://github/status',
            name: 'GitHub Status',
            title: 'GitHub Repository Status',
            description:
                'Compact GitHub status: repository, branch, CI, issues, PRs, Kanban summary',
            mimeType: 'application/json',
            icons: [ICON_GITHUB],
            annotations: {
                audience: ['assistant'],
                priority: 0.7,
            },
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const lastModified = new Date().toISOString()

                if (!context.github) {
                    return {
                        data: {
                            error: 'GitHub integration not available',
                            hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                        },
                        annotations: { lastModified },
                    }
                }

                const repoInfo = await context.github.getRepoInfo()
                const owner = repoInfo.owner
                const repo = repoInfo.repo

                if (!owner || !repo) {
                    return {
                        data: {
                            error: 'Could not detect repository',
                            hint: 'Set GITHUB_REPO_PATH to your git repository.',
                            branch: repoInfo.branch,
                        },
                        annotations: { lastModified },
                    }
                }

                // Get current commit
                let commit: string | null = null
                try {
                    const repoContext = await context.github.getRepoContext()
                    commit = repoContext.commit
                } catch {
                    // Ignore
                }

                // Get open issues (limited for token efficiency)
                const issues = await context.github.getIssues(owner, repo, 'open', 5)
                const openIssues = issues.map((i) => ({
                    number: i.number,
                    title: i.title.slice(0, 50),
                }))

                // Get open PRs (limited for token efficiency)
                const prs = await context.github.getPullRequests(owner, repo, 'open', 5)
                const openPrs = prs.map((pr) => ({
                    number: pr.number,
                    title: pr.title.slice(0, 50),
                    state: pr.state,
                }))

                // Get CI status from latest workflow run
                const workflowRuns = await context.github.getWorkflowRuns(owner, repo, 5)
                let ciStatus: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown' =
                    'unknown'
                let latestRun: { name: string; conclusion: string | null; headSha: string } | null =
                    null

                if (workflowRuns.length > 0) {
                    const latestCompleted = workflowRuns.find((r) => r.status === 'completed')
                    const latest = workflowRuns[0]

                    latestRun = {
                        name: latest?.name ?? 'Unknown',
                        conclusion: latest?.conclusion ?? null,
                        headSha: latest?.headSha?.slice(0, 7) ?? '',
                    }

                    if (latestCompleted) {
                        switch (latestCompleted.conclusion) {
                            case 'success':
                                ciStatus = 'passing'
                                break
                            case 'failure':
                                ciStatus = 'failing'
                                break
                            case 'cancelled':
                                ciStatus = 'cancelled'
                                break
                            default:
                                ciStatus = 'unknown'
                        }
                    } else if (workflowRuns.some((r) => r.status !== 'completed')) {
                        ciStatus = 'pending'
                    }
                }

                // Get Kanban summary if project 1 exists
                let kanbanSummary: Record<string, number> | null = null
                try {
                    const kanban = await context.github.getProjectKanban(owner, 1, repo)
                    if (kanban) {
                        kanbanSummary = {}
                        for (const col of kanban.columns) {
                            kanbanSummary[col.status] = col.items.length
                        }
                    }
                } catch {
                    // Kanban not available
                }

                // Get milestone summary
                let milestoneSummary:
                    | {
                          number: number
                          title: string
                          state: string
                          openIssues: number
                          closedIssues: number
                          completionPercentage: number
                          dueOn: string | null
                      }[]
                    | null = null
                try {
                    const milestones = await context.github.getMilestones(owner, repo, 'open', 5)
                    if (milestones.length > 0) {
                        milestoneSummary = milestones.map((ms) => {
                            const total = ms.openIssues + ms.closedIssues
                            const pct = total > 0 ? Math.round((ms.closedIssues / total) * 100) : 0
                            return {
                                number: ms.number,
                                title: ms.title,
                                state: ms.state,
                                openIssues: ms.openIssues,
                                closedIssues: ms.closedIssues,
                                completionPercentage: pct,
                                dueOn: ms.dueOn,
                            }
                        })
                    }
                } catch {
                    // Milestones not available
                }

                return {
                    data: {
                        repository: `${owner}/${repo}`,
                        branch: repoInfo.branch,
                        commit: commit?.slice(0, 7) ?? null,
                        ci: {
                            status: ciStatus,
                            latestRun,
                        },
                        issues: {
                            openCount: issues.length,
                            items: openIssues,
                        },
                        pullRequests: {
                            openCount: prs.length,
                            items: openPrs,
                        },
                        kanbanSummary,
                        milestones: milestoneSummary,
                    },
                    annotations: { lastModified },
                }
            },
        },
        // Repository insights resource
        {
            uri: 'memory://github/insights',
            name: 'Repository Insights',
            title: 'Repository Stars & Traffic Summary',
            description: 'Compact repo insights: stars, forks, 14-day traffic totals (~150 tokens)',
            mimeType: 'application/json',
            icons: [ICON_ANALYTICS],
            annotations: {
                audience: ['assistant'],
                priority: 0.4,
            },
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const lastModified = new Date().toISOString()

                if (!context.github) {
                    return {
                        data: {
                            error: 'GitHub integration not available',
                            hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                        },
                        annotations: { lastModified },
                    }
                }

                const repoInfo = await context.github.getRepoInfo()
                const owner = repoInfo.owner
                const repo = repoInfo.repo

                if (!owner || !repo) {
                    return {
                        data: {
                            error: 'Could not detect repository',
                            hint: 'Set GITHUB_REPO_PATH to your git repository.',
                        },
                        annotations: { lastModified },
                    }
                }

                const stats = await context.github.getRepoStats(owner, repo)

                let traffic: { clones14d: number; views14d: number } | null = null
                try {
                    const trafficData = await context.github.getTrafficData(owner, repo)
                    if (trafficData) {
                        traffic = {
                            clones14d: trafficData.clones.total,
                            views14d: trafficData.views.total,
                        }
                    }
                } catch {
                    // Traffic data requires push access
                }

                return {
                    data: {
                        repository: `${owner}/${repo}`,
                        stars: stats?.stars ?? null,
                        forks: stats?.forks ?? null,
                        watchers: stats?.watchers ?? null,
                        ...(traffic ?? {}),
                        hint: !traffic
                            ? 'Traffic data requires push access to the repository.'
                            : undefined,
                    },
                    annotations: { lastModified },
                }
            },
        },
        // Milestone resources
        {
            uri: 'memory://github/milestones',
            name: 'GitHub Milestones',
            title: 'GitHub Repository Milestones',
            description:
                'Open GitHub milestones with completion percentages, due dates, and issue counts',
            mimeType: 'application/json',
            icons: [ICON_MILESTONE],
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: async (_uri: string, context: ResourceContext) => {
                if (!context.github) {
                    return {
                        error: 'GitHub integration not available',
                        hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                    }
                }

                const repoInfo = await context.github.getRepoInfo()
                const owner = repoInfo.owner
                const repo = repoInfo.repo

                if (!owner || !repo) {
                    return {
                        error: 'Could not detect repository',
                        hint: 'Set GITHUB_REPO_PATH to your git repository.',
                    }
                }

                const milestones = await context.github.getMilestones(owner, repo, 'open', 20)
                const milestonesWithProgress = milestones.map((ms) => {
                    const total = ms.openIssues + ms.closedIssues
                    const completionPercentage =
                        total > 0 ? Math.round((ms.closedIssues / total) * 100) : 0
                    return { ...ms, completionPercentage }
                })

                return {
                    repository: `${owner}/${repo}`,
                    milestones: milestonesWithProgress,
                    count: milestonesWithProgress.length,
                    hint: 'Use get_github_milestones tool for state filtering. Use memory://milestones/{number} for detail.',
                }
            },
        },
        {
            uri: 'memory://milestones/{number}',
            name: 'Milestone Detail',
            title: 'GitHub Milestone Detail',
            description:
                'Detailed view of a single GitHub milestone with completion progress and issue counts. Use get_github_issues with the milestone filter for individual issue details.',
            mimeType: 'application/json',
            icons: [ICON_MILESTONE],
            annotations: {
                audience: ['assistant'],
                priority: 0.5,
            },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/milestones\/(\d+)/.exec(uri)
                const milestoneNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (milestoneNumber === null) {
                    return { error: 'Invalid milestone number' }
                }

                if (!context.github) {
                    return {
                        error: 'GitHub integration not available',
                        hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                    }
                }

                const repoInfo = await context.github.getRepoInfo()
                const owner = repoInfo.owner
                const repo = repoInfo.repo

                if (!owner || !repo) {
                    return {
                        error: 'Could not detect repository',
                        hint: 'Set GITHUB_REPO_PATH to your git repository.',
                    }
                }

                const milestone = await context.github.getMilestone(owner, repo, milestoneNumber)
                if (!milestone) {
                    return { error: `Milestone #${String(milestoneNumber)} not found` }
                }

                const total = milestone.openIssues + milestone.closedIssues
                const completionPercentage =
                    total > 0 ? Math.round((milestone.closedIssues / total) * 100) : 0

                return {
                    repository: `${owner}/${repo}`,
                    milestone: { ...milestone, completionPercentage },
                    hint: 'Use get_github_issues tool to list issues associated with this milestone.',
                }
            },
        },
    ]
}
