import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../batch-indexing.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { findWildcardProjectMismatches } from './batch-vector-helpers.js'
import { canonicalTargetWorkspace } from './core-tools.js'
import { BatchUpdateEntriesSchema } from './schemas.js'

type BatchUpdateInput = z.infer<typeof BatchUpdateEntriesSchema>
type BatchUpdateItem = BatchUpdateInput['updates'][number]

export function mapBatchUpdateInputItem(
    u: BatchUpdateItem,
    input: BatchUpdateInput,
    context: ToolContext
): Parameters<ToolContext['db']['updateEntries']>[0][number] {
    const { db, config } = context
    const explicitWs = u.workspace_id ?? input.workspace_id
    const explicitPn = u.project_number ?? input.project_number
    const targetWorkspaceId = canonicalTargetWorkspace(u.target_workspace_id, config)
    let resolvedWs: string
    let projectNumberForUpdate: number | null | undefined

    if (targetWorkspaceId !== undefined) {
        const targetResolved = resolveProjectContext(
            {
                workspace_id: targetWorkspaceId,
                ...(u.project_number !== undefined ? { project_number: u.project_number } : {}),
            },
            config
        )
        projectNumberForUpdate = targetResolved.projectNumber ?? null
        if (explicitWs === '*') {
            resolvedWs = '*'
        } else if (explicitWs !== undefined) {
            resolvedWs = resolveWriteWorkspaceId(explicitWs, undefined, config)
        } else {
            resolvedWs = db.getEntryById(u.entry_id, '*')?.workspaceId ?? targetWorkspaceId
        }
    } else {
        const resolvedUpdate = resolveProjectContext(
            {
                ...(explicitWs !== undefined && explicitWs !== '*' ? { workspace_id: explicitWs } : {}),
                ...(explicitPn !== undefined ? { project_number: explicitPn } : {}),
            },
            config
        )
        projectNumberForUpdate = explicitPn === undefined ? undefined : resolvedUpdate.projectNumber
        resolvedWs = explicitWs === '*' ? '*' : resolvedUpdate.workspaceId
        if (explicitWs === undefined && explicitPn === undefined) {
            const existingByPk =
                typeof db.getEntryById === 'function' ? db.getEntryById(u.entry_id, '*') : undefined
            if (existingByPk?.workspaceId !== undefined) {
                resolvedWs = existingByPk.workspaceId
            }
        }
    }

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

export async function executeBatchUpdateEntries(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, vectorManager, progress } = context
    const input = BatchUpdateEntriesSchema.parse(params)
    const wildcardMismatches = findWildcardProjectMismatches(
        db,
        input.updates,
        input.workspace_id,
        input.project_number,
        context.config
    )
    if (wildcardMismatches.length > 0) {
        return {
            success: false,
            error: `Batch update aborted because entries were not found in the requested project: ${wildcardMismatches.join(', ')}. No rows were updated.`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            recoverable: true,
            suggestion: 'Verify the entry identifiers and project number',
            count: 0,
            notFound: wildcardMismatches,
        }
    }

    await sendProgress(progress, 0, 2, 'Updating entries...')
    const updates = input.updates.map((u) => mapBatchUpdateInputItem(u, input, context))
    const { updated, notFound, errors } = db.updateEntries(updates)
    await sendProgress(progress, 1, 2, `Updated ${String(updated.length)} entries...`)

    // Re-index if content, workspace, tags, or entry_type changed so vector search reflects current metadata
    const reindexIds = new Set(
        input.updates
            .filter(
                (u) =>
                    u.content !== undefined ||
                    u.target_workspace_id !== undefined ||
                    u.tags !== undefined ||
                    u.entry_type !== undefined
            )
            .map((u) => u.entry_id)
    )
    const { indexStatuses, indexErrors } = await indexBatchEntries({
        progress,
        vectorManager,
        db,
        autoIndex: input.auto_index,
        entryIds: updated.map((r) => r.id),
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
