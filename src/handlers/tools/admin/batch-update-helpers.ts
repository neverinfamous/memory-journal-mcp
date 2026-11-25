import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../batch-indexing.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { findWildcardProjectMismatches, inheritBatchProjectNumber } from './batch-vector-helpers.js'
import { canonicalTargetWorkspace } from './core-tools.js'
import { BatchUpdateEntriesSchema } from './schemas.js'

type BatchUpdateInput = z.infer<typeof BatchUpdateEntriesSchema>
type BatchUpdateItem = BatchUpdateInput['updates'][number]

function resolveBatchUpdateItemScope(
    u: BatchUpdateItem,
    input: BatchUpdateInput,
    context: ToolContext,
    prefetchedById?: ReadonlyMap<number, { workspaceId?: string }>
): { resolvedWs: string; projectNumberForUpdate: number | null | undefined; targetWorkspaceId: string | undefined } {
    const { db, config } = context
    const rawExplicitWs = u.workspace_id ?? input.workspace_id
    const trimmedExplicitWs = rawExplicitWs?.trim()
    const explicitWs = trimmedExplicitWs === '*' ? '*' : rawExplicitWs
    const explicitPn = inheritBatchProjectNumber(
        u.workspace_id,
        u.project_number,
        input.workspace_id,
        input.project_number
    )
    const targetWorkspaceId = canonicalTargetWorkspace(u.target_workspace_id, config)

    const lookupEntryWorkspace = (): string | undefined => {
        if (prefetchedById !== undefined) {
            return prefetchedById.get(u.entry_id)?.workspaceId
        }
        return typeof db.getEntryById === 'function'
            ? db.getEntryById(u.entry_id, '*')?.workspaceId
            : undefined
    }

    if (targetWorkspaceId !== undefined) {
        const targetResolved = resolveProjectContext(
            {
                workspace_id: targetWorkspaceId,
                ...(typeof u.project_number === 'number' ? { project_number: u.project_number } : {}),
            },
            config
        )
        const projectNumberForUpdate =
            u.project_number === null ? null : (targetResolved.projectNumber ?? null)
        let resolvedWs: string
        if (explicitWs === '*') {
            resolvedWs = '*'
        } else if (explicitWs !== undefined) {
            resolvedWs = resolveWriteWorkspaceId(explicitWs, undefined, config)
        } else {
            resolvedWs = lookupEntryWorkspace() ?? targetWorkspaceId
        }
        return { resolvedWs, projectNumberForUpdate, targetWorkspaceId }
    }

    const resolvedUpdate = resolveProjectContext(
        {
            ...(explicitWs !== undefined && explicitWs !== '*' ? { workspace_id: explicitWs } : {}),
            ...(typeof explicitPn === 'number' ? { project_number: explicitPn } : {}),
        },
        config
    )
    const projectNumberForUpdate =
        explicitPn === undefined ? undefined : explicitPn === null ? null : resolvedUpdate.projectNumber
    let resolvedWs = explicitWs === '*' ? '*' : resolvedUpdate.workspaceId
    if (explicitWs === undefined && (explicitPn === undefined || explicitPn === null)) {
        const existingWs = lookupEntryWorkspace()
        if (existingWs !== undefined) {
            resolvedWs = existingWs
        }
    }
    return { resolvedWs, projectNumberForUpdate, targetWorkspaceId }
}

export function mapBatchUpdateInputItem(
    u: BatchUpdateItem,
    input: BatchUpdateInput,
    context: ToolContext,
    prefetchedById?: ReadonlyMap<number, { workspaceId?: string }>
): Parameters<ToolContext['db']['updateEntries']>[0][number] {
    const { resolvedWs, projectNumberForUpdate, targetWorkspaceId } = resolveBatchUpdateItemScope(
        u,
        input,
        context,
        prefetchedById
    )

    return {
        id: u.entry_id,
        content: u.content,
        entryType: u.entry_type,
        isPersonal: u.is_personal,
        tags: u.tags,
        significanceType: u.significance_type,
        projectNumber: projectNumberForUpdate,
        projectOwner: u.project_owner,
        issueNumber: u.issue_number,
        issueUrl: u.issue_url,
        prNumber: u.pr_number,
        prUrl: u.pr_url,
        prStatus: u.pr_status,
        workflowRunId: u.workflow_run_id,
        workflowName: u.workflow_name,
        workflowStatus: u.workflow_status,
        isArchived: u.is_archived,
        expectedVersion: u.expected_version,
        autoContext: u.auto_context,
        impactScore: u.impact_score,
        trustScore: u.trust_score,
        validationStatus: u.validation_status,
        targetWorkspaceId,
        sessionId: u.session_id,
        workspaceId: resolvedWs,
    }
}

function buildWildcardMismatchError(
    wildcardMismatches: number[],
    workspaceId?: string,
    projectNumber?: number
): Record<string, unknown> {
    const suggestion =
        workspaceId?.trim() === '*' && projectNumber !== undefined
            ? `🛠️ AUTONOMOUS HEALING: Cross-workspace batch updates are restricted to project_number ${String(projectNumber)} because project_number was pinned (often inherited from top-level mj_execute_code({ project_number })). Re-run mj_execute_code with workspace_id: '*' and omit top-level project_number when updating entries across multiple projects.`
            : 'Verify the entry identifiers and project number'
    return {
        success: false,
        error: `Batch update aborted because entries were not found in the requested project: ${wildcardMismatches.join(', ')}. No rows were updated.`,
        code: 'RESOURCE_NOT_FOUND',
        category: 'resource',
        recoverable: true,
        suggestion,
        count: 0,
        notFound: wildcardMismatches,
    }
}

function collectBatchReindexIds(
    updates: readonly z.infer<typeof BatchUpdateEntriesSchema>['updates'][number][]
): Set<number> {
    const ids = new Set<number>()
    for (const u of updates) {
        if (
            u.content !== undefined ||
            u.target_workspace_id !== undefined ||
            u.tags !== undefined ||
            u.entry_type !== undefined
        ) {
            ids.add(u.entry_id)
        }
    }
    return ids
}

export async function executeBatchUpdateEntries(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, vectorManager, progress } = context
    const input = BatchUpdateEntriesSchema.parse(params)
    const prefetchedById =
        typeof db.getEntriesByIds === 'function'
            ? db.getEntriesByIds(
                  input.updates.map((u) => u.entry_id),
                  '*'
              )
            : undefined
    const wildcardMismatches = findWildcardProjectMismatches(
        db,
        input.updates,
        input.workspace_id,
        input.project_number,
        context.config,
        prefetchedById
    )
    if (wildcardMismatches.length > 0) {
        return buildWildcardMismatchError(
            wildcardMismatches,
            input.workspace_id,
            input.project_number
        )
    }

    await sendProgress(progress, 0, 2, 'Updating entries...')
    const updates = input.updates.map((u) =>
        mapBatchUpdateInputItem(u, input, context, prefetchedById)
    )
    const { updated, notFound, errors } = db.updateEntries(updates)
    await sendProgress(progress, 1, 2, `Updated ${String(updated.length)} entries...`)

    // Re-index if content, workspace, tags, or entry_type changed so vector search reflects current metadata
    const reindexIds = collectBatchReindexIds(input.updates)
    const { indexStatuses, indexErrors } = await indexBatchEntries({
        progress,
        vectorManager,
        db,
        autoIndex: input.auto_index,
        entryIds: updated.map((r) => r.id),
        entries: updated,
        errorPrefix: 'Entry',
        doneMessage: 'Batch update complete',
        shouldIndex: (id) => reindexIds.has(id),
        workspaceByEntryId: collectIndexWorkspaces(updated),
    })

    const allErrors = [
        ...notFound.map((id) => new Error(`Entry ${id} not found`)),
        ...errors.map((e) => new Error(`Entry ${e.id} failed to update: ${e.error.message}`)),
        ...indexErrors,
    ]
    if (allErrors.length > 0) {
        throw new AggregateError(
            allErrors,
            `Batch update partially failed: ${allErrors.length} operations failed`
        )
    }

    const failedUpdateVectors = indexStatuses.filter((s) => s === 'failed').length
    return {
        success: true,
        count: updated.length,
        updated,
        notFound,
        indexStatuses,
        ...(failedUpdateVectors > 0
            ? { warning: `Vector indexing failed for ${String(failedUpdateVectors)} entry(ies).` }
            : {}),
    }
}
