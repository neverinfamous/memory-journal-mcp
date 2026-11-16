import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { createBatchProgressReporter, sendProgress } from '../../../utils/progress-utils.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import type { BatchDeleteEntriesSchema } from './schemas.js'

type BatchDeleteInput = z.infer<typeof BatchDeleteEntriesSchema>

/** [INTENT] M4: vector cleanup is non-critical after a committed delete; surface failures as warnings. */
export function safeDeleteVectors(
    db: ToolContext['db'],
    ids: number[],
    vectorManager?: ToolContext['vectorManager']
): string[] {
    const warnings: string[] = []
    for (const id of ids) {
        try {
            if (typeof vectorManager?.removeEntry === 'function') {
                vectorManager.removeEntry(id)
            } else if (typeof db.deleteVector === 'function') {
                db.deleteVector(id)
            }
        } catch (err) {
            warnings.push(
                `Vector cleanup failed for entry ${String(id)}: ${err instanceof Error ? err.message : String(err)}`
            )
        }
    }
    return warnings
}

export function vectorWarningField(warnings: string[]): { warning?: string } {
    return warnings.length > 0 ? { warning: warnings.join('; ') } : {}
}

/**
 * [INVARIANT] C2: `workspace_id: '*'` updates scoped by project_number may only touch
 * entries owned by that project; concrete-workspace updates reject conflicting existing projects
 * and validate unnumbered entries against the project registry.
 */
export function findWildcardProjectMismatches(
    db: ToolContext['db'],
    updates: readonly {
        entry_id: number
        workspace_id?: string | undefined
        project_number?: number | null | undefined
        target_workspace_id?: string | undefined
    }[],
    rootWorkspaceId: string | undefined,
    rootProjectNumber: number | undefined,
    config?: ToolContext['config']
): number[] {
    const registry = activeProjectRegistry(config?.projectRegistry)
    return updates
        .filter((u) => {
            if (u.target_workspace_id !== undefined) {
                const sourceWs = u.workspace_id ?? rootWorkspaceId
                if (sourceWs === '*' && rootProjectNumber !== undefined) {
                    const entry = db.getEntryById(u.entry_id, '*')
                    return entry?.projectNumber !== rootProjectNumber
                }
                if (
                    sourceWs === '*' &&
                    rootProjectNumber === undefined &&
                    typeof u.project_number === 'number'
                ) {
                    const entry = db.getEntryById(u.entry_id, '*')
                    return entry?.projectNumber !== u.project_number
                }
                return false
            }
            const ws = u.workspace_id ?? rootWorkspaceId
            const pn = u.project_number !== undefined ? u.project_number : rootProjectNumber
            if (pn === undefined || pn === null) return false
            const entry = db.getEntryById(u.entry_id, '*')
            if (entry === null || entry === undefined) return ws === '*'
            const existingWs = entry.workspaceId ?? ws
            if (entry.projectNumber !== undefined && entry.projectNumber !== null) {
                if (ws === '*' || existingWs?.toLowerCase() !== 'default') {
                    return entry.projectNumber !== pn
                }
                pairStoredScope('default', pn, registry)
                return false
            }
            if (ws === '*') return true
            pairStoredScope(existingWs, pn, registry)
            return false
        })
        .map((u) => u.entry_id)
}

function buildBatchDeleteNotFoundAbort(
    missing: number[],
    permanent: boolean
): Record<string, unknown> {
    return {
        success: false,
        error: `Batch delete aborted because entries were not found: ${missing.join(', ')}. No rows were deleted.`,
        code: 'RESOURCE_NOT_FOUND',
        category: 'resource',
        recoverable: false,
        suggestion: 'Verify the entry identifiers and try again',
        notFound: missing,
        permanent,
    }
}

function buildBatchDeletePartialFailure(
    deleted: number[],
    notFound: number[],
    errors: { id: number; error: Error }[],
    permanent: boolean,
    vectorWarnings: string[] = []
): Record<string, unknown> {
    return {
        success: false,
        error: `Batch delete partially failed: ${String(notFound.length + errors.length)} failed`,
        code: 'AGGREGATE_ERROR',
        category: 'internal',
        recoverable: false,
        count: deleted.length,
        deleted,
        notFound,
        permanent,
        ...vectorWarningField(vectorWarnings),
        aggregated_errors: [
            ...notFound.map((id) => ({ message: `Entry ${String(id)} not found` })),
            ...errors.map((entry) => ({
                message: `Entry ${String(entry.id)} failed to delete: ${entry.error.message}`,
            })),
        ],
    }
}

function groupUnscopedBatchDeleteIds(
    db: ToolContext['db'],
    entryIds: number[]
): { missing: number[]; groups: Map<string, number[]> } {
    const missing: number[] = []
    const groups = new Map<string, number[]>()
    for (const id of entryIds) {
        const existing = db.getEntryByIdIncludeDeleted(id, '*')
        const entryWorkspace = existing?.workspaceId
        if (
            existing === null ||
            existing === undefined ||
            entryWorkspace === undefined ||
            entryWorkspace.length === 0
        ) {
            missing.push(id)
            continue
        }
        const bucket = groups.get(entryWorkspace)
        if (bucket === undefined) groups.set(entryWorkspace, [id])
        else bucket.push(id)
    }
    return { missing, groups }
}

async function runUnscopedBatchDelete(
    context: ToolContext,
    input: BatchDeleteInput
): Promise<Record<string, unknown>> {
    const { db, vectorManager, progress } = context
    const { missing, groups } = groupUnscopedBatchDeleteIds(db, input.entry_ids)
    if (missing.length > 0) {
        return buildBatchDeleteNotFoundAbort(missing, input.permanent)
    }

    await sendProgress(progress, 0, 2, 'Deleting entries...')
    const deleted: number[] = []
    const notFound: number[] = []
    const errors: { id: number; error: Error }[] = []
    const vectorWarnings: string[] = []

    for (const [groupWorkspace, ids] of groups) {
        let groupResult: { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] }
        try {
            groupResult = db.deleteEntries(ids, input.permanent, groupWorkspace)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
                success: false,
                error: `Batch delete stopped after a committed delete: ${message}`,
                code: 'INTERNAL_ERROR',
                category: 'internal',
                recoverable: false,
                count: deleted.length,
                deleted,
                notFound,
                permanent: input.permanent,
                ...vectorWarningField(vectorWarnings),
            }
        }
        deleted.push(...groupResult.deleted)
        notFound.push(...groupResult.notFound)
        errors.push(...groupResult.errors)
        vectorWarnings.push(...safeDeleteVectors(db, groupResult.deleted, vectorManager))
    }

    await sendProgress(progress, 2, 2, 'Batch delete complete')
    if (errors.length > 0 || notFound.length > 0) {
        return buildBatchDeletePartialFailure(
            deleted,
            notFound,
            errors,
            input.permanent,
            vectorWarnings
        )
    }
    return {
        success: true,
        count: deleted.length,
        deleted,
        notFound,
        permanent: input.permanent,
        ...vectorWarningField(vectorWarnings),
    }
}

async function runScopedBatchDelete(
    context: ToolContext,
    input: BatchDeleteInput
): Promise<Record<string, unknown>> {
    const { db, vectorManager, progress } = context
    const wsId =
        input.workspace_id === '*'
            ? '*'
            : resolveWriteWorkspaceId(input.workspace_id, input.project_number, context.config)
    const missingBeforeDelete: number[] = []
    for (const id of input.entry_ids) {
        const existing = db.getEntryByIdIncludeDeleted(id, wsId)
        if (
            existing === null ||
            existing === undefined ||
            (input.project_number !== undefined && existing.projectNumber !== input.project_number)
        ) {
            missingBeforeDelete.push(id)
        }
    }
    if (missingBeforeDelete.length > 0) {
        return buildBatchDeleteNotFoundAbort(missingBeforeDelete, input.permanent)
    }

    await sendProgress(progress, 0, 2, 'Deleting entries...')
    const { deleted, notFound, errors } = db.deleteEntries(input.entry_ids, input.permanent, wsId)
    await sendProgress(progress, 1, 2, `Deleted ${String(deleted.length)} entries...`)

    const vectorWarnings: string[] = []
    if (deleted.length > 0) {
        const reporter = createBatchProgressReporter(progress, deleted.length, 10)
        for (let i = 0; i < deleted.length; i++) {
            const id = deleted[i]
            if (id !== undefined) {
                vectorWarnings.push(...safeDeleteVectors(db, [id], vectorManager))
            }
            if (vectorManager) {
                await reporter(i + 1, `Updating index ${String(i + 1)}/${String(deleted.length)}...`)
            }
        }
        if (!vectorManager) {
            await sendProgress(progress, 2, 2, 'Batch delete complete')
        }
    } else {
        await sendProgress(progress, 2, 2, 'Batch delete complete')
    }

    if (errors.length > 0 || notFound.length > 0) {
        return buildBatchDeletePartialFailure(
            deleted,
            notFound,
            errors,
            input.permanent,
            vectorWarnings
        )
    }
    return {
        success: true,
        count: deleted.length,
        deleted,
        notFound,
        permanent: input.permanent,
        ...vectorWarningField(vectorWarnings),
    }
}

/** Validate target existence/scope and execute `batch_delete_entries` with shallow control flow. */
export async function executeBatchDeleteEntries(
    context: ToolContext,
    input: BatchDeleteInput
): Promise<Record<string, unknown>> {
    if (input.workspace_id === undefined && input.project_number === undefined) {
        return await runUnscopedBatchDelete(context, input)
    }
    return await runScopedBatchDelete(context, input)
}
