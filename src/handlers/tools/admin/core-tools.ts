import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-registry-match.js'
import { coerceSignificanceAlias } from '../schemas.js'
import {
    UpdateEntrySchema,
    UpdateEntrySchemaMcp,
    UpdateEntryOutputSchema,
    DeleteEntrySchema,
    DeleteEntrySchemaMcp,
    DeleteEntryOutputSchema,
} from './schemas.js'
import { createRestoreEntryTool, projectOwnershipMismatch } from './restore-entry-tool.js'
import { canonicalTargetWorkspace, resolveUpdateScope } from './update-scope-helpers.js'

export { canonicalTargetWorkspace, projectOwnershipMismatch }

async function executeUpdateEntry(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, vectorManager } = context
    coerceSignificanceAlias(params)
    const input = UpdateEntrySchema.parse(params)
    const targetWorkspaceId = canonicalTargetWorkspace(input.target_workspace_id, context.config)
    const scope = resolveUpdateScope(input, targetWorkspaceId, db, context.config)
    if ('errorResponse' in scope) {
        return scope.errorResponse
    }

    const entry = db.updateEntry(input.entry_id, {
        content: input.content,
        entryType: input.entry_type,
        isPersonal: input.is_personal,
        tags: input.tags,
        significanceType: input.significance_type,
        projectNumber: scope.projectNumberForUpdate,
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
        workspaceId: scope.wsId,
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

    // Re-index if content, metadata, or workspace moved so vector search reflects new metadata
    let indexStatus: string | undefined
    let warning: string | undefined
    if (
        input.content !== undefined ||
        targetWorkspaceId !== undefined ||
        input.tags !== undefined ||
        input.entry_type !== undefined
    ) {
        indexStatus = await autoIndexEntry(vectorManager, db, entry, entry.workspaceId ?? scope.wsId)
        if (indexStatus === 'failed') {
            warning = 'Entry updated, but vector re-indexing failed.'
        }
    }
    return {
        success: true,
        entry,
        ...(indexStatus ? { indexStatus } : {}),
        ...(warning !== undefined ? { warning } : {}),
    }
}

function validateDeletePreconditions(
    entryId: number,
    permanent: boolean,
    expectedVersion: number | undefined,
    projectNumber: number | undefined,
    wsId: string,
    existingByPk: ReturnType<ToolContext['db']['getEntryByIdIncludeDeleted']> | undefined,
    registry: ReturnType<typeof activeProjectRegistry>
): Record<string, unknown> | undefined {
    if (expectedVersion !== undefined) {
        let scopeMatches = wsId === '*' || existingByPk?.workspaceId === undefined
        if (!scopeMatches && existingByPk?.workspaceId !== undefined) {
            const leftKey = findCanonicalRegistryKey(existingByPk.workspaceId, registry)
            const rightKey = findCanonicalRegistryKey(wsId, registry)
            scopeMatches =
                leftKey !== undefined && rightKey !== undefined
                    ? leftKey.toLowerCase() === rightKey.toLowerCase()
                    : existingByPk.workspaceId === wsId
        }
        const existing = scopeMatches ? existingByPk : null
        if (existing && existing.version !== expectedVersion) {
            return {
                success: false,
                error: `Concurrency conflict: Expected version ${expectedVersion} but found ${existing.version}. Please get the latest entry before deleting.`,
                code: 'CONCURRENCY_ERROR',
                category: 'validation',
                suggestion: 'Get the latest entry and use its version',
                recoverable: true,
            }
        }
    }

    if (
        projectNumber !== undefined &&
        projectOwnershipMismatch(projectNumber, existingByPk?.projectNumber)
    ) {
        return {
            success: false,
            entryId,
            permanent,
            error: `Entry ${String(entryId)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the entry ID and project number, and try again',
            recoverable: true,
        }
    }

    return undefined
}

function executeDeleteEntry(params: unknown, context: ToolContext): Record<string, unknown> {
    const { db, vectorManager } = context
    const { entry_id, permanent, expected_version, workspace_id, project_number } =
        DeleteEntrySchema.parse(params)
    const needsLookup =
        (workspace_id === undefined && project_number === undefined) ||
        expected_version !== undefined ||
        project_number !== undefined
    const existingByPk =
        needsLookup && typeof db.getEntryByIdIncludeDeleted === 'function'
            ? db.getEntryByIdIncludeDeleted(entry_id, '*')
            : undefined

    let wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
    if (workspace_id === undefined && project_number === undefined) {
        if (existingByPk?.workspaceId !== undefined) wsId = existingByPk.workspaceId
    }

    const preconditionError = validateDeletePreconditions(
        entry_id,
        permanent,
        expected_version,
        project_number,
        wsId,
        existingByPk,
        activeProjectRegistry(context.config?.projectRegistry)
    )
    if (preconditionError !== undefined) return preconditionError

    const success = db.deleteEntry(entry_id, permanent, wsId)
    if (!success.success) {
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

    let warning = success.warning
    if (vectorManager) {
        try {
            vectorManager.removeEntry(entry_id)
        } catch (err) {
            const vectorWarning = `Vector index cleanup failed: ${err instanceof Error ? err.message : String(err)}`
            warning = warning !== undefined ? `${warning}; ${vectorWarning}` : vectorWarning
        }
    }
    return {
        success: success.success,
        entryId: entry_id,
        permanent,
        ...(warning ? { warning } : {}),
    }
}

export function getCoreTools(context: ToolContext): ToolDefinition[] {
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
                    return await executeUpdateEntry(params, context)
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
                    return executeDeleteEntry(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        createRestoreEntryTool(context),
    ]
}
