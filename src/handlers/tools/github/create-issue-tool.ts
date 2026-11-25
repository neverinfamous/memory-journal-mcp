/**
 * GitHub Create Issue Tool - create_github_issue_with_entry
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { isRecord } from '../../../utils/type-guards.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { fenceUntrustedInline } from '../../resources/shared.js'
import { coerceIntString, MAX_CONTENT_LENGTH, relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { CreateGitHubIssueWithEntryOutputSchema } from './schemas.js'
import { resolveOwnerRepo } from './helpers.js'
import { addIssueToProject, type IssueProjectResult } from './create-issue-project.js'
import {
    detectScopeMismatch,
    resolveIssueEntryScope,
    scopeMismatchResponse,
} from './issue-entry-scope.js'

export { detectScopeMismatch, resolveIssueEntryScope, scopeMismatchResponse }

const CreateIssueHandlerInputSchema = z.preprocess(
    (val: unknown) => {
        if (!isRecord(val)) return val
        const obj: Record<string, unknown> = { ...val }
        if ('journal_content' in obj) {
            const canonical = obj['entry_content']
            const alias = obj['journal_content']
            if (canonical === undefined && alias !== undefined) {
                obj['entry_content'] = alias
                Reflect.deleteProperty(obj, 'journal_content')
            } else if (alias === undefined || canonical === alias) {
                Reflect.deleteProperty(obj, 'journal_content')
            }
        }
        return obj
    },
    z
        .object({
            title: z.string().min(1).max(500),
            body: z.string().max(MAX_CONTENT_LENGTH).optional(),
            labels: z.array(z.string().max(100)).max(50).optional(),
            assignees: z.array(z.string().max(100)).max(50).optional(),
            milestone_number: z.preprocess(coerceIntString, z.number().int().positive()).optional(),
            project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema),
            workspace_id: z.string().max(255).optional(),
            initial_status: z.string().max(255).optional(),
            owner: z.string().max(255).optional(),
            repo: z.string().max(255).optional(),
            entry_content: z.string().max(MAX_CONTENT_LENGTH).optional(),
            tags: z.array(z.string().max(100)).max(50).optional(),
        })
        .strict()
)

type CreateIssueInput = z.infer<typeof CreateIssueHandlerInputSchema>

type CreatedGitHubIssue = NonNullable<
    Awaited<ReturnType<NonNullable<ToolContext['github']>['createIssue']>>
>

async function dispatchCreateIssueOnGitHub(
    db: ToolContext['db'],
    input: CreateIssueInput,
    resolved: {
        owner: string
        repo: string
        github: NonNullable<ToolContext['github']>
    },
    entryId: number,
    entryContent: string,
    workspaceId: string
): Promise<{ issue: CreatedGitHubIssue } | { errorResponse: Record<string, unknown> }> {
    let issue: Awaited<ReturnType<typeof resolved.github.createIssue>>
    try {
        issue = await resolved.github.createIssue(
            resolved.owner,
            resolved.repo,
            input.title,
            input.body,
            input.labels,
            input.assignees,
            input.milestone_number
        )
    } catch (err) {
        db.deleteEntry(entryId, false, workspaceId)
        throw err
    }

    if (!issue) {
        db.updateEntry(entryId, {
            content:
                entryContent +
                '\n\n[FAILED] GitHub mutation failed: Could not create issue. Check GITHUB_TOKEN permissions.',
            workspaceId,
        })
        return {
            errorResponse: {
                success: false,
                error: 'Failed to create GitHub issue. Check GITHUB_TOKEN permissions.',
                code: 'API_ERROR',
                category: 'api',
                suggestion: 'Verify GitHub token has write access to issues.',
                recoverable: true,
            },
        }
    }
    return { issue }
}

async function executeCreateIssueOutbox(
    context: ToolContext,
    input: CreateIssueInput,
    resolved: {
        owner: string
        repo: string
        github: NonNullable<ToolContext['github']>
    },
    workspaceId: string,
    projectNumber: number | undefined
): Promise<
    | { errorResponse: Record<string, unknown> }
    | {
          entryId: number
          issue: CreatedGitHubIssue
          projectResult: IssueProjectResult | undefined
      }
> {
    const { db } = context
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
        projectNumber,
        projectOwner: resolved.owner,
        workspaceId,
    })

    const issueRes = await dispatchCreateIssueOnGitHub(
        db,
        input,
        resolved,
        entry.id,
        entryContent,
        workspaceId
    )
    if ('errorResponse' in issueRes) return issueRes

    let projectResult: IssueProjectResult | undefined = undefined
    if (projectNumber !== undefined && issueRes.issue.nodeId) {
        projectResult = await addIssueToProject(
            resolved.github,
            resolved.owner,
            resolved.repo,
            issueRes.issue.nodeId,
            projectNumber,
            input.initial_status
        )
    } else if (projectNumber !== undefined) {
        projectResult = { projectNumber, added: false, error: 'Issue nodeId unavailable' }
    }

    return { entryId: entry.id, issue: issueRes.issue, projectResult }
}

async function finalizeIssueJournalEntry(
    context: ToolContext,
    input: CreateIssueInput,
    entryId: number,
    issue: { number: number; title: string; url: string },
    workspaceId: string,
    projectNumber: number | undefined,
    projectResult: IssueProjectResult | undefined
): Promise<Record<string, unknown>> {
    const { db } = context
    const finalContent =
        input.entry_content ??
        `Created GitHub issue #${String(issue.number)}: ${issue.title}\n\n` +
            `URL: ${issue.url}\n` +
            (projectNumber !== undefined ? `Project: #${projectNumber}\n` : '') +
            (input.body
                ? `\nDescription: ${input.body.slice(0, 200)}${input.body.length > 200 ? '...' : ''}`
                : '')

    const updatedEntry = db.updateEntry(entryId, {
        content: finalContent,
        issueNumber: issue.number,
        issueUrl: issue.url,
        tags: input.tags ?? ['github', 'issue-created'],
        workspaceId,
    })

    const indexStatus = await autoIndexEntry(
        context.vectorManager,
        db,
        updatedEntry ?? entryId,
        workspaceId
    )
    const vectorWarning =
        indexStatus === 'failed'
            ? 'Journal entry saved, but vector indexing failed.'
            : undefined
    const projectWarning =
        projectResult !== undefined && !projectResult.added
            ? (projectResult.error ?? 'Issue was created but it was not added to the project.')
            : undefined
    const statusError =
        input.initial_status !== undefined && projectResult?.initialStatus?.set !== true
            ? (projectResult?.initialStatus?.error ??
              `Initial status "${input.initial_status}" could not be applied.`)
            : undefined
    const projectItemError = projectWarning ?? statusError
    const combinedWarning =
        projectItemError !== undefined && vectorWarning !== undefined
            ? `${projectItemError}; ${vectorWarning}`
            : (projectItemError ?? vectorWarning)

    return {
        success: projectItemError === undefined,
        ...(combinedWarning !== undefined ? { warning: combinedWarning } : {}),
        ...(projectItemError !== undefined ? { projectItemError } : {}),
        issue: {
            number: issue.number,
            title: fenceUntrustedInline(issue.title),
            url: issue.url,
        },
        project: projectResult,
        journalEntry: { id: entryId, linkedToIssue: issue.number },
        message:
            `Created issue #${String(issue.number)}` +
            (projectResult?.added ? ` (added to Project #${projectNumber})` : '') +
            ` and journal entry #${String(entryId)}`,
    }
}

const CreateGitHubIssueSchemaMcp = z.object({
    title: z.string().min(1).describe('Issue title'),
    body: z.string().optional().describe('Issue body/description'),
    labels: z.array(z.string()).optional().describe('Labels to apply'),
    assignees: z.array(z.string()).optional().describe('Users to assign'),
    milestone_number: relaxedNumber()
        .optional()
        .describe('Milestone number to assign this issue to'),
    project_number: relaxedNumber()
        .optional()
        .describe('GitHub Project number to add this issue to'),
    workspace_id: z
        .string()
        .optional()
        .describe('Workspace identifier (defaults to current project)'),
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
    journal_content: z
        .string()
        .optional()
        .describe('Alias for entry_content (custom journal content)'),
    tags: z.array(z.string()).optional().describe('Journal entry tags'),
})

export function getCreateGitHubIssueTool(context: ToolContext): ToolDefinition {
    return {
        name: 'create_github_issue_with_entry',
        title: 'Create GitHub Issue with Journal Entry',
        description:
            'Create a GitHub issue AND automatically create a linked journal entry documenting the issue creation.',
        group: 'github',
        inputSchema: CreateGitHubIssueSchemaMcp,
        outputSchema: CreateGitHubIssueWithEntryOutputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        handler: async (params: unknown) => {
            try {
                const input = CreateIssueHandlerInputSchema.parse(params)
                if (input.workspace_id?.trim() === '*') {
                    return scopeMismatchResponse(
                        "workspace_id '*' is a read-only wildcard and cannot be used to create issues and journal entries."
                    )
                }

                const resolved = await resolveOwnerRepo(context, input)
                if ('error' in resolved) return resolved.response

                const entryScope = resolveIssueEntryScope(
                    context,
                    resolved.repo,
                    input.workspace_id,
                    input.project_number,
                    'create issues and journal entries',
                    resolved.owner,
                    resolved.detectedOwner
                )
                if ('errorResponse' in entryScope) return entryScope.errorResponse
                const { workspaceId, projectNumber } = entryScope

                const outbox = await executeCreateIssueOutbox(
                    context,
                    input,
                    resolved,
                    workspaceId,
                    projectNumber
                )
                if ('errorResponse' in outbox) return outbox.errorResponse

                return await finalizeIssueJournalEntry(
                    context,
                    input,
                    outbox.entryId,
                    outbox.issue,
                    workspaceId,
                    projectNumber,
                    outbox.projectResult
                )
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}
