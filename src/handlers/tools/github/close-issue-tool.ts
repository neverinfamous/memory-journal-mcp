/**
 * GitHub Close Issue Tool - close_github_issue_with_entry
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { fenceUntrustedInline } from '../../resources/shared.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { CloseGitHubIssueWithEntryOutputSchema } from './schemas.js'
import { resolveOwnerRepo, resolveProjectNumber } from './helpers.js'
import { moveIssueToDone, type KanbanMoveResult } from './close-issue-kanban.js'
import { resolveIssueEntryScope } from './create-issue-tool.js'

const CloseIssueHandlerInputSchema = z
    .object({
        issue_number: z.number().int().positive(),
        resolution_notes: z.string().optional(),
        comment: z.string().optional(),
        move_to_done: z.boolean().optional().default(false),
        project_number: StrictProjectNumberSchema,
        workspace_id: z.string().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        tags: z.array(z.string()).optional(),
    })
    .strict()

type CloseIssueInput = z.infer<typeof CloseIssueHandlerInputSchema>

async function resolveKanbanMoveIfRequested(
    context: ToolContext,
    input: CloseIssueInput,
    resolved: {
        owner: string
        repo: string
        detectedOwner?: string | null
        github: ToolContext['github']
    },
    issueNodeId: string | undefined,
    resolvedProjectNumber?: number
): Promise<KanbanMoveResult | undefined> {
    if (!input.move_to_done) return undefined
    if (!resolved.github || issueNodeId === undefined) {
        return { moved: false, error: 'Kanban move did not run.' }
    }
    const projectNum =
        resolvedProjectNumber ??
        resolveProjectNumber(
            context,
            resolved.repo,
            input.project_number,
            resolved.owner,
            resolved.detectedOwner
        )
    if (projectNum === undefined) {
        return {
            moved: false,
            error: 'project_number required when move_to_done is true',
        }
    }
    return moveIssueToDone(
        resolved.github,
        resolved.owner,
        resolved.repo,
        issueNodeId,
        projectNum
    )
}

async function executeCloseIssueMutation(
    context: ToolContext,
    input: CloseIssueInput,
    resolved: {
        owner: string
        repo: string
        detectedOwner?: string | null
        github: NonNullable<ToolContext['github']>
    },
    issueDetails: { title: string; url: string; nodeId?: string }
): Promise<Record<string, unknown>> {
    const { db } = context
    const safeIssueTitle = issueDetails.title.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')
    const entryContent =
        `[PENDING] Closing GitHub issue #${String(input.issue_number)}: ${safeIssueTitle}\n` +
        (input.resolution_notes ? `\nResolution: ${input.resolution_notes}` : '')

    const entryScope = resolveIssueEntryScope(
        context,
        resolved.repo,
        input.workspace_id,
        input.project_number,
        'close issues and write journal entries',
        resolved.owner,
        resolved.detectedOwner
    )
    if ('errorResponse' in entryScope) return entryScope.errorResponse
    const { workspaceId, projectNumber } = entryScope
    const entry = db.createEntry({
        content: entryContent,
        entryType: 'bug_fix',
        tags: input.tags ?? ['github', 'issue-closed', 'resolution', 'pending'],
        isPersonal: false,
        significanceType: 'blocker_resolved',
        issueNumber: input.issue_number,
        projectNumber,
        projectOwner: resolved.owner,
        workspaceId,
    })

    let result: Awaited<ReturnType<typeof resolved.github.closeIssue>>
    try {
        result = await resolved.github.closeIssue(
            resolved.owner,
            resolved.repo,
            input.issue_number,
            input.comment
        )
    } catch (err) {
        db.deleteEntry(entry.id, false, workspaceId)
        throw err
    }
    if (!result) {
        db.updateEntry(entry.id, {
            content:
                entryContent +
                '\n\n[FAILED] GitHub mutation failed: Could not close issue. Check GITHUB_TOKEN permissions.',
            workspaceId,
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

    const kanbanResult = await resolveKanbanMoveIfRequested(
        context,
        input,
        resolved,
        issueDetails.nodeId,
        projectNumber
    )
    const finalContent =
        `Closed GitHub issue #${String(input.issue_number)}: ${safeIssueTitle}\n\n` +
        `URL: ${issueDetails.url}\n` +
        (input.resolution_notes ? `\nResolution: ${input.resolution_notes}` : '')

    db.updateEntry(entry.id, {
        content: finalContent,
        issueUrl: issueDetails.url,
        tags: input.tags ?? ['github', 'issue-closed', 'resolution'],
        workspaceId,
    })

    const indexStatus = await autoIndexEntry(context.vectorManager, db, entry.id, workspaceId)
    const vectorWarning =
        indexStatus === 'failed' ? 'Journal entry saved, but vector indexing failed.' : undefined

    const kanbanFailed = input.move_to_done && kanbanResult?.moved !== true
    const closedIssue = {
        number: input.issue_number,
        title: fenceUntrustedInline(issueDetails.title),
        url: result.url,
        previousState: 'OPEN' as const,
        newState: 'CLOSED' as const,
    }
    const journalEntry = {
        id: entry.id,
        linkedToIssue: input.issue_number,
        significanceType: 'blocker_resolved' as const,
    }
    if (kanbanFailed) {
        const kanbanMsg = kanbanResult?.error ?? 'Kanban move did not run.'
        return {
            success: false,
            warning: vectorWarning !== undefined ? `${kanbanMsg}; ${vectorWarning}` : kanbanMsg,
            issue: closedIssue,
            journalEntry,
            kanban: kanbanResult,
            message: `Closed issue #${String(input.issue_number)} and created resolution entry #${String(entry.id)}, but the Kanban move did not run.`,
        }
    }
    return {
        success: true,
        ...(vectorWarning !== undefined ? { warning: vectorWarning } : {}),
        issue: closedIssue,
        journalEntry,
        kanban: kanbanResult,
        message:
            `Closed issue #${String(input.issue_number)} and created resolution entry #${String(entry.id)}` +
            (kanbanResult?.moved === true ? ' and moved to Done' : ''),
    }
}

export function getCloseGitHubIssueTool(context: ToolContext): ToolDefinition {
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
            workspace_id: z
                .string()
                .optional()
                .describe('Workspace identifier (defaults to current project)'),
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
                const input = CloseIssueHandlerInputSchema.parse(params)

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

                return await executeCloseIssueMutation(context, input, resolved, issueDetails)
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}
