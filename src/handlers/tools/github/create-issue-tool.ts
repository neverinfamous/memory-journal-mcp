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

type Registry = ReturnType<typeof loadProjectRegistryFromConfig>

/**
 * Detect `(repo, workspace_id, project_number)` combinations that point at different registered projects.
 */
export function detectScopeMismatch(
    registry: Registry,
    canonicalRepo: string | undefined,
    callerWorkspace: string | undefined,
    projectNumber: number | undefined
): string | undefined {
    if (registry === undefined || registry === null) return undefined
    const wsKey =
        callerWorkspace !== undefined && callerWorkspace.toLowerCase() !== 'default'
            ? findCanonicalRegistryKey(callerWorkspace, registry)
            : undefined
    const repoKey =
        canonicalRepo !== undefined && Object.prototype.hasOwnProperty.call(registry, canonicalRepo)
            ? canonicalRepo
            : undefined
    if (wsKey !== undefined && repoKey !== undefined && wsKey !== repoKey) {
        return `workspace_id "${callerWorkspace ?? ''}" does not match repository "${canonicalRepo ?? ''}".`
    }
    const ownerKey = wsKey ?? repoKey
    const registered = ownerKey !== undefined ? registry[ownerKey]?.project_number : undefined
    if (
        projectNumber !== undefined &&
        registered !== undefined &&
        registered !== null &&
        registered !== projectNumber
    ) {
        return `project_number ${String(projectNumber)} does not belong to workspace "${ownerKey ?? ''}" (registered project ${String(registered)}).`
    }
    return undefined
}

export function scopeMismatchResponse(error: string): Record<string, unknown> {
    return {
        success: false,
        error,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Provide a consistent repo, workspace_id, and project_number for a single registered project.',
        recoverable: true,
    }
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
                if (input.workspace_id?.trim() === '*') {
                    return scopeMismatchResponse(
                        "workspace_id '*' is a read-only wildcard and cannot be used to create issues and journal entries."
                    )
                }

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
                const mismatch = detectScopeMismatch(registry, canonicalRepo, callerWorkspace, input.project_number)
                if (mismatch !== undefined) return scopeMismatchResponse(mismatch)
                // [INVARIANT] Entry scope derives from repo/workspace/project only, never from content/tag keywords.
                const resolvedCtx = resolveProjectContext(
                    {
                        workspace_id: callerWorkspace ?? canonicalRepo,
                        ...(pairCallerWorkspace || entryProjectNumber === undefined
                            ? {}
                            : { project_number: entryProjectNumber }),
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
                const statusError =
                    input.initial_status !== undefined && projectResult?.initialStatus?.set !== true
                        ? (projectResult?.initialStatus?.error ??
                          `Initial status "${input.initial_status}" could not be applied.`)
                        : undefined
                const projectItemError = projectWarning ?? statusError
                return {
                    success: projectItemError === undefined,
                    ...(projectItemError !== undefined
                        ? { warning: projectItemError, projectItemError }
                        : {}),
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
