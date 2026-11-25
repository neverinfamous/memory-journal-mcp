/**
 * Memory Journal MCP Server - GitHub Resource Definitions
 *
 * Resources: github/status, github/insights, github/milestones, milestones/{number}
 */

import { ICON_GITHUB } from '../../constants/icons.js'
import { findCanonicalRegistryKey, loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { GitHubIssue, GitHubPullRequest, GitHubWorkflowRun, GitHubMilestone } from '../../types/index.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from './shared.js'
import {
    getBaseUri,
    resolveScopedGitHubRepo,
    isResourceError,
    milestoneCompletionPct,
    resourceWorkspace,
    safeDecodeUriSegment,
    fenceUntrustedInline,
    sliceUntrustedInline,
    withResourceTokenMeta,
} from './shared.js'
import { createGitHubMilestoneResources } from './github-milestones.js'
import { logger } from '../../utils/logger.js'
import { createNullProtoRecord } from '../../utils/type-guards.js'
import { fenceNonCanonicalRefOrKey } from '../../utils/security-utils.js'
import { fenceKanbanStatus } from '../tools/github/fencing-helpers.js'

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
            name:
                latest?.name !== undefined && latest.name !== ''
                    ? fenceUntrustedInline(latest.name)
                    : 'Unknown',
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
                case 'skipped':
                case null:
                default:
                    ciStatus = 'unknown'
            }
        } else if (workflowRuns.some((r) => r.status !== 'completed')) {
            ciStatus = 'pending'
        }
    }

    return { ciStatus, latestRun }
}

function resolveStatusKanbanProject(
    context: ResourceContext,
    canonicalRepo: string,
    registry: ReturnType<typeof loadProjectRegistryFromConfig>
): number | undefined {
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
    return repoProject ?? (canUseDefaultProj ? defaultProj : undefined)
}

interface StatusContextSnapshot {
    commit: string | null
    issues: GitHubIssue[]
    prs: GitHubPullRequest[]
    workflowRuns: GitHubWorkflowRun[]
    milestonesContext: GitHubMilestone[]
}

function extractRepoContextSnapshot(
    repoContextResult: PromiseSettledResult<
        Awaited<ReturnType<GitHubStatusClient['getRepoContext']>>
    >
): StatusContextSnapshot {
    if (repoContextResult.status === 'fulfilled') {
        const val = repoContextResult.value
        return {
            commit: val.commit,
            issues: (val.issues ?? []).slice(0, RESOURCE_ISSUE_LIMIT),
            prs: (val.pullRequests ?? []).slice(0, RESOURCE_PR_LIMIT),
            workflowRuns: (val.workflowRuns ?? []).slice(0, RESOURCE_WORKFLOW_LIMIT),
            milestonesContext: (val.milestones ?? []).slice(0, RESOURCE_STATUS_MILESTONE_LIMIT),
        }
    }
    logger.debug('Failed to fetch repo context', {
        module: 'RESOURCE',
        operation: 'github-status',
        error: repoContextResult.reason,
    })
    return { commit: null, issues: [], prs: [], workflowRuns: [], milestonesContext: [] }
}

type GitHubStatusClient = Extract<
    Awaited<ReturnType<typeof resolveScopedGitHubRepo>>,
    { github: unknown }
>['github']

function buildKanbanSummary(
    kanbanResult: PromiseSettledResult<
        Awaited<ReturnType<GitHubStatusClient['getProjectKanban']>>
    >
): Record<string, number> | null {
    if (kanbanResult.status === 'fulfilled' && kanbanResult.value) {
        const summary = createNullProtoRecord<number>()
        for (const col of kanbanResult.value.columns) {
            summary[fenceKanbanStatus(col.status)] = col.items.length
        }
        return summary
    }
    if (kanbanResult.status === 'rejected') {
        logger.debug('Failed to fetch Kanban board', {
            module: 'RESOURCE',
            operation: 'github-status',
            error: kanbanResult.reason,
        })
    }
    return null
}

function buildStatusFetchOutcome(
    repoContextResult: PromiseSettledResult<
        Awaited<ReturnType<GitHubStatusClient['getRepoContext']>>
    >,
    kanbanResult: PromiseSettledResult<
        Awaited<ReturnType<GitHubStatusClient['getProjectKanban']>>
    >,
    hasKanbanAttempt: boolean
): { fetchStatus: 'ok' | 'degraded' | 'failed'; failures: string[] } {
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
    if (failures.length === 0) {
        return { fetchStatus: 'ok', failures }
    }
    const totalAttempts = hasKanbanAttempt ? 2 : 1
    return {
        fetchStatus: failures.length === totalAttempts ? 'failed' : 'degraded',
        failures,
    }
}

function buildMilestoneSummary(
    repoContextResult: PromiseSettledResult<unknown>,
    milestonesContext: {
        number: number
        title: string
        state: string
        openIssues: number
        closedIssues: number
        dueOn?: string | null | undefined
    }[]
): {
    openCount: number
    items: {
        number: number
        title: string
        state: string
        openIssues: number
        closedIssues: number
        completionPercentage: number
        dueOn?: string | null | undefined
    }[]
} | null {
    if (repoContextResult.status !== 'fulfilled') return null
    return {
        openCount: milestonesContext.length,
        items: milestonesContext.map((ms) => ({
            number: ms.number,
            title: fenceUntrustedInline(ms.title),
            state: ms.state,
            openIssues: ms.openIssues,
            closedIssues: ms.closedIssues,
            completionPercentage: milestoneCompletionPct(ms.openIssues, ms.closedIssues),
            dueOn: ms.dueOn,
        })),
    }
}

async function handleGitHubStatusResource(
    uri: string,
    context: ResourceContext
): Promise<ResourceResult> {
    const match = /^memory:\/\/github\/status(?:\/(.*))?$/.exec(getBaseUri(uri))
    const targetRepo = match?.[1] ? safeDecodeUriSegment(match[1]) : undefined
    const resolved = await resolveScopedGitHubRepo(context, targetRepo)
    if (isResourceError(resolved)) return resolved
    const { owner, repo, branch, lastModified, github } = resolved

    const registry = context.briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const activeWs =
        targetRepo !== undefined && targetRepo !== ''
            ? targetRepo
            : resourceWorkspace(context)
    const canonicalRepo =
        findCanonicalRegistryKey(activeWs, registry) ??
        findCanonicalRegistryKey(repo, registry) ??
        activeWs
    const kanbanProject = resolveStatusKanbanProject(context, canonicalRepo, registry)

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

    const { commit, issues, prs, workflowRuns, milestonesContext } =
        extractRepoContextSnapshot(repoContextResult)
    const { ciStatus, latestRun } = summarizeCiWorkflows(workflowRuns)
    const kanbanSummary = buildKanbanSummary(kanbanResult)
    const milestoneSummary = buildMilestoneSummary(repoContextResult, milestonesContext)
    const { fetchStatus, failures } = buildStatusFetchOutcome(
        repoContextResult,
        kanbanResult,
        kanbanProject !== undefined
    )

    const responseData = {
        status: fetchStatus,
        failures: failures.length > 0 ? failures : undefined,
        repository: `${owner}/${repo}`,
        branch: branch !== null ? fenceNonCanonicalRefOrKey(branch) : null,
        commit: commit?.slice(0, 7) ?? null,
        ci: { status: ciStatus, latestRun },
        issues: {
            openCount: issues.length,
            items: issues.map((i) => ({
                number: i.number,
                title: sliceUntrustedInline(i.title, 50),
            })),
        },
        pullRequests: {
            openCount: prs.length,
            items: prs.map((pr) => ({
                number: pr.number,
                title: sliceUntrustedInline(pr.title, 50),
                state: pr.state,
            })),
        },
        kanbanSummary,
        milestones: milestoneSummary,
    }

    return {
        data: withResourceTokenMeta(responseData),
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
        ...createGitHubMilestoneResources(RESOURCE_MILESTONE_LIMIT),
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
