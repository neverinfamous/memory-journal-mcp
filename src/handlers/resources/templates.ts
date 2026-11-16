/**
 * Memory Journal MCP Server - Template Resource Definitions
 *
 * Resources with URI templates (parameterized):
 * projects/{number}/timeline, issues/{issue_number}/entries, prs/{pr_number}/entries,
 * prs/{pr_number}/timeline, kanban/{project_number}, kanban/{project_number}/diagram
 */

import { ICON_ISSUE, ICON_PR } from '../../constants/icons.js'
import { ASSISTANT_FOCUSED, MEDIUM_PRIORITY } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext } from './shared.js'
import {
    fenceUntrustedInline,
    getBaseUri,
    resolveScopedGitHubRepo,
    isResourceError,
    resourceWorkspace,
} from './shared.js'
import { getKanbanTemplateDefinitions } from './templates-kanban.js'
import { parseSessionCommitContext } from '../../types/auto-context.js'
import { enrichCommits } from '../../github/commit-references/index.js'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import {
    resolveProjectScope,
    collectUniqueCommits,
    resolveCommitGithub,
    fenceEnrichedCommits,
    groupCommitsByIssue,
    groupCommitsByPr,
} from './template-helpers.js'

function parsePositiveParam(uri: string, pattern: RegExp, errorMessage: string): number {
    const match = pattern.exec(getBaseUri(uri))
    const raw = match?.[1]
    if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, errorMessage)
    }
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, errorMessage)
    }
    return parsed
}

function withTokenMeta<T extends Record<string, unknown>>(data: T): T & { _meta: { tokenEstimate: number } } {
    const tokenEstimate = Math.ceil(JSON.stringify(data).length / 4)
    return { ...data, _meta: { tokenEstimate } }
}

function handleProjectTimelineResource(uri: string, context: ResourceContext): Record<string, unknown> {
    const projectNumber = parsePositiveParam(
        uri,
        /^memory:\/\/projects\/(\d+)\/timeline$/,
        'Invalid project number'
    )
    const scope = resolveProjectScope(context, projectNumber)
    if (scope.hint !== undefined) {
        return {
            projectNumber,
            status: 'unresolved',
            error: scope.hint,
            entries: [],
            count: 0,
            hint: scope.hint,
        }
    }
    const { entries } = context.db.searchEntries('', {
        workspaceId: scope.workspaceId,
        projectNumber,
        limit: 50,
    })
    return withTokenMeta({ projectNumber, entries, count: entries.length })
}

function handleIssueEntriesResource(uri: string, context: ResourceContext): Record<string, unknown> {
    const issueNumber = parsePositiveParam(
        uri,
        /^memory:\/\/issues\/(\d+)\/entries$/,
        'Invalid issue number'
    )
    const { entries } = context.db.searchEntries('', {
        workspaceId: resourceWorkspace(context),
        issueNumber,
        limit: 100,
    })
    return withTokenMeta({ issueNumber, entries, count: entries.length })
}

function handlePrEntriesResource(uri: string, context: ResourceContext): Record<string, unknown> {
    const prNumber = parsePositiveParam(
        uri,
        /^memory:\/\/prs\/(\d+)\/entries$/,
        'Invalid PR number'
    )
    const { entries } = context.db.searchEntries('', {
        workspaceId: resourceWorkspace(context),
        prNumber,
        limit: 100,
    })
    return withTokenMeta({
        prNumber,
        entries,
        count: entries.length,
        ...(entries.length === 0
            ? {
                  hint: 'No journal entries linked to this PR. Use create_entry with pr_number to link entries.',
              }
            : {}),
    })
}

async function fetchPrMetadataForTimeline(
    context: ResourceContext,
    prNumber: number
): Promise<{
    prMetadata: {
        title: string
        state: string
        draft: boolean
        mergedAt: string | null
        closedAt: string | null
        author: string
        headBranch: string
        baseBranch: string
    } | null
    rawPrState: string | undefined
    rawPrMergedAt: string | null | undefined
    rawPrDraft: boolean
}> {
    let prMetadata: {
        title: string
        state: string
        draft: boolean
        mergedAt: string | null
        closedAt: string | null
        author: string
        headBranch: string
        baseBranch: string
    } | null = null
    let rawPrState: string | undefined
    let rawPrMergedAt: string | null | undefined
    let rawPrDraft = false

    try {
        const resolvedRepo = await resolveScopedGitHubRepo(context)
        if (!isResourceError(resolvedRepo)) {
            const pr = await resolvedRepo.github.getPullRequest(
                resolvedRepo.owner,
                resolvedRepo.repo,
                prNumber
            )
            if (pr) {
                rawPrState = pr.state
                rawPrMergedAt = pr.mergedAt
                rawPrDraft = pr.draft
                prMetadata = {
                    title: fenceUntrustedInline(pr.title),
                    state: pr.state,
                    draft: pr.draft,
                    mergedAt: pr.mergedAt,
                    closedAt: pr.closedAt,
                    author: fenceUntrustedInline(pr.author),
                    headBranch: fenceUntrustedInline(pr.headBranch),
                    baseBranch: fenceUntrustedInline(pr.baseBranch),
                }
            }
        }
    } catch {
        // GitHub not available, proceed without metadata
    }

    return { prMetadata, rawPrState, rawPrMergedAt, rawPrDraft }
}

async function handlePrTimelineResource(
    uri: string,
    context: ResourceContext
): Promise<Record<string, unknown>> {
    const prNumber = parsePositiveParam(
        uri,
        /^memory:\/\/prs\/(\d+)\/timeline$/,
        'Invalid PR number'
    )
    const { prMetadata, rawPrState, rawPrMergedAt, rawPrDraft } = await fetchPrMetadataForTimeline(
        context,
        prNumber
    )
    const { entries } = context.db.searchEntries('', {
        workspaceId: resourceWorkspace(context),
        prNumber,
        limit: 100,
    })

    let timelineNote: string
    if (prMetadata && rawPrState !== undefined) {
        const stateDesc = rawPrState.toLowerCase()
        const mergedNote = rawPrMergedAt ? ' (merged)' : ''
        const draftNote = rawPrDraft ? ' [DRAFT]' : ''
        timelineNote = `PR #${String(prNumber)} is ${stateDesc}${mergedNote}${draftNote}`
    } else {
        timelineNote =
            'GitHub integration unavailable for live PR status. Entry timestamps show journal activity.'
    }

    return withTokenMeta({
        prNumber,
        prMetadata,
        entries,
        count: entries.length,
        timelineNote,
        ...(entries.length === 0
            ? {
                  hint: 'No journal entries linked to this PR. Use create_entry with pr_number to link entries.',
              }
            : {}),
    })
}

async function handleProjectCommitsResource(
    uri: string,
    context: ResourceContext
): Promise<Record<string, unknown>> {
    const projectNumber = parsePositiveParam(
        uri,
        /^memory:\/\/commits\/(\d+)$/,
        'Invalid project number'
    )
    const scope = resolveProjectScope(context, projectNumber)
    if (scope.hint !== undefined) {
        return {
            projectNumber,
            status: 'unresolved',
            error: scope.hint,
            commits: [],
            metadata: [],
            enrichedCommits: [],
            count: 0,
            hint: scope.hint,
        }
    }

    const { entries } = context.db.searchEntries('', {
        workspaceId: scope.workspaceId,
        projectNumber,
        limit: 200,
    })
    const commits: string[] = []
    const metadata: Record<string, unknown>[] = []

    for (const entry of entries) {
        if (!entry.tags.includes('session-summary') && !entry.tags.includes('commit-narrative')) {
            continue
        }
        const ctx = parseSessionCommitContext(entry.autoContext)
        if (ctx && ctx.commits.length > 0) {
            commits.push(...ctx.commits)
            metadata.push({
                entryId: entry.id,
                timestamp: entry.timestamp,
                commits: ctx.commits,
                branch: ctx.branch,
                pr: ctx.pr,
                repo: ctx.repo,
            })
        }
    }

    const uniqueCommits = Array.from(new Set(commits))
    const enrichedCommits =
        uniqueCommits.length > 0
            ? fenceEnrichedCommits(
                  await enrichCommits(scope.cwd, uniqueCommits, resolveCommitGithub(context, scope))
              )
            : []

    return withTokenMeta({
        projectNumber,
        commits: uniqueCommits,
        metadata,
        enrichedCommits,
        count: uniqueCommits.length,
    })
}

async function handleCommitsByIssueResource(
    uri: string,
    context: ResourceContext
): Promise<Record<string, unknown>> {
    const projectNumber = parsePositiveParam(
        uri,
        /^memory:\/\/commits\/(\d+)\/by-issue$/,
        'Invalid project number'
    )
    const scope = resolveProjectScope(context, projectNumber)
    if (scope.hint !== undefined) {
        return { projectNumber, status: 'unresolved', error: scope.hint, issues: [], hint: scope.hint }
    }
    const { entries } = context.db.searchEntries('', {
        workspaceId: scope.workspaceId,
        projectNumber,
        limit: 200,
    })
    const uniqueCommits = collectUniqueCommits(entries)
    const issues =
        uniqueCommits.length > 0
            ? groupCommitsByIssue(
                  await enrichCommits(scope.cwd, uniqueCommits, resolveCommitGithub(context, scope))
              )
            : []
    return withTokenMeta({ projectNumber, issues })
}

async function handleCommitsByPrResource(
    uri: string,
    context: ResourceContext
): Promise<Record<string, unknown>> {
    const projectNumber = parsePositiveParam(
        uri,
        /^memory:\/\/commits\/(\d+)\/by-pr$/,
        'Invalid project number'
    )
    const scope = resolveProjectScope(context, projectNumber)
    if (scope.hint !== undefined) {
        return { projectNumber, status: 'unresolved', error: scope.hint, pullRequests: [], hint: scope.hint }
    }
    const { entries } = context.db.searchEntries('', {
        workspaceId: scope.workspaceId,
        projectNumber,
        limit: 200,
    })
    const uniqueCommits = collectUniqueCommits(entries)
    const pullRequests =
        uniqueCommits.length > 0
            ? groupCommitsByPr(
                  await enrichCommits(scope.cwd, uniqueCommits, resolveCommitGithub(context, scope))
              )
            : []
    return withTokenMeta({ projectNumber, pullRequests })
}

/**
 * Get template resource definitions
 */
export function getTemplateResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://projects/{number}/timeline',
            name: 'Project Timeline',
            title: 'Project Activity Timeline',
            description: 'Project activity timeline',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: handleProjectTimelineResource,
        },
        {
            uri: 'memory://issues/{issue_number}/entries',
            name: 'Issue Entries',
            title: 'Entries Linked to Issue',
            description: 'All entries linked to a specific issue',
            mimeType: 'application/json',
            icons: [ICON_ISSUE],
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: handleIssueEntriesResource,
        },
        {
            uri: 'memory://prs/{pr_number}/entries',
            name: 'PR Entries',
            title: 'Entries Linked to PR',
            description: 'All entries linked to a specific pull request',
            mimeType: 'application/json',
            icons: [ICON_PR],
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: handlePrEntriesResource,
        },
        {
            uri: 'memory://prs/{pr_number}/timeline',
            name: 'PR Timeline',
            title: 'Combined PR and Journal Timeline',
            description: 'Combined PR + journal timeline with live PR metadata',
            mimeType: 'application/json',
            icons: [ICON_PR],
            annotations: ASSISTANT_FOCUSED,
            handler: handlePrTimelineResource,
        },
        {
            uri: 'memory://commits/{project_number}',
            name: 'Project Commits',
            title: 'Project Commits from Summaries',
            description: 'Aggregates all commit SHAs from session summary auto_context',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: handleProjectCommitsResource,
        },
        {
            uri: 'memory://commits/{project_number}/by-issue',
            name: 'Commits by Issue',
            title: 'Project Commits Grouped by Issue',
            description: 'Groups project commits by referenced GitHub issues',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: handleCommitsByIssueResource,
        },
        {
            uri: 'memory://commits/{project_number}/by-pr',
            name: 'Commits by PR',
            title: 'Project Commits Grouped by PR',
            description: 'Groups project commits by referenced GitHub pull requests',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: handleCommitsByPrResource,
        },
        // Kanban board resources (GitHub Projects v2) — extracted to templates-kanban.ts
        ...getKanbanTemplateDefinitions(),
    ]
}
