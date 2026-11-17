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
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { createRestoreEntryTool, projectOwnershipMismatch } from './restore-entry-tool.js'

export { projectOwnershipMismatch }

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

function validateUpdateProjectScope(
    db: ToolContext['db'],
    entryId: number,
    requestedProject: number,
    workspaceInput: string | undefined,
    resolvedWorkspace: string,
    config: ToolContext['config'],
    prefetchedEntry?: ReturnType<ToolContext['db']['getEntryById']>
): { errorResponse?: Record<string, unknown>; assignedWorkspace?: string } {
    if (typeof db.getEntryById !== 'function') {
        return {}
    }
    const scoped = prefetchedEntry !== undefined ? prefetchedEntry : db.getEntryById(entryId, '*')
    if (scoped === null || scoped === undefined) {
        return {
            errorResponse: {
                success: false,
                error: `Entry ${String(entryId)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the entry ID and project number, and try again',
                recoverable: true,
            },
        }
    }
    const registry = activeProjectRegistry(config?.projectRegistry)
    const existingWs = scoped.workspaceId ?? resolvedWorkspace
    if (scoped.projectNumber !== undefined && scoped.projectNumber !== null) {
        if (workspaceInput === '*' || existingWs.toLowerCase() !== 'default') {
            if (projectOwnershipMismatch(requestedProject, scoped.projectNumber)) {
                return {
                    errorResponse: {
                        success: false,
                        error: `Entry ${String(entryId)} not found`,
                        code: 'RESOURCE_NOT_FOUND',
                        category: 'resource',
                        suggestion: 'Verify the entry ID and project number, and try again',
                        recoverable: true,
                    },
                }
            }
            return {}
        }
        // Entries in `default` may reassign numeric `project_number` metadata as long as
        // the destination number does not belong to a conflicting registered workspace.
        pairStoredScope('default', requestedProject, registry)
        return workspaceInput === undefined && scoped.workspaceId !== undefined
            ? { assignedWorkspace: scoped.workspaceId }
            : {}
    }
    if (workspaceInput === '*') {
        return {
            errorResponse: {
                success: false,
                error: `Entry ${String(entryId)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the entry ID and project number, and try again',
                recoverable: true,
            },
        }
    }
    pairStoredScope(existingWs, requestedProject, registry)
    return workspaceInput === undefined && scoped.workspaceId !== undefined
        ? { assignedWorkspace: scoped.workspaceId }
        : {}
}

type UpdateEntryParsed = ReturnType<typeof UpdateEntrySchema.parse>

function resolveMoveUpdateScope(
    input: UpdateEntryParsed,
    targetWorkspaceId: string,
    db: ToolContext['db'],
    config: ToolContext['config']
): { wsId: string; projectNumberForUpdate: number | null | undefined } | { errorResponse: Record<string, unknown> } {
    const needsPkLookup =
        (input.workspace_id === '*' && typeof input.project_number === 'number') ||
        input.workspace_id === undefined
    const scoped =
        needsPkLookup && typeof db.getEntryById === 'function'
            ? db.getEntryById(input.entry_id, '*')
            : undefined
    if (
        input.workspace_id === '*' &&
        typeof input.project_number === 'number' &&
        typeof db.getEntryById === 'function' &&
        scoped?.projectNumber !== input.project_number
    ) {
        return {
            errorResponse: {
                success: false,
                error: `Entry ${String(input.entry_id)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the entry ID and project number, and try again',
                recoverable: true,
            },
        }
    }
    const targetResolved = resolveProjectContext(
        {
            workspace_id: targetWorkspaceId,
            ...(typeof input.project_number === 'number'
                ? { project_number: input.project_number }
                : {}),
        },
        config
    )
    let wsId: string
    if (input.workspace_id === '*') {
        wsId = '*'
    } else if (input.workspace_id !== undefined) {
        wsId = resolveWriteWorkspaceId(input.workspace_id, undefined, config)
    } else {
        wsId = scoped?.workspaceId ?? resolveWriteWorkspaceId(undefined, undefined, config)
    }
    const projectNumberForUpdate =
        input.project_number === null ? null : (targetResolved.projectNumber ?? null)
    return { wsId, projectNumberForUpdate }
}

function resolveUpdateScope(
    input: UpdateEntryParsed,
    targetWorkspaceId: string | undefined,
    db: ToolContext['db'],
    config: ToolContext['config']
): { wsId: string; projectNumberForUpdate: number | null | undefined } | { errorResponse: Record<string, unknown> } {
    if (targetWorkspaceId !== undefined) {
        return resolveMoveUpdateScope(input, targetWorkspaceId, db, config)
    }

    const resolved = resolveProjectContext(
        {
            workspace_id: input.workspace_id,
            ...(typeof input.project_number === 'number'
                ? { project_number: input.project_number }
                : {}),
        },
        config
    )
    let projectNumberForUpdate =
        input.project_number === undefined
            ? undefined
            : input.project_number === null
              ? null
              : resolved.projectNumber
    let wsId = input.workspace_id === '*' ? '*' : resolved.workspaceId
    const needsUnscopedLookup =
        input.workspace_id === undefined &&
        (input.project_number === undefined || input.project_number === null)
    let prefetchedEntry: ReturnType<ToolContext['db']['getEntryById']> | undefined
    if (
        (needsUnscopedLookup || typeof input.project_number === 'number') &&
        typeof db.getEntryById === 'function'
    ) {
        prefetchedEntry = db.getEntryById(input.entry_id, '*')
    }
    if (needsUnscopedLookup && prefetchedEntry?.workspaceId !== undefined) {
        wsId = prefetchedEntry.workspaceId
    }
    if (typeof input.project_number === 'number') {
        const scopeCheck = validateUpdateProjectScope(
            db,
            input.entry_id,
            input.project_number,
            input.workspace_id,
            wsId,
            config,
            prefetchedEntry
        )
        if (scopeCheck.errorResponse !== undefined) {
            return { errorResponse: scopeCheck.errorResponse }
        }
        if (scopeCheck.assignedWorkspace !== undefined) {
            wsId = scopeCheck.assignedWorkspace
        }
        projectNumberForUpdate ??= input.project_number
    }
    return { wsId, projectNumberForUpdate }
}

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
    existingByPk: ReturnType<ToolContext['db']['getEntryByIdIncludeDeleted']> | undefined
): Record<string, unknown> | undefined {
    if (expectedVersion !== undefined) {
        const scopeMatches =
            wsId === '*' ||
            existingByPk?.workspaceId === undefined ||
            existingByPk.workspaceId.toLowerCase() === wsId.toLowerCase()
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
        existingByPk
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
