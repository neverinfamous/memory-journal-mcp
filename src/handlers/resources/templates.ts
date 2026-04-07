/**
 * Memory Journal MCP Server - Template Resource Definitions
 *
 * Resources with URI templates (parameterized):
 * projects/{number}/timeline, issues/{issue_number}/entries, prs/{pr_number}/entries,
 * prs/{pr_number}/timeline, kanban/{project_number}, kanban/{project_number}/diagram
 */

import { ICON_ISSUE, ICON_PR } from '../../constants/icons.js'
import { RAW_ENTRY_COLUMNS as ENTRY_COLUMNS } from '../../database/core/entry-columns.js'
import { ASSISTANT_FOCUSED, MEDIUM_PRIORITY } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext } from './shared.js'
import { execQuery, transformEntryRow } from './shared.js'

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
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/projects\/(\d+)\/timeline/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                const rows = execQuery(
                    context.db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE project_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 50
                `,
                    [projectNumber]
                )
                const entries = rows.map(transformEntryRow)
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

                const rows = execQuery(
                    context.db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE issue_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `,
                    [issueNumber]
                )
                const entries = rows.map(transformEntryRow)
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

                const rows = execQuery(
                    context.db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE pr_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `,
                    [prNumber]
                )
                const entries = rows.map(transformEntryRow)
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

                const rows = execQuery(
                    context.db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE pr_number = ?
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `,
                    [prNumber]
                )
                const entries = rows.map(transformEntryRow)

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
        // Kanban board resources (GitHub Projects v2)
        {
            uri: 'memory://kanban/{project_number}',
            name: 'Kanban Board',
            title: 'GitHub Project Kanban Board',
            description: 'View a GitHub Project v2 as a Kanban board with items grouped by Status',
            mimeType: 'application/json',
            annotations: { ...MEDIUM_PRIORITY, audience: ['assistant'] },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/kanban\/(\d+)/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                if (!context.github) {
                    return {
                        error: 'GitHub integration not available',
                        hint: 'Set GITHUB_TOKEN environment variable.',
                    }
                }

                const repoInfo = await context.github.getRepoInfo()
                const owner = repoInfo.owner
                const repo = repoInfo.repo ?? undefined

                if (!owner) {
                    return {
                        error: 'Could not detect repository owner',
                        hint: 'Run the MCP server from a valid git repository or configure PROJECT_REGISTRY.',
                    }
                }

                const board = await context.github.getProjectKanban(owner, projectNumber, repo)
                if (!board) {
                    return {
                        error: `Project #${String(projectNumber)} not found or Status field not configured`,
                        projectNumber,
                        owner,
                        hint: 'Projects can be at user, repository, or organization level.',
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
                const match = /memory:\/\/kanban\/(\d+)\/diagram/.exec(uri)
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null

                if (projectNumber === null) {
                    return { error: 'Invalid project number' }
                }

                if (!context.github) {
                    return 'graph LR\n  NoGitHub["GitHub integration not available \u2014 set GITHUB_TOKEN and GITHUB_REPO_PATH"]'
                }

                const repoInfo = await context.github.getRepoInfo()
                const owner = repoInfo.owner
                const repo = repoInfo.repo ?? undefined

                if (!owner) {
                    return 'graph LR\n  NoOwner["Repository owner not detected \u2014 set GITHUB_REPO_PATH"]'
                }

                const board = await context.github.getProjectKanban(owner, projectNumber, repo)
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
}
