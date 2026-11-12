/**
 * GitHub Create Issue Tool - create_github_issue_with_entry
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveProjectContext,
} from '../../../utils/workspace-resolver.js'
import { CreateGitHubIssueWithEntryOutputSchema } from './schemas.js'
import { resolveOwnerRepo, resolveProjectNumber } from './helpers.js'
import { addIssueToProject, type IssueProjectResult } from './create-issue-project.js'

function concreteCallerWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

const CreateIssueHandlerInputSchema = z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    milestone_number: z.number().optional(),
    project_number: z.number().optional(),
    workspace_id: z.string().optional(),
    initial_status: z.string().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    entry_content: z.string().optional(),
    tags: z.array(z.string()).optional(),
})

export function getCreateGitHubIssueTool(context: ToolContext): ToolDefinition {
    const { db } = context
    return {
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
            tags: z.array(z.string()).optional().describe('Journal entry tags'),
        }),
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

                const resolved = await resolveOwnerRepo(context, input)
                if ('error' in resolved) return resolved.response

                const entryProjectNumber = resolveProjectNumber(
                    context,
                    resolved.repo,
                    input.project_number
                )
                const callerWorkspace = concreteCallerWorkspace(input.workspace_id)
                const pairCallerWorkspace =
                    callerWorkspace !== undefined && input.project_number === undefined

                const registry =
                    context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
                const canonicalRepo = resolved.repo
                    ? (findCanonicalRegistryKey(resolved.repo, registry) ?? resolved.repo)
                    : undefined
                const resolvedCtx = resolveProjectContext(
                    {
                        workspace_id: callerWorkspace ?? canonicalRepo,
                        ...(pairCallerWorkspace || entryProjectNumber === undefined
                            ? {}
                            : { project_number: entryProjectNumber }),
                        content: input.entry_content,
                        tags: input.tags,
                    },
                    context.config
                )
                const workspaceId =
                    resolvedCtx.workspaceId === 'default' && canonicalRepo && callerWorkspace === undefined
                        ? canonicalRepo
                        : resolvedCtx.workspaceId
                const projectNumber = pairCallerWorkspace
                    ? resolvedCtx.projectNumber
                    : (resolvedCtx.projectNumber ?? entryProjectNumber)

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
                    workspaceId,
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
                    db.updateEntry(entry.id, {
                        content:
                            entryContent +
                            '\n\n[FAILED] GitHub mutation failed: Could not create issue. Check GITHUB_TOKEN permissions.',
                        workspaceId,
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
                let projectResult: IssueProjectResult | undefined = undefined
                if (projectNumber !== undefined && issue.nodeId) {
                    projectResult = await addIssueToProject(
                        resolved.github,
                        resolved.owner,
                        resolved.repo,
                        issue.nodeId,
                        projectNumber,
                        input.initial_status
                    )
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
                    workspaceId,
                })

                const projectWarning =
                    projectResult !== undefined && !projectResult.added
                        ? (projectResult.error ??
                          'Issue was created but it was not added to the project.')
                        : undefined
                return {
                    success: projectWarning === undefined,
                    ...(projectWarning !== undefined ? { warning: projectWarning } : {}),
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
    }
}
