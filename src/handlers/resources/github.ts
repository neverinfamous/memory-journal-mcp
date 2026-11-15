/**
 * Memory Journal MCP Server - GitHub Resource Definitions
 *
 * Resources: github/status, github/insights, github/milestones, milestones/{number}
 */

import { ICON_GITHUB, ICON_MILESTONE } from '../../constants/icons.js'
import { findCanonicalRegistryKey } from '../../utils/workspace-resolver.js'
import {
    withPriority,
    ASSISTANT_FOCUSED,
    } from '../../utils/resource-annotations.js'
import type {
    GitHubIssue,
    GitHubPullRequest,
    GitHubWorkflowRun,
    GitHubMilestone,
} from '../../types/index.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import {
    resolveScopedGitHubRepo,
    isResourceError,
    milestoneCompletionPct,
    resourceWorkspace,
} from './shared.js'
import { markUntrustedContentInline } from '../../utils/security-utils.js'
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

function withGithubTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    ms: number,
    desc: string
): Promise<T> {
    const controller = new AbortController()
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            controller.abort()
            reject(new Error(`GitHub API timeout: ${desc}`))
        }, ms)
        timer.unref?.()
        try {
            operation(controller.signal).then(
                (value) => {
                    clearTimeout(timer)
                    resolve(value)
                },
                (err: unknown) => {
                    clearTimeout(timer)
                    reject(err instanceof Error ? err : new Error(String(err)))
                }
            )
        } catch (syncErr) {
            clearTimeout(timer)
            reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr)))
        }
    })
}

function summarizeCiWorkflows(workflowRuns: GitHubWorkflowRun[]): {
    ciStatus: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown'
    latestRun: { name: string; conclusion: string | null; headSha: string } | null
} {
    let ciStatus: 'passing' | 'failing' | 'pending' | 'cancelled' | 'unknown' = 'unknown'
    let latestRun: { name: string; conclusion: string | null; headSha: string } | null = null

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

    return { ciStatus, latestRun }
}

async function handleGitHubStatusResource(
    uri: string,
    context: ResourceContext
): Promise<ResourceResult> {
    const match = /memory:\/\/github\/status\/?(.*)?/.exec(uri)
    const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
    const resolved = await resolveScopedGitHubRepo(context, targetRepo)
    if (isResourceError(resolved)) return resolved
    const { owner, repo, branch, lastModified, github } = resolved

    const registry = context.briefingConfig?.projectRegistry
    const activeWs =
        targetRepo !== undefined && targetRepo !== ''
            ? targetRepo
            : resourceWorkspace(context)
    const canonicalRepo = findCanonicalRegistryKey(activeWs, registry) ?? activeWs
    const repoProject = registry?.[canonicalRepo]?.project_number
    const defaultProj = context.briefingConfig?.defaultProjectNumber
    const defaultWs = context.briefingConfig?.defaultWorkspaceId
    const claimedElsewhere =
        defaultProj !== undefined &&
        registry !== undefined &&
        Object.entries(registry).some(
            ([k, v]) =>
                v.project_number === defaultProj &&
                k.toLowerCase() !== canonicalRepo.toLowerCase()
        )
    const canUseDefaultProj =
        defaultProj !== undefined &&
        !claimedElsewhere &&
        (defaultWs === undefined ||
            defaultWs.toLowerCase() === canonicalRepo.toLowerCase())
    const kanbanProject = repoProject ?? (canUseDefaultProj ? defaultProj : undefined)

    const [repoContextResult, kanbanResult] = await Promise.allSettled([
        withGithubTimeout((s) => github.getRepoContext(s), 10000, 'getRepoContext'),
        kanbanProject !== undefined
            ? withGithubTimeout(
                  (s) => github.getProjectKanban(owner, kanbanProject, repo, s),
                  10000,
                  'getProjectKanban'
              )
            : Promise.resolve(null),
    ])

    let commit: string | null = null
    let issues: GitHubIssue[] = []
    let prs: GitHubPullRequest[] = []
    let workflowRuns: GitHubWorkflowRun[] = []
    let milestonesContext: GitHubMilestone[] = []

    if (repoContextResult.status === 'fulfilled') {
        commit = repoContextResult.value.commit
        issues = (repoContextResult.value.issues ?? []).slice(0, RESOURCE_ISSUE_LIMIT)
        prs = (repoContextResult.value.pullRequests ?? []).slice(0, RESOURCE_PR_LIMIT)
        workflowRuns = (repoContextResult.value.workflowRuns ?? []).slice(0, RESOURCE_WORKFLOW_LIMIT)
        milestonesContext = (repoContextResult.value.milestones ?? []).slice(
            0,
            RESOURCE_STATUS_MILESTONE_LIMIT
        )
    } else {
        logger.debug('Failed to fetch repo context', {
            module: 'RESOURCE',
            operation: 'github-status',
            error: repoContextResult.reason,
        })
    }

    const openIssues = issues.map((i) => ({
        number: i.number,
        title: markUntrustedContentInline(i.title.slice(0, 50)),
    }))

    const openPrs = prs.map((pr) => ({
        number: pr.number,
        title: markUntrustedContentInline(pr.title.slice(0, 50)),
        state: pr.state,
    }))

    const { ciStatus, latestRun } = summarizeCiWorkflows(workflowRuns)

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

    const milestoneSummary =
        repoContextResult.status === 'fulfilled'
            ? {
                  openCount: milestonesContext.length,
                  items: milestonesContext.map((ms) => ({
                      number: ms.number,
                      title: markUntrustedContentInline(ms.title),
                      state: ms.state,
                      openIssues: ms.openIssues,
                      closedIssues: ms.closedIssues,
                      completionPercentage: milestoneCompletionPct(ms.openIssues, ms.closedIssues),
                      dueOn: ms.dueOn,
                  })),
              }
            : null

    let fetchStatus: 'ok' | 'degraded' | 'failed' = 'ok'
    const failures: string[] = []
    if (repoContextResult.status === 'rejected') failures.push('context')
    if (
        repoContextResult.status === 'fulfilled' &&
        Array.isArray(repoContextResult.value.degraded) &&
        repoContextResult.value.degraded.length > 0
    ) {
        failures.push('context')
    }
    if (kanbanResult.status === 'rejected') failures.push('kanban')
    if (failures.length > 0) {
        const totalAttempts = kanbanProject !== undefined ? 2 : 1
        fetchStatus = failures.length === totalAttempts ? 'failed' : 'degraded'
    }

    const responseData = {
        status: fetchStatus,
        failures: failures.length > 0 ? failures : undefined,
        repository: `${owner}/${repo}`,
        branch,
        commit: commit?.slice(0, 7) ?? null,
        ci: { status: ciStatus, latestRun },
        issues: { openCount: issues.length, items: openIssues },
        pullRequests: { openCount: prs.length, items: openPrs },
        kanbanSummary,
        milestones: milestoneSummary,
    }
    const tokenEstimate = Math.ceil(JSON.stringify(responseData).length / 4)

    return {
        data: { ...responseData, _meta: { tokenEstimate } },
        annotations: { lastModified },
    }
}

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
            handler: handleGitHubStatusResource,
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
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const match = /memory:\/\/github\/milestones\/?(.*)?/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const resolved = await resolveScopedGitHubRepo(context, targetRepo)
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
                    return {
                        ...ms,
                        title: markUntrustedContentInline(ms.title),
                        completionPercentage,
                    }
                })

                const responseData = {
                    repository: `${owner}/${repo}`,
                    milestones: milestonesWithProgress,
                    count: milestonesWithProgress.length,
                    hint: 'Use get_github_milestones tool for state filtering. Use memory://milestones/{number} for detail.',
                }
                const tokenEstimate = Math.ceil(JSON.stringify(responseData).length / 4)

                return {
                    data: {
                        ...responseData,
                        _meta: { tokenEstimate }
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
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: async (uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const lastModified = new Date().toISOString()
                const match = /memory:\/\/milestones\/(?:(.*)\/)?(\d+)$/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const milestoneNumber = match?.[2] ? parseInt(match[2], 10) : null

                if (milestoneNumber === null || isNaN(milestoneNumber)) {
                    return {
                        data: { error: 'Invalid milestone number', code: -32002 },
                        annotations: { lastModified },
                    }
                }

                const resolved = await resolveScopedGitHubRepo(context, targetRepo)
                if (isResourceError(resolved)) return resolved
                const { owner, repo, github } = resolved

                const milestone = await github.getMilestone(owner, repo, milestoneNumber)
                if (!milestone) {
                    return {
                        data: { error: `Milestone #${String(milestoneNumber)} not found`, code: -32002 },
                        annotations: { lastModified },
                    }
                }

                const completionPercentage = milestoneCompletionPct(
                    milestone.openIssues,
                    milestone.closedIssues
                )

                const responseData = {
                    repository: `${owner}/${repo}`,
                    milestone: {
                        ...milestone,
                        title: markUntrustedContentInline(milestone.title),
                        completionPercentage,
                    },
                    hint: 'Use get_github_issues tool to list issues associated with this milestone.',
                }
                const tokenEstimate = Math.ceil(JSON.stringify(responseData).length / 4)

                return {
                    data: {
                        ...responseData,
                        _meta: { tokenEstimate }
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
            description:
                def.description +
                ' (Supports explicit multi-project repository targeting via {repo})',
        }
    })

    return [...definitions, ...dynamicDefinitions]
}
