import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { resolveProjectContext, resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { coerceSignificanceAlias } from '../schemas.js'
import {
    UpdateEntrySchema,
    UpdateEntrySchemaMcp,
    UpdateEntryOutputSchema,
    DeleteEntrySchema,
    DeleteEntrySchemaMcp,
    DeleteEntryOutputSchema,
} from './schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { relaxedNumber } from '../schemas.js'

/**
 * [INVARIANT] When a caller supplies project_number, the target entry must belong to that
 * project regardless of workspace_id (H4). Missing entries are treated as mismatches.
 */
export function projectOwnershipMismatch(
    projectNumber: number | undefined,
    entryProject: number | null | undefined
): boolean {
    return projectNumber !== undefined && entryProject !== projectNumber
}

/** [INVARIANT] target_workspace_id must be a concrete, canonical workspace (never '*'). */
export function canonicalTargetWorkspace(
    target: string | undefined,
    config: ToolContext['config']
): string | undefined {
    if (target === undefined) return undefined
    if (target.trim() === '') {
        throw new ValidationError(
            "target_workspace_id cannot be blank. Omit it to keep the entry's current workspace."
        )
    }
    return resolveWriteWorkspaceId(target, undefined, config)
}

export function getCoreTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager } = context;
    return [
        {
            name: 'update_entry',
            title: 'Update Entry',
            description:
                'Update an existing journal entry. When updating content, preserve the ' +
                'existing markdown structure (## section headers). Do NOT restructure or ' +
                'add new top-level sections unless explicitly requested. ' +
                'Pass null to clear a metadata field. Supports content, type, tags, and ' +
                '11 metadata fields including significance, project, issue, PR, and workflow.',
            group: 'admin',
            inputSchema: UpdateEntrySchemaMcp,
            outputSchema: UpdateEntryOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    coerceSignificanceAlias(params)

                    const input = UpdateEntrySchema.parse(params)
                    const targetWorkspaceId = canonicalTargetWorkspace(
                        input.target_workspace_id,
                        context.config
                    )
                    let wsId: string
                    let projectNumberForUpdate: number | null | undefined
                    if (targetWorkspaceId !== undefined) {
                        const targetResolved = resolveProjectContext(
                            {
                                workspace_id: targetWorkspaceId,
                                ...(input.project_number !== undefined
                                    ? { project_number: input.project_number }
                                    : {}),
                            },
                            context.config
                        )
                        projectNumberForUpdate = targetResolved.projectNumber ?? null
                        if (input.workspace_id === '*') {
                            wsId = '*'
                        } else if (input.workspace_id !== undefined) {
                            wsId = resolveWriteWorkspaceId(
                                input.workspace_id,
                                undefined,
                                context.config
                            )
                        } else {
                            const existingByPk = db.getEntryById(input.entry_id, '*')
                            wsId =
                                existingByPk?.workspaceId ??
                                resolveWriteWorkspaceId(undefined, undefined, context.config)
                        }
                    } else {
                        const resolved = resolveProjectContext(
                            {
                                workspace_id: input.workspace_id,
                                project_number: input.project_number,
                            },
                            context.config
                        )
                        projectNumberForUpdate =
                            input.project_number === undefined
                                ? undefined
                                : resolved.projectNumber
                        wsId = input.workspace_id === '*' ? '*' : resolved.workspaceId
                        if (input.workspace_id === undefined && input.project_number === undefined) {
                            const existingByPk = db.getEntryById(input.entry_id, '*')
                            if (existingByPk?.workspaceId !== undefined) {
                                wsId = existingByPk.workspaceId
                            }
                        }
                        if (input.project_number !== undefined && input.workspace_id !== undefined) {
                            const scoped = db.getEntryById(input.entry_id, '*')
                            if (projectOwnershipMismatch(input.project_number, scoped?.projectNumber)) {
                                return {
                                    success: false,
                                    error: `Entry ${String(input.entry_id)} not found`,
                                    code: 'RESOURCE_NOT_FOUND',
                                    category: 'resource',
                                    suggestion: 'Verify the entry ID and project number, and try again',
                                    recoverable: true,
                                }
                            }
                        }
                    }
                    const entry = db.updateEntry(input.entry_id, {
                        content: input.content,
                        entryType: input.entry_type,
                        isPersonal: input.is_personal,
                        tags: input.tags,
                        significanceType: input.significance_type,
                        projectNumber: projectNumberForUpdate,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: input.issue_url,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status,
                        isArchived: input.is_archived,
                        expectedVersion: input.expected_version,
                        autoContext: input.auto_context,
                        workspaceId: wsId,
                        targetWorkspaceId,
                        impactScore: input.impact_score,
                        trustScore: input.trust_score,
                        validationStatus: input.validation_status,
                        sessionId: input.session_id,
                    })
                    if (!entry) {
                        return {
                            success: false,
                            error: `Entry ${String(input.entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and try again',
                            recoverable: true,
                        }
                    }

                    // Re-index if content changed
                    let indexStatus: string | undefined
                    if (input.content) {
                        indexStatus = await autoIndexEntry(vectorManager, db, entry.id, entry.workspaceId ?? wsId)
                    }

                    return { success: true, entry, ...(indexStatus ? { indexStatus } : {}) }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'delete_entry',
            title: 'Delete Entry',
            description:
                'Delete a journal entry (soft delete with timestamp). Calling with permanent: true on a previously soft-deleted entry works. Returns success: false for nonexistent entries.',
            group: 'admin',
            inputSchema: DeleteEntrySchemaMcp,
            outputSchema: DeleteEntryOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { entry_id, permanent, expected_version, workspace_id, project_number } = DeleteEntrySchema.parse(params)
                    let wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    if (
                        workspace_id === undefined &&
                        project_number === undefined
                    ) {
                        const existingByPk = db.getEntryByIdIncludeDeleted(entry_id, '*')
                        if (existingByPk?.workspaceId !== undefined) {
                            wsId = existingByPk.workspaceId
                        }
                    }

                    if (expected_version !== undefined) {
                        const existing = db.getEntryByIdIncludeDeleted(entry_id, wsId);
                        if (existing && existing.version !== expected_version) {
                            return {
                                success: false,
                                error: `Concurrency conflict: Expected version ${expected_version} but found ${existing.version}. Please get the latest entry before deleting.`,
                                code: 'CONCURRENCY_ERROR',
                                category: 'validation',
                                suggestion: 'Get the latest entry and use its version',
                                recoverable: true
                            }
                        }
                    }

                    if (project_number !== undefined) {
                        const scoped = db.getEntryByIdIncludeDeleted(entry_id, '*')
                        if (projectOwnershipMismatch(project_number, scoped?.projectNumber)) {
                            return {
                                success: false,
                                entryId: entry_id,
                                permanent,
                                error: `Entry ${String(entry_id)} not found`,
                                code: 'RESOURCE_NOT_FOUND',
                                category: 'resource',
                                suggestion: 'Verify the entry ID and project number, and try again',
                                recoverable: true,
                            }
                        }
                    }

                    const success = db.deleteEntry(entry_id, permanent, wsId)

                    if (!success) {
                        return {
                            success: false,
                            entryId: entry_id,
                            permanent,
                            error: `Entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and try again',
                            recoverable: true,
                        }
                    }

                    // Remove from vector index (non-critical if fails)
                    let warning: string | undefined
                    if (vectorManager) {
                        try {
                            vectorManager.removeEntry(entry_id)
                        } catch (err) {
                            // Non-critical failure, entry already deleted from DB
                            warning = `Vector index cleanup failed: ${err instanceof Error ? err.message : String(err)}`
                        }
                    }

                    return {
                        success,
                        entryId: entry_id,
                        permanent,
                        ...(warning ? { warning } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'restore_entry',
            title: 'Restore Entry',
            description: 'Restore a soft-deleted journal entry.',
            group: 'admin',
            inputSchema: z.preprocess(
                (val: unknown) => {
                    if (typeof val === 'object' && val !== null) {
                        const obj = val as Record<string, unknown>;
                        if ('id' in obj && !('entry_id' in obj)) {
                            return { ...obj, entry_id: obj['id'] };
                        }
                    }
                    return val;
                },
                z.object({
                    entry_id: relaxedNumber().optional(),
                    project_number: relaxedNumber().optional(),
                    workspace_id: z.string().optional(),
                })
            ),
            outputSchema: z.object({ success: z.boolean().optional(), entryId: z.number().optional(), indexStatus: z.string().optional(), error: z.string().optional() }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const { entry_id, project_number, workspace_id } = z.preprocess(
                        (val: unknown) => {
                            if (typeof val === 'object' && val !== null) {
                                const obj = val as Record<string, unknown>;
                                if ('id' in obj && !('entry_id' in obj)) {
                                    return { ...obj, entry_id: obj['id'] };
                                }
                            }
                            return val;
                        },
                        z.object({
                            entry_id: z.number(),
                            project_number: z.number().int().optional(),
                            workspace_id: z.string().optional(),
                        })
                    ).parse(params)
                    let wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    if (
                        workspace_id === undefined &&
                        project_number === undefined
                    ) {
                        const existingByPk = db.getEntryByIdIncludeDeleted(entry_id, '*')
                        if (existingByPk?.workspaceId !== undefined) {
                            wsId = existingByPk.workspaceId
                        }
                    }
                    if (project_number !== undefined) {
                        const scoped = db.getEntryByIdIncludeDeleted(entry_id, '*')
                        if (projectOwnershipMismatch(project_number, scoped?.projectNumber)) {
                            return {
                                success: false,
                                entryId: entry_id,
                                error: `Entry ${String(entry_id)} not found or not deleted`,
                                code: 'RESOURCE_NOT_FOUND',
                                category: 'resource',
                                suggestion: 'Verify the entry ID and project number',
                                recoverable: true,
                            }
                        }
                    }
                    const success = db.restoreEntry(entry_id, wsId)
                    if (!success) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Entry ${String(entry_id)} not found or not deleted`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID',
                            recoverable: true,
                        }
                    }
                    // [SIDE-EFFECT] M4: soft-delete removed the vector; re-index on restore.
                    const restored = db.getEntryById(entry_id, wsId)
                    const indexStatus = await autoIndexEntry(
                        vectorManager,
                        db,
                        entry_id,
                        restored?.workspaceId ?? wsId
                    )
                    return { success, entryId: entry_id, indexStatus }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
