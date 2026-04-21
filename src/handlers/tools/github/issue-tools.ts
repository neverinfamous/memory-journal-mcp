/**
 * GitHub Issue Tools - 2 tools
 *
 * Tools: create_github_issue_with_entry, close_github_issue_with_entry
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ValidationError } from '../../../types/errors.js'
import {
    CreateGitHubIssueWithEntryOutputSchema,
    CloseGitHubIssueWithEntryOutputSchema,
} from './schemas.js'
import { resolveOwnerRepo, resolveProjectNumber } from './helpers.js'

export function getGitHubIssueTools(context: ToolContext): ToolDefinition[] {
    const { db } = context
    return [
        {
            name: 'create_github_issue_with_entry',
            title: 'Create GitHub Issue with Journal Entry',
            description:
                'Create a GitHub issue AND automatically create a linked journal entry documenting the issue creation.',
            group: 'github',
            inputSchema: z.object({
                title: z.string().optional().describe('Issue title'),
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

                    const projectNumber = resolveProjectNumber(
                        context,
                        resolved.repo,
                        input.project_number
                    )

                    // 1. OUTBOX PATTERN: Create journal entry in pending state FIRST
                    const entryContent =
                        input.entry_content ??
                        `[PENDING] Creating GitHub issue: ${input.title}\n` +
                            (projectNumber !== undefined ? `Project: #${projectNumber}\n` : '') +
                            (input.body
                                ? `\nDescription: ${input.body.slice(0, 200)}${input.body.length > 200 ? '...' : ''}`
                                : '')

                    const entry = db.createEntry({
                        content: entryContent,
                        entryType: 'planning',
                        tags: input.tags ?? ['github', 'issue-created', 'pending'],
                        isPersonal: false,
                        significanceType: null,
                        projectNumber: projectNumber,
                        projectOwner: resolved.owner,
                    })

                    // 2. Perform external mutation
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
                        // Decouple journaling: mark entry as failed instead of rollback
                        db.updateEntry(entry.id, {
                            content:
                                entryContent +
                                '\n\n[FAILED] GitHub mutation failed: Could not create issue. Check GITHUB_TOKEN permissions.',
                        })
                        return {
                            success: false,
                            error: 'Failed to create GitHub issue. Check GITHUB_TOKEN permissions.',
                            code: 'API_ERROR',
                            category: 'api',
                            suggestion: 'Verify GitHub token has write access to issues.',
                            recoverable: true,
                        }
                    }

                    // 3. Optional Kanban mutation
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

                    // 4. Update journal entry with finalized state
                    const finalContent =
                        input.entry_content ??
                        `Created GitHub issue #${String(issue.number)}: ${issue.title}\n\n` +
                            `URL: ${issue.url}\n` +
                            (projectNumber !== undefined ? `Project: #${projectNumber}\n` : '') +
                            (input.body
                                ? `\nDescription: ${input.body.slice(0, 200)}${input.body.length > 200 ? '...' : ''}`
                                : '')

                    db.updateEntry(entry.id, {
                        content: finalContent,
                        issueNumber: issue.number,
                        issueUrl: issue.url,
                        tags: input.tags ?? ['github', 'issue-created'],
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
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the issue number exists in this repository.',
                            recoverable: true,
                        }
                    }

                    if (issueDetails.state === 'CLOSED') {
                        return {
                            ...formatHandlerError(
                                new ValidationError(
                                    `Issue #${String(input.issue_number)} is already closed`
                                )
                            ),
                            success: false,
                        }
                    }

                    // 1. OUTBOX PATTERN: Create journal entry in pending state FIRST
                    const entryContent =
                        `[PENDING] Closing GitHub issue #${String(input.issue_number)}: ${issueDetails.title}\n` +
                        (input.resolution_notes ? `\nResolution: ${input.resolution_notes}` : '')

                    const entry = db.createEntry({
                        content: entryContent,
                        entryType: 'bug_fix',
                        tags: input.tags ?? ['github', 'issue-closed', 'resolution', 'pending'],
                        isPersonal: false,
                        significanceType: 'blocker_resolved',
                        issueNumber: input.issue_number,
                        projectOwner: resolved.owner,
                    })

                    // 2. Perform external mutation
                    const result = await resolved.github.closeIssue(
                        resolved.owner,
                        resolved.repo,
                        input.issue_number,
                        input.comment
                    )

                    if (!result) {
                        // Decouple journaling: mark entry as failed instead of rollback
                        db.updateEntry(entry.id, {
                            content:
                                entryContent +
                                '\n\n[FAILED] GitHub mutation failed: Could not close issue. Check GITHUB_TOKEN permissions.',
                        })
                        return {
                            success: false,
                            error: 'Failed to close GitHub issue. Check GITHUB_TOKEN permissions.',
                            code: 'API_ERROR',
                            category: 'api',
                            suggestion: 'Verify GitHub token has write access to issues.',
                            recoverable: true,
                        }
                    }

                    // 3. Optional Kanban mutation
                    let kanbanResult:
                        | { moved: boolean; error?: string; projectNumber?: number }
                        | undefined
                    if (input.move_to_done) {
                        const projectNum = resolveProjectNumber(
                            context,
                            resolved.repo,
                            input.project_number
                        )
                        if (projectNum === undefined) {
                            kanbanResult = {
                                moved: false,
                                error: 'project_number required when move_to_done is true',
                            }
                        } else {
                            try {
                                // Get board metadata (projectId, statusFieldId, Done option)
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
                                        // Use addProjectItem (idempotent) to get the item ID directly.
                                        // This bypasses the board-scan race condition — addProjectItem
                                        // returns the existing itemId if already added, or adds and returns it.
                                        const addResult = await resolved.github.addProjectItem(
                                            board.projectId,
                                            issueDetails.nodeId
                                        )
                                        if (!addResult.success || !addResult.itemId) {
                                            kanbanResult = {
                                                moved: false,
                                                error:
                                                    addResult.error ??
                                                    'Failed to resolve project item ID',
                                                projectNumber: projectNum,
                                            }
                                        } else {
                                            const moveResult =
                                                await resolved.github.moveProjectItem(
                                                    board.projectId,
                                                    addResult.itemId,
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
                                    projectNumber: resolveProjectNumber(
                                        context,
                                        resolved.repo,
                                        input.project_number
                                    ),
                                }
                            }
                        }
                    }

                    // 4. Update journal entry with finalized state
                    const finalContent =
                        `Closed GitHub issue #${String(input.issue_number)}: ${issueDetails.title}\n\n` +
                        `URL: ${issueDetails.url}\n` +
                        (input.resolution_notes ? `\nResolution: ${input.resolution_notes}` : '')

                    db.updateEntry(entry.id, {
                        content: finalContent,
                        issueUrl: issueDetails.url,
                        tags: input.tags ?? ['github', 'issue-closed', 'resolution'],
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
