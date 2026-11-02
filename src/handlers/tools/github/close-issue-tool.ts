/**
 * GitHub Close Issue Tool - close_github_issue_with_entry
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ValidationError } from '../../../types/errors.js'
import { relaxedNumber } from '../schemas.js'
import { CloseGitHubIssueWithEntryOutputSchema } from './schemas.js'
import { resolveOwnerRepo, resolveProjectNumber } from './helpers.js'

export function getCloseGitHubIssueTool(context: ToolContext): ToolDefinition {
    const { db } = context
    return {
        name: 'close_github_issue_with_entry',
        title: 'Close GitHub Issue with Resolution Entry',
        description:
            'Close a GitHub issue AND create a journal entry documenting the resolution.',
        group: 'github',
        inputSchema: z.object({
            issue_number: relaxedNumber().optional().describe('Issue number to close'),
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
            project_number: relaxedNumber()
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
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
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
                const safeIssueTitle = issueDetails.title.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')
                const entryContent =
                    `[PENDING] Closing GitHub issue #${String(input.issue_number)}: ${safeIssueTitle}\n` +
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
                    `Closed GitHub issue #${String(input.issue_number)}: ${safeIssueTitle}\n\n` +
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
    }
}
