import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
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
import { relaxedNumber } from '../schemas.js'

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
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const entry = db.updateEntry(input.entry_id, {
                        content: input.content,
                        entryType: input.entry_type,
                        isPersonal: input.is_personal,
                        tags: input.tags,
                        significanceType: input.significance_type,
                        projectNumber: input.project_number,
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
                        impactScore: input.impact_score,
                        trustScore: input.trust_score,
                        validationStatus: input.validation_status,
                        sessionId: input.session_id ?? undefined,
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
                        indexStatus = await autoIndexEntry(vectorManager, db, entry.id)
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
                    const { entry_id, permanent, expected_version, workspace_id } = DeleteEntrySchema.parse(params)
                    const wsId = resolveWorkspaceId(workspace_id, undefined, context.config)

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

                    const success = db.deleteEntry(entry_id, permanent)

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
                z.object({ entry_id: relaxedNumber().optional() })
            ),
            outputSchema: z.object({ success: z.boolean().optional(), entryId: z.number().optional(), error: z.string().optional() }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { entry_id } = z.preprocess(
                        (val: unknown) => {
                            if (typeof val === 'object' && val !== null) {
                                const obj = val as Record<string, unknown>;
                                if ('id' in obj && !('entry_id' in obj)) {
                                    return { ...obj, entry_id: obj['id'] };
                                }
                            }
                            return val;
                        },
                        z.object({ entry_id: z.number(), project_number: z.number().int().optional() })
                    ).parse(params)
                    const success = db.restoreEntry(entry_id)
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
                    return { success, entryId: entry_id }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
