/**
 * Memory Journal MCP Server - GitHub Resource Definitions
 *
 * Resources: github/status, github/insights, github/milestones, milestones/{number}
 */

import { ICON_GITHUB, ICON_ANALYTICS, ICON_MILESTONE } from '../../constants/icons.js'
import {
    withPriority,
    ASSISTANT_FOCUSED,
    LOW_PRIORITY,
    MEDIUM_PRIORITY,
} from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import { resolveGitHubRepo, isResourceError, milestoneCompletionPct } from './shared.js'
import { logger } from '../../utils/logger.js'

// ============================================================================
// Resource API Limits
// ============================================================================

/** Max open issues to fetch for resource views (token efficiency) */
const RESOURCE_ISSUE_LIMIT = 5
/** Max open PRs to fetch for resource views (token efficiency) */
const RESOURCE_PR_LIMIT = 5
/** Max workflow runs to fetch for CI status */
const RESOURCE_WORKFLOW_LIMIT = 5
/** Max open milestones to fetch for status summary */
const RESOURCE_STATUS_MILESTONE_LIMIT = 5
/** Max open milestones to fetch for the milestones resource */
const RESOURCE_MILESTONE_LIMIT = 20

/**
 * Get GitHub resource definitions
 */
export function getGitHubResourceDefinitions(): InternalResourceDef[] {
    const definitions: InternalResourceDef[] = [
        {
            uri: 'memory://github/status',
            name: 'GitHub Status',
            title: 'GitHub Repository Status',
            description:
                'Compact GitHub status: repository, branch, CI, issues, PRs, Kanban summary',
            mimeType: 'application/json',
            icons: [ICON_GITHUB],
            annotations: withPriority(0.7, ASSISTANT_FOCUSED),
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const match = /memory:\/\/github\/status\/?(.*)?/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const resolved = await resolveGitHubRepo(context.github, context.briefingConfig, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, branch, lastModified, github } = resolved

                // Resolve default project number — skip kanban fetch when not configured
                const defaultProjectNumber = context.briefingConfig?.defaultProjectNumber

                // Parallelize independent API calls for performance
                const [
                    commitResult,
                    issuesResult,
                    prsResult,
                    workflowsResult,
                    kanbanResult,
                    milestoneResult,
                ] = await Promise.allSettled([
                    github.getRepoContext(),
                    github.getIssues(owner, repo, 'open', RESOURCE_ISSUE_LIMIT),
                    github.getPullRequests(owner, repo, 'open', RESOURCE_PR_LIMIT),
                    github.getWorkflowRuns(owner, repo, RESOURCE_WORKFLOW_LIMIT),
                    defaultProjectNumber !== undefined
                        ? github.getProjectKanban(owner, defaultProjectNumber, repo)
                        : Promise.resolve(null),
                    github.getMilestones(owner, repo, 'open', RESOURCE_STATUS_MILESTONE_LIMIT),
                ])

                // Extract results with safe defaults
                const commit =
                    commitResult.status === 'fulfilled' ? commitResult.value.commit : null
                if (commitResult.status === 'rejected') {
                    logger.debug('Failed to fetch commit context', {
                        module: 'RESOURCE',
                        operation: 'github-status',
                        error: commitResult.reason,
                    })
                }

                const issues = issuesResult.status === 'fulfilled' ? issuesResult.value : []
                const openIssues = issues.map((i) => ({
                    number: i.number,
                    title: i.title.slice(0, 50),
                }))

                const prs = prsResult.status === 'fulfilled' ? prsResult.value : []
                const openPrs = prs.map((pr) => ({
                    number: pr.number,
                    title: pr.title.slice(0, 50),
                    state: pr.state,
                }))

                // CI status from workflow runs
                const workflowRuns =
                    workflowsResult.status === 'fulfilled' ? workflowsResult.value : []
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

                // Kanban summary
                let kanbanSummary: Record<string, number> | null = null
                if (kanbanResult.status === 'fulfilled' && kanbanResult.value) {
                    kanbanSummary = {}
                    for (const col of kanbanResult.value.columns) {
                        kanbanSummary[col.status] = col.items.length
                    }
                } else if (kanbanResult.status === 'rejected') {
                    logger.debug('Failed to fetch Kanban board', {
                        module: 'RESOURCE',
                        operation: 'github-status',
                        error: kanbanResult.reason,
                    })
                }

                // Milestone summary
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
                if (milestoneResult.status === 'fulfilled' && milestoneResult.value.length > 0) {
                    milestoneSummary = milestoneResult.value.map((ms) => {
                        const pct = milestoneCompletionPct(ms.openIssues, ms.closedIssues)
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
                } else if (milestoneResult.status === 'rejected') {
                    logger.debug('Failed to fetch milestones', {
                        module: 'RESOURCE',
                        operation: 'github-status',
                        error: milestoneResult.reason,
                    })
                }

                return {
                    data: {
                        repository: `${owner}/${repo}`,
                        branch,
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
            annotations: { ...LOW_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const match = /memory:\/\/github\/insights\/?(.*)?/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const resolved = await resolveGitHubRepo(context.github, context.briefingConfig, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, lastModified, github } = resolved

                const stats = await github.getRepoStats(owner, repo)

                let traffic: { clones14d: number; views14d: number } | null = null
                try {
                    const trafficData = await github.getTrafficData(owner, repo)
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
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const match = /memory:\/\/github\/milestones\/?(.*)?/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const resolved = await resolveGitHubRepo(context.github, context.briefingConfig, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, lastModified, github } = resolved

                const milestones = await github.getMilestones(
                    owner,
                    repo,
                    'open',
                    RESOURCE_MILESTONE_LIMIT
                )
                const milestonesWithProgress = milestones.map((ms) => {
                    const completionPercentage = milestoneCompletionPct(
                        ms.openIssues,
                        ms.closedIssues
                    )
                    return { ...ms, completionPercentage }
                })

                return {
                    data: {
                        repository: `${owner}/${repo}`,
                        milestones: milestonesWithProgress,
                        count: milestonesWithProgress.length,
                        hint: 'Use get_github_milestones tool for state filtering. Use memory://milestones/{number} for detail.',
                    },
                    annotations: { lastModified },
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
            annotations: ASSISTANT_FOCUSED,
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const lastModified = new Date().toISOString()
                const match = /memory:\/\/milestones\/(?:(.*)\/)?(\d+)$/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const milestoneNumber = match?.[2] ? parseInt(match[2], 10) : null

                if (milestoneNumber === null) {
                    return {
                        data: { error: 'Invalid milestone number' },
                        annotations: { lastModified },
                    }
                }

                const resolved = await resolveGitHubRepo(context.github, context.briefingConfig, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, github } = resolved

                const milestone = await github.getMilestone(owner, repo, milestoneNumber)
                if (!milestone) {
                    return {
                        data: { error: `Milestone #${String(milestoneNumber)} not found` },
                        annotations: { lastModified },
                    }
                }

                const completionPercentage = milestoneCompletionPct(
                    milestone.openIssues,
                    milestone.closedIssues
                )

                return {
                    data: {
                        repository: `${owner}/${repo}`,
                        milestone: { ...milestone, completionPercentage },
                        hint: 'Use get_github_issues tool to list issues associated with this milestone.',
                    },
                    annotations: { lastModified },
                }
            },
        },
    ]

    // Generate dynamic `{repo}` variants for multi-project registry support
    const dynamicDefinitions: InternalResourceDef[] = definitions.map((def) => {
        const dynamicName = def.name + ' (Dynamic)'
        let dynamicUri: string
        if (def.uri === 'memory://milestones/{number}') {
            dynamicUri = 'memory://milestones/{+repo}/{number}'
        } else {
            dynamicUri = def.uri + '/{+repo}'
        }
        return {
            ...def,
            uri: dynamicUri,
            name: dynamicName,
            description: def.description + ' (Supports explicit multi-project repository targeting via {repo})',
        }
    })

    return [...definitions, ...dynamicDefinitions]
}
