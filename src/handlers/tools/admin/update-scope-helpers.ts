/**
 * Scope resolution helpers for `update_entry` and cross-workspace moves,
 * extracted from `admin/core-tools.ts` (Appendix A).
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { projectOwnershipMismatch } from './restore-entry-tool.js'
import { exactRegistryKey } from '../../../utils/workspace-registry-match.js'
import type { UpdateEntrySchema } from './schemas.js'

export type UpdateEntryParsed = z.infer<typeof UpdateEntrySchema>

function notFoundErrorResponse(entryId: number): Record<string, unknown> {
    return {
        success: false,
        error: `Entry ${String(entryId)} not found`,
        code: 'RESOURCE_NOT_FOUND',
        category: 'resource',
        suggestion: 'Verify the entry ID and project number, and try again',
        recoverable: true,
    }
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
        return { errorResponse: notFoundErrorResponse(entryId) }
    }
    const registry = activeProjectRegistry(config?.projectRegistry)
    const existingWs = scoped.workspaceId ?? resolvedWorkspace
    if (scoped.projectNumber !== undefined && scoped.projectNumber !== null) {
        if (workspaceInput === '*' || existingWs.toLowerCase() !== 'default') {
            if (projectOwnershipMismatch(requestedProject, scoped.projectNumber)) {
                return { errorResponse: notFoundErrorResponse(entryId) }
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
        return { errorResponse: notFoundErrorResponse(entryId) }
    }
    pairStoredScope(existingWs, requestedProject, registry)
    return workspaceInput === undefined && scoped.workspaceId !== undefined
        ? { assignedWorkspace: scoped.workspaceId }
        : {}
}

export function sameMoveWorkspace(
    destWs: string,
    existingWs: string | undefined,
    registry: ReturnType<typeof activeProjectRegistry>
): boolean {
    if (existingWs === undefined) return false
    const isReg =
        exactRegistryKey(destWs, registry) !== undefined ||
        exactRegistryKey(existingWs, registry) !== undefined
    return isReg ? destWs.toLowerCase() === existingWs.toLowerCase() : destWs === existingWs
}

function resolveMoveUpdateScope(
    input: UpdateEntryParsed,
    targetWorkspaceId: string,
    db: ToolContext['db'],
    config: ToolContext['config']
): { wsId: string; projectNumberForUpdate: number | null | undefined } | { errorResponse: Record<string, unknown> } {
    const trimmedInputWs = input.workspace_id?.trim()
    const hasGetById = typeof db.getEntryById === 'function'
    const needsLookup =
        hasGetById &&
        (trimmedInputWs === '*' ||
            trimmedInputWs?.toLowerCase() === 'default' ||
            trimmedInputWs === undefined ||
            typeof input.project_number === 'number')
    const scoped = needsLookup ? db.getEntryById(input.entry_id, '*') : undefined
    const isWildcardOrDefaultSource =
        trimmedInputWs === '*' ||
        trimmedInputWs?.toLowerCase() === 'default' ||
        (trimmedInputWs === undefined && scoped?.workspaceId?.toLowerCase() === 'default')

    if (
        isWildcardOrDefaultSource &&
        typeof input.project_number === 'number' &&
        hasGetById &&
        scoped?.projectNumber !== null &&
        scoped?.projectNumber !== undefined &&
        scoped.projectNumber > 0 &&
        scoped.projectNumber !== input.project_number
    ) {
        return {
            errorResponse: {
                ...notFoundErrorResponse(input.entry_id),
                suggestion:
                    "🛠️ AUTONOMOUS HEALING: Verify the entry ID and source project_number. When moving an entry across workspaces via update_entry({ entry_id, workspace_id: '*', target_workspace_id }), omit project_number so target_workspace_id resolves the destination project_number from projectRegistry (and in mj_execute_code omit top-level project_number when moving foreign-project entries).",
            },
        }
    }

    const registry = activeProjectRegistry(config?.projectRegistry)
    if (
        !isWildcardOrDefaultSource &&
        typeof input.project_number === 'number' &&
        sameMoveWorkspace(targetWorkspaceId, scoped?.workspaceId, registry) &&
        scoped?.projectNumber !== null &&
        scoped?.projectNumber !== undefined &&
        scoped.projectNumber > 0 &&
        scoped.projectNumber !== input.project_number &&
        (scoped.workspaceId ?? '').toLowerCase() !== 'default'
    ) {
        return { errorResponse: notFoundErrorResponse(input.entry_id) }
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
    if (trimmedInputWs === '*') {
        wsId = '*'
    } else if (trimmedInputWs !== undefined) {
        wsId = resolveWriteWorkspaceId(trimmedInputWs, undefined, config)
    } else {
        wsId = scoped?.workspaceId ?? resolveWriteWorkspaceId(undefined, undefined, config)
    }
    const projectNumberForUpdate =
        input.project_number === null ? null : (targetResolved.projectNumber ?? null)
    return { wsId, projectNumberForUpdate }
}

/** Resolve source and destination workspace/project scope for `update_entry`. */
export function resolveUpdateScope(
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
