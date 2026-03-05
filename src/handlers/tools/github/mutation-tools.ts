/**
 * GitHub Mutation Tools - 3 tools
 *
 * Tools: get_kanban_board, move_kanban_item, create_github_issue_with_entry,
 *        close_github_issue_with_entry
 */

import { z } from 'zod'
import type {
    ToolDefinition,
    ToolContext,
    EntryType,
    SignificanceType,
} from '../../../types/index.js'
import type { GitHubIntegration } from '../../../github/GitHubIntegration.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    KanbanBoardOutputSchema,
    MoveKanbanItemOutputSchema,
    CreateGitHubIssueWithEntryOutputSchema,
    CloseGitHubIssueWithEntryOutputSchema,
} from './schemas.js'

// ============================================================================
// Helper: owner resolution (owner-only, no repo required)
// ============================================================================

async function resolveOwner(
    context: ToolContext,
    inputOwner?: string
): Promise<
    | {
          owner: string
          detectedOwner: string | null
          repo: string | undefined
          github: GitHubIntegration
      }
    | { error: true; response: Record<string, unknown> }
> {
    if (!context.github) {
        return { error: true, response: { error: 'GitHub integration not available' } }
    }

    const repoInfo = await context.github.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const owner = inputOwner ?? detectedOwner ?? undefined
    const repo = repoInfo.repo ?? undefined

    if (!owner) {
        return {
            error: true,
            response: {
                error: 'STOP: Could not auto-detect repository owner. DO NOT GUESS. You MUST ask the user to provide the GitHub owner.',
                requiresUserInput: true,
                detectedOwner,
                instruction:
                    'Ask the user: "What GitHub username or organization owns this project?"',
            },
        }
    }

    return { owner, detectedOwner, repo, github: context.github }
}

async function resolveOwnerRepo(
    context: ToolContext,
    input: { owner?: string; repo?: string }
): Promise<
    | {
          owner: string
          repo: string
          detectedOwner: string | null
          detectedRepo: string | null
          github: GitHubIntegration
      }
    | { error: true; response: Record<string, unknown> }
> {
    if (!context.github) {
        return { error: true, response: { error: 'GitHub integration not available' } }
    }

    const repoInfo = await context.github.getRepoInfo()
    const detectedOwner = repoInfo.owner
    const detectedRepo = repoInfo.repo
    const owner = input.owner ?? detectedOwner ?? undefined
    const repo = input.repo ?? detectedRepo ?? undefined

    if (!owner || !repo) {
        return {
            error: true,
            response: {
                error: 'STOP: Could not auto-detect repository. DO NOT GUESS.',
                requiresUserInput: true,
                detected: { owner, repo },
            },
        }
    }

    return { owner, repo, detectedOwner, detectedRepo, github: context.github }
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getGitHubMutationTools(context: ToolContext): ToolDefinition[] {
    const { db } = context
    return [
        {
            name: 'get_kanban_board',
            title: 'Get Kanban Board',
            description:
                'View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.',
            group: 'github',
            inputSchema: z.object({
                project_number: z.number().describe('GitHub Project number (from the project URL)'),
                owner: z
                    .string()
                    .optional()
                    .describe('Repository owner - LEAVE EMPTY to auto-detect from git'),
            }),
            outputSchema: KanbanBoardOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.number(),
                            owner: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwner(context, input.owner)
                    if ('error' in resolved) return resolved.response

                    const board = await resolved.github.getProjectKanban(
                        resolved.owner,
                        input.project_number,
                        resolved.repo
                    )
                    if (!board) {
                        return {
                            error: `Project #${String(input.project_number)} not found or Status field not configured`,
                            owner: resolved.owner,
                            repo: resolved.repo,
                            hint: 'Ensure the project exists and has a "Status" single-select field. Projects can be at user, repository, or organization level.',
                        }
                    }

                    return {
                        ...board,
                        owner: resolved.owner,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.repo,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'move_kanban_item',
            title: 'Move Kanban Item',
            description:
                'Move a project item to a different Status column. Use get_kanban_board first to get the item_id and exact status names. Status matching is case-insensitive.',
            group: 'github',
            inputSchema: z.object({
                project_number: z.number().describe('GitHub Project number'),
                item_id: z.string().describe('Project item node ID (from get_kanban_board)'),
                target_status: z
                    .string()
                    .describe('Target status name (e.g., "Done", "In Progress")'),
                owner: z
                    .string()
                    .optional()
                    .describe('Repository owner - LEAVE EMPTY to auto-detect'),
            }),
            outputSchema: MoveKanbanItemOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.number(),
                            item_id: z.string(),
                            target_status: z.string(),
                            owner: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwner(context, input.owner)
                    if ('error' in resolved) return resolved.response

                    const board = await resolved.github.getProjectKanban(
                        resolved.owner,
                        input.project_number,
                        resolved.repo
                    )
                    if (!board) {
                        return {
                            error: `Project #${String(input.project_number)} not found`,
                        }
                    }

                    const targetOption = board.statusOptions.find(
                        (opt) => opt.name.toLowerCase() === input.target_status.toLowerCase()
                    )

                    if (!targetOption) {
                        return {
                            error: `Status "${input.target_status}" not found in project`,
                            availableStatuses: board.statusOptions.map((opt) => opt.name),
                            hint: 'Use one of the available status names listed above.',
                        }
                    }

                    const result = await resolved.github.moveProjectItem(
                        board.projectId,
                        input.item_id,
                        board.statusFieldId,
                        targetOption.id
                    )

                    if (!result.success) {
                        return {
                            success: false,
                            error: result.error,
                            targetStatus: input.target_status,
                        }
                    }

                    return {
                        success: true,
                        itemId: input.item_id,
                        newStatus: input.target_status,
                        projectNumber: input.project_number,
                        message: `Item moved to "${input.target_status}"`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'create_github_issue_with_entry',
            title: 'Create GitHub Issue with Journal Entry',
            description:
                'Create a GitHub issue AND automatically create a linked journal entry documenting the issue creation.',
            group: 'github',
            inputSchema: z.object({
                title: z.string().min(1).describe('Issue title'),
                body: z.string().optional().describe('Issue body/description'),
                labels: z.array(z.string()).optional().describe('Labels to apply'),
                assignees: z.array(z.string()).optional().describe('Users to assign'),
                milestone_number: z
                    .number()
                    .optional()
                    .describe('Milestone number to assign this issue to'),
                project_number: z
                    .number()
                    .optional()
                    .describe('GitHub Project number to add this issue to'),
                initial_status: z
                    .string()
                    .optional()
                    .describe(
                        'Initial status column (e.g., "Backlog", "Ready"). Defaults to "Backlog" when adding to a project.'
                    ),
                owner: z
                    .string()
                    .optional()
                    .describe('Repository owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
                entry_content: z
                    .string()
                    .optional()
                    .describe('Custom journal content (defaults to auto-generated summary)'),
                tags: z.array(z.string()).optional().describe('Journal entry tags'),
            }),
            outputSchema: CreateGitHubIssueWithEntryOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            title: z.string().min(1),
                            body: z.string().optional(),
                            labels: z.array(z.string()).optional(),
                            assignees: z.array(z.string()).optional(),
                            milestone_number: z.number().optional(),
                            project_number: z.number().optional(),
                            initial_status: z.string().optional(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                            entry_content: z.string().optional(),
                            tags: z.array(z.string()).optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(context, input)
                    if ('error' in resolved) return resolved.response

                    const issue = await resolved.github.createIssue(
                        resolved.owner,
                        resolved.repo,
                        input.title,
                        input.body,
                        input.labels,
                        input.assignees,
                        input.milestone_number
                    )

                    if (!issue) {
                        return {
                            success: false,
                            error: 'Failed to create GitHub issue. Check GITHUB_TOKEN permissions.',
                        }
                    }

                    const projectNumber =
                        input.project_number ?? context.config?.defaultProjectNumber

                    let projectResult = undefined
                    if (projectNumber !== undefined && issue.nodeId) {
                        try {
                            const board = await resolved.github.getProjectKanban(
                                resolved.owner,
                                projectNumber,
                                resolved.repo
                            )
                            if (board) {
                                const added = await resolved.github.addProjectItem(
                                    board.projectId,
                                    issue.nodeId
                                )
                                if (added.success) {
                                    let statusResult:
                                        | { status: string; set: boolean; error?: string }
                                        | undefined = undefined
                                    const initialStatus = input.initial_status ?? 'Backlog'
                                    if (initialStatus && added.itemId) {
                                        const statusOption = board.statusOptions.find(
                                            (opt) =>
                                                opt.name.toLowerCase() ===
                                                initialStatus.toLowerCase()
                                        )
                                        if (statusOption) {
                                            const moveResult =
                                                await resolved.github.moveProjectItem(
                                                    board.projectId,
                                                    added.itemId,
                                                    board.statusFieldId,
                                                    statusOption.id
                                                )
                                            if (moveResult.success) {
                                                statusResult = {
                                                    status: statusOption.name,
                                                    set: true,
                                                }
                                            } else {
                                                statusResult = {
                                                    status: initialStatus,
                                                    set: false,
                                                    error: moveResult.error,
                                                }
                                            }
                                        } else {
                                            statusResult = {
                                                status: initialStatus,
                                                set: false,
                                                error: `Status "${initialStatus}" not found. Available: ${board.statusOptions.map((o) => o.name).join(', ')}`,
                                            }
                                        }
                                    }

                                    projectResult = {
                                        projectNumber: projectNumber,
                                        added: true,
                                        message:
                                            `Added to project #${projectNumber}` +
                                            (statusResult?.set ? ` (${statusResult.status})` : ''),
                                        initialStatus: statusResult,
                                    }
                                } else {
                                    projectResult = {
                                        projectNumber: projectNumber,
                                        added: false,
                                        error: added.error,
                                    }
                                }
                            } else {
                                projectResult = {
                                    projectNumber: projectNumber,
                                    added: false,
                                    error: `Project #${projectNumber} not found`,
                                }
                            }
                        } catch (error) {
                            projectResult = {
                                projectNumber: projectNumber,
                                added: false,
                                error: error instanceof Error ? error.message : String(error),
                            }
                        }
                    }

                    const entryContent =
                        input.entry_content ??
                        `Created GitHub issue #${String(issue.number)}: ${issue.title}\n\n` +
                            `URL: ${issue.url}\n` +
                            (projectNumber !== undefined ? `Project: #${projectNumber}\n` : '') +
                            (input.body
                                ? `\nDescription: ${input.body.slice(0, 200)}${input.body.length > 200 ? '...' : ''}`
                                : '')

                    const entry = db.createEntry({
                        content: entryContent,
                        entryType: 'planning' as EntryType,
                        tags: input.tags ?? ['github', 'issue-created'],
                        isPersonal: false,
                        significanceType: null,
                        issueNumber: issue.number,
                        issueUrl: issue.url,
                        projectNumber: projectNumber,
                    })

                    return {
                        success: true,
                        issue: {
                            number: issue.number,
                            title: issue.title,
                            url: issue.url,
                        },
                        project: projectResult,
                        journalEntry: {
                            id: entry.id,
                            linkedToIssue: issue.number,
                        },
                        message:
                            `Created issue #${String(issue.number)}` +
                            (projectResult?.added ? ` (added to Project #${projectNumber})` : '') +
                            ` and journal entry #${String(entry.id)}`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'close_github_issue_with_entry',
            title: 'Close GitHub Issue with Resolution Entry',
            description:
                'Close a GitHub issue AND create a journal entry documenting the resolution.',
            group: 'github',
            inputSchema: z.object({
                issue_number: z.number().describe('Issue number to close'),
                resolution_notes: z
                    .string()
                    .optional()
                    .describe('Notes about how the issue was resolved'),
                comment: z
                    .string()
                    .optional()
                    .describe('Comment to add to the issue before closing'),
                move_to_done: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Move the associated Kanban item to "Done" column'),
                project_number: z
                    .number()
                    .optional()
                    .describe(
                        'GitHub Project number (required if move_to_done is true, or uses DEFAULT_PROJECT_NUMBER)'
                    ),
                owner: z
                    .string()
                    .optional()
                    .describe('Repository owner - LEAVE EMPTY to auto-detect'),
                repo: z
                    .string()
                    .optional()
                    .describe('Repository name - LEAVE EMPTY to auto-detect'),
                tags: z.array(z.string()).optional().describe('Journal entry tags'),
            }),
            outputSchema: CloseGitHubIssueWithEntryOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            issue_number: z.number(),
                            resolution_notes: z.string().optional(),
                            comment: z.string().optional(),
                            move_to_done: z.boolean().optional().default(false),
                            project_number: z.number().optional(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                            tags: z.array(z.string()).optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(context, input)
                    if ('error' in resolved) return resolved.response

                    const issueDetails = await resolved.github.getIssue(
                        resolved.owner,
                        resolved.repo,
                        input.issue_number
                    )
                    if (!issueDetails) {
                        return {
                            success: false,
                            error: `Issue #${String(input.issue_number)} not found`,
                        }
                    }

                    if (issueDetails.state === 'CLOSED') {
                        return {
                            success: false,
                            error: `Issue #${String(input.issue_number)} is already closed`,
                        }
                    }

                    const result = await resolved.github.closeIssue(
                        resolved.owner,
                        resolved.repo,
                        input.issue_number,
                        input.comment
                    )

                    if (!result) {
                        return {
                            success: false,
                            error: 'Failed to close GitHub issue. Check GITHUB_TOKEN permissions.',
                        }
                    }

                    // Move Kanban item to "Done" if requested
                    let kanbanResult:
                        | { moved: boolean; error?: string; projectNumber?: number }
                        | undefined
                    if (input.move_to_done) {
                        const projectNum =
                            input.project_number ?? context.config?.defaultProjectNumber
                        if (projectNum === undefined) {
                            kanbanResult = {
                                moved: false,
                                error: 'project_number required when move_to_done is true',
                            }
                        } else {
                            try {
                                const board = await resolved.github.getProjectKanban(
                                    resolved.owner,
                                    projectNum,
                                    resolved.repo
                                )
                                if (!board) {
                                    kanbanResult = {
                                        moved: false,
                                        error: `Project #${projectNum} not found`,
                                        projectNumber: projectNum,
                                    }
                                } else {
                                    const item = board.columns
                                        .flatMap((c) => c.items)
                                        .find(
                                            (i) =>
                                                i.type === 'ISSUE' &&
                                                i.number === input.issue_number
                                        )
                                    if (!item) {
                                        kanbanResult = {
                                            moved: false,
                                            error: 'Issue not found on project board',
                                            projectNumber: projectNum,
                                        }
                                    } else {
                                        const doneOption = board.statusOptions.find(
                                            (opt) => opt.name.toLowerCase() === 'done'
                                        )
                                        if (!doneOption) {
                                            kanbanResult = {
                                                moved: false,
                                                error: '"Done" status column not found on board',
                                                projectNumber: projectNum,
                                            }
                                        } else {
                                            const moveResult =
                                                await resolved.github.moveProjectItem(
                                                    board.projectId,
                                                    item.id,
                                                    board.statusFieldId,
                                                    doneOption.id
                                                )
                                            kanbanResult = {
                                                moved: moveResult.success,
                                                error: moveResult.error,
                                                projectNumber: projectNum,
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                kanbanResult = {
                                    moved: false,
                                    error: err instanceof Error ? err.message : String(err),
                                    projectNumber:
                                        input.project_number ??
                                        context.config?.defaultProjectNumber,
                                }
                            }
                        }
                    }

                    const entryContent =
                        `Closed GitHub issue #${String(input.issue_number)}: ${issueDetails.title}\n\n` +
                        `URL: ${issueDetails.url}\n` +
                        (input.resolution_notes ? `\nResolution: ${input.resolution_notes}` : '')

                    const entry = db.createEntry({
                        content: entryContent,
                        entryType: 'bug_fix' as EntryType,
                        tags: input.tags ?? ['github', 'issue-closed', 'resolution'],
                        isPersonal: false,
                        significanceType: 'blocker_resolved' as SignificanceType,
                        issueNumber: input.issue_number,
                        issueUrl: issueDetails.url,
                    })

                    return {
                        success: true,
                        issue: {
                            number: input.issue_number,
                            title: issueDetails.title,
                            url: result.url,
                            previousState: 'OPEN',
                            newState: 'CLOSED',
                        },
                        journalEntry: {
                            id: entry.id,
                            linkedToIssue: input.issue_number,
                            significanceType: 'blocker_resolved',
                        },
                        kanban: kanbanResult,
                        message:
                            `Closed issue #${String(input.issue_number)} and created resolution entry #${String(entry.id)}` +
                            (kanbanResult?.moved ? ' and moved to Done' : ''),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
