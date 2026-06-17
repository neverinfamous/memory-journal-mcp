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
import { resolveGitHubRepo, isResourceError } from './shared.js'
import { parseSessionCommitContext } from '../../types/auto-context.js'
import { enrichCommits } from '../../github/commit-references/index.js'

/**
 * Get template resource definitions
 */
export function getTemplateResourceDefinitions(): InternalResourceDef[] {
    const definitions: InternalResourceDef[] = [
        {
            uri: 'memory://projects/{number}/timeline',
            name: 'Project Timeline',
            title: 'Project Activity Timeline',
            description: 'Project activity timeline',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/projects\/(\d+)\/timeline/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const { entries } = context.db.searchEntries('', { projectNumber, limit: 50 })
                return { projectNumber, entries, count: entries.length }
            },
        },
        {
            uri: 'memory://issues/{issue_number}/entries',
            name: 'Issue Entries',
            title: 'Entries Linked to Issue',
            description: 'All entries linked to a specific issue',
            mimeType: 'application/json',
            icons: [ICON_ISSUE],
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/issues\/(\d+)\/entries/.exec(uri)
                const issueNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (issueNumber === null) {
                    return { error: 'Invalid issue number' }
                }

                const { entries } = context.db.searchEntries('', { issueNumber, limit: 100 })
                return { issueNumber, entries, count: entries.length }
            },
        },
        {
            uri: 'memory://prs/{pr_number}/entries',
            name: 'PR Entries',
            title: 'Entries Linked to PR',
            description: 'All entries linked to a specific pull request',
            mimeType: 'application/json',
            icons: [ICON_PR],
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/prs\/(\d+)\/entries/.exec(uri)
                const prNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (prNumber === null) {
                    return { error: 'Invalid PR number' }
                }

                const { entries } = context.db.searchEntries('', { prNumber, limit: 100 })
                return {
                    prNumber,
                    entries,
                    count: entries.length,
                    ...(entries.length === 0
                        ? {
                              hint: 'No journal entries linked to this PR. Use create_entry with pr_number to link entries.',
                          }
                        : {}),
                }
            },
        },
        {
            uri: 'memory://prs/{pr_number}/timeline',
            name: 'PR Timeline',
            title: 'Combined PR and Journal Timeline',
            description: 'Combined PR + journal timeline with live PR metadata',
            mimeType: 'application/json',
            icons: [ICON_PR],
            annotations: ASSISTANT_FOCUSED,
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/prs\/(\d+)\/timeline/.exec(uri)
                const prNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (prNumber === null) {
                    return { error: 'Invalid PR number' }
                }

                // Fetch live PR metadata from GitHub if available
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

                if (context.github) {
                    try {
                        const repoInfo = await context.github.getRepoInfo()
                        if (repoInfo.owner && repoInfo.repo) {
                            const pr = await context.github.getPullRequest(
                                repoInfo.owner,
                                repoInfo.repo,
                                prNumber
                            )
                            if (pr) {
                                prMetadata = {
                                    title: pr.title,
                                    state: pr.state,
                                    draft: pr.draft,
                                    mergedAt: pr.mergedAt,
                                    closedAt: pr.closedAt,
                                    author: pr.author,
                                    headBranch: pr.headBranch,
                                    baseBranch: pr.baseBranch,
                                }
                            }
                        }
                    } catch {
                        // GitHub not available, proceed without metadata
                    }
                }

                const { entries } = context.db.searchEntries('', { prNumber, limit: 100 })

                let timelineNote: string
                if (prMetadata) {
                    const stateDesc = prMetadata.state.toLowerCase()
                    const mergedNote = prMetadata.mergedAt ? ' (merged)' : ''
                    const draftNote = prMetadata.draft ? ' [DRAFT]' : ''
                    timelineNote = `PR #${String(prNumber)} is ${stateDesc}${mergedNote}${draftNote}`
                } else {
                    timelineNote =
                        'GitHub integration unavailable for live PR status. Entry timestamps show journal activity.'
                }

                return {
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
                }
            },
        },
        {
            uri: 'memory://commits/{project_number}',
            name: 'Project Commits',
            title: 'Project Commits from Summaries',
            description: 'Aggregates all commit SHAs from session summary auto_context',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/commits\/(\d+)$/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const { entries } = context.db.searchEntries('', { projectNumber, limit: 200 })

                const commits: string[] = []
                const metadata: Record<string, unknown>[] = []

                for (const entry of entries) {
                    if (entry.tags.includes('session-summary') || entry.tags.includes('commit-narrative')) {
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
                }

                const uniqueCommits = Array.from(new Set(commits))

                let enrichedCommits: Awaited<ReturnType<typeof enrichCommits>> = []
                const cwd = process.cwd()
                if (uniqueCommits.length > 0) {
                    enrichedCommits = await enrichCommits(
                        cwd,
                        uniqueCommits,
                        context.github ?? undefined
                    )
                }

                return {
                    projectNumber,
                    commits: uniqueCommits,
                    metadata,
                    enrichedCommits,
                    count: uniqueCommits.length,
                }
            },
        },
        {
            uri: 'memory://commits/{project_number}/by-issue',
            name: 'Commits by Issue',
            title: 'Project Commits Grouped by Issue',
            description: 'Groups project commits by referenced GitHub issues',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/commits\/(\d+)\/by-issue$/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const { entries } = context.db.searchEntries('', { projectNumber, limit: 200 })
                const commits: string[] = []

                for (const entry of entries) {
                    if (entry.tags.includes('session-summary') || entry.tags.includes('commit-narrative')) {
                        const ctx = parseSessionCommitContext(entry.autoContext)
                        if (ctx && ctx.commits.length > 0) {
                            commits.push(...ctx.commits)
                        }
                    }
                }

                const uniqueCommits = Array.from(new Set(commits))
                interface IssueGroup {
                    number: number;
                    title?: string;
                    state?: string;
                    milestone?: { number: number; title: string };
                    commits: { hash: string; subject: string; authorName: string; date: string; }[];
                }
                const issues: Record<number, IssueGroup> = {}
                const cwd = process.cwd()

                if (uniqueCommits.length > 0) {
                    const enrichedCommits = await enrichCommits(
                        cwd,
                        uniqueCommits,
                        context.github ?? undefined
                    )

                    for (const commit of enrichedCommits) {
                        for (const ref of commit.references) {
                            if (ref.type === 'issue') {
                                issues[ref.number] ??= {
                                    number: ref.number,
                                    title: ref.title,
                                    state: ref.state,
                                    milestone: ref.milestone,
                                    commits: [],
                                }
                                const group = issues[ref.number]
                                if (group) {
                                    group.commits.push({
                                        hash: commit.hash,
                                        subject: commit.subject,
                                        authorName: commit.authorName,
                                        date: commit.date,
                                    })
                                }
                            }
                        }
                    }
                }

                return {
                    projectNumber,
                    issues: Object.values(issues),
                }
            },
        },
        {
            uri: 'memory://commits/{project_number}/by-pr',
            name: 'Commits by PR',
            title: 'Project Commits Grouped by PR',
            description: 'Groups project commits by referenced GitHub pull requests',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/commits\/(\d+)\/by-pr$/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const { entries } = context.db.searchEntries('', { projectNumber, limit: 200 })
                const commits: string[] = []

                for (const entry of entries) {
                    if (entry.tags.includes('session-summary') || entry.tags.includes('commit-narrative')) {
                        const ctx = parseSessionCommitContext(entry.autoContext)
                        if (ctx && ctx.commits.length > 0) {
                            commits.push(...ctx.commits)
                        }
                    }
                }

                const uniqueCommits = Array.from(new Set(commits))
                interface PRGroup {
                    number: number;
                    title?: string;
                    state?: string;
                    commits: { hash: string; subject: string; authorName: string; date: string; }[];
                }
                const prs: Record<number, PRGroup> = {}
                const cwd = process.cwd()

                if (uniqueCommits.length > 0) {
                    const enrichedCommits = await enrichCommits(
                        cwd,
                        uniqueCommits,
                        context.github ?? undefined
                    )

                    for (const commit of enrichedCommits) {
                        for (const ref of commit.references) {
                            if (ref.type === 'pull_request') {
                                prs[ref.number] ??= {
                                    number: ref.number,
                                    title: ref.title,
                                    state: ref.state,
                                    commits: [],
                                }
                                const group = prs[ref.number]
                                if (group) {
                                    group.commits.push({
                                        hash: commit.hash,
                                        subject: commit.subject,
                                        authorName: commit.authorName,
                                        date: commit.date,
                                    })
                                }
                            }
                        }
                    }
                }

                return {
                    projectNumber,
                    pullRequests: Object.values(prs),
                }
            },
        },
        // Kanban board resources (GitHub Projects v2)
        {
            uri: 'memory://kanban/{project_number}',
            name: 'Kanban Board',
            title: 'GitHub Project Kanban Board',
            description: 'View a GitHub Project v2 as a Kanban board with items grouped by Status',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/kanban\/(?:(.*)\/)?(\d+)$/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const projectNumber = match?.[2] ? parseInt(match[2], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const resolved = await resolveGitHubRepo(
                    context.github,
                    context.briefingConfig,
                    targetRepo,
                    context.runtime
                )
                if (isResourceError(resolved)) return resolved.data
                const { owner, repo, github } = resolved

                const board = await github.getProjectKanban(owner, projectNumber, repo)
                if (!board) {
                    return {
                        error: `Project #${String(projectNumber)} not found or Status field not configured`,
                        projectNumber,
                        owner,
                        hint: 'Projects can be at user, repository, or organization level.',
                    }
                }

                // Strip 'body' from all items to mitigate massive payload size
                for (const column of board.columns) {
                    for (const item of column.items) {
                        if ('body' in item) {
                            delete (item as { body?: string }).body
                        }
                    }
                }

                return board
            },
        },
        {
            uri: 'memory://kanban/{project_number}/diagram',
            name: 'Kanban Diagram',
            title: 'Kanban Board Mermaid Diagram',
            description: 'Mermaid diagram visualization of a GitHub Project Kanban board',
            mimeType: 'text/plain',
            annotations: MEDIUM_PRIORITY,
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/kanban\/(?:(.*)\/)?(\d+)\/diagram$/.exec(uri)
                const targetRepo = match?.[1] ? decodeURIComponent(match[1]) : undefined
                const projectNumber = match?.[2] ? parseInt(match[2], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const resolved = await resolveGitHubRepo(
                    context.github,
                    context.briefingConfig,
                    targetRepo,
                    context.runtime
                )
                if (isResourceError(resolved)) {
                    // It returns a mermaid graph because the MIME type is text/plain.
                    const errObj = resolved.data as { error: string; hint?: string }
                    return `graph LR\n  Error["${errObj.error.replace(/["[\]]/g, "'")} \u2014 ${
                        errObj.hint ? errObj.hint.replace(/["[\]]/g, "'") : ''
                    }"]`
                }
                const { owner, repo, github } = resolved

                const board = await github.getProjectKanban(owner, projectNumber, repo)
                if (!board) {
                    return `graph LR\n  NotFound["Project #${String(projectNumber)} not found \u2014 ensure project exists with a Status field"]`
                }

                // Build Mermaid diagram with subgraphs for each column
                const lines: string[] = ['graph LR']

                lines.push('  classDef issue fill:#28a745,color:#fff')
                lines.push('  classDef pr fill:#6f42c1,color:#fff')
                lines.push('  classDef draft fill:#6c757d,color:#fff')

                for (const column of board.columns) {
                    const safeStatus = column.status.replace(/["\s]/g, '_')
                    lines.push(
                        `  subgraph ${safeStatus}["${column.status} (${String(column.items.length)})"]`
                    )

                    for (const item of column.items) {
                        const safeId = item.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)
                        const label = item.title.slice(0, 25).replace(/["[\]]/g, "'")
                        const typeIcon =
                            item.type === 'ISSUE'
                                ? '🔵'
                                : item.type === 'PULL_REQUEST'
                                  ? '🟣'
                                  : '⚪'
                        const numberStr =
                            item.number !== undefined && item.number !== 0
                                ? `#${String(item.number)}`
                                : ''
                        lines.push(`    I${safeId}["${typeIcon} ${numberStr} ${label}..."]`)

                        const typeClass =
                            item.type === 'ISSUE'
                                ? 'issue'
                                : item.type === 'PULL_REQUEST'
                                  ? 'pr'
                                  : 'draft'
                        lines.push(`    class I${safeId} ${typeClass}`)
                    }

                    lines.push('  end')
                }

                return lines.join('\n')
            },
        },
    ]

    // Generate dynamic `{repo}` variants for multi-project registry support
    const dynamicDefinitions: InternalResourceDef[] = []

    for (const def of definitions) {
        if (def.uri.startsWith('memory://kanban/')) {
            const dynamicUri = def.uri.replace('{project_number}', '{+repo}/{project_number}')
            dynamicDefinitions.push({
                ...def,
                uri: dynamicUri,
                name: def.name + ' (Dynamic)',
                description:
                    def.description +
                    ' (Supports explicit multi-project repository targeting via {repo})',
            })
        }
    }

    return [...definitions, ...dynamicDefinitions]
}
