/**
 * Wildcard source-project verification and post-RBAC helpers extracted from `dispatch-batch-scope.ts`.
 */

import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import {
    parseCanonicalMoveEntryId,
    verifyBatchWildcardMoveProjects,
    type BatchScopeHelpersContext,
} from './dispatch-batch-scope.js'

export function verifyWildcardUpdateSourceProject(
    tool: ToolDefinition,
    paramsObj: Record<string, unknown>,
    hasCrossWorkspaceTarget: boolean,
    sessionContext: ToolContext,
    workspaceId: string | undefined,
    projectId: number | string | undefined,
    isDefaultWorkspaceNameFn: (value: unknown) => boolean
): Record<string, unknown> | undefined {
    const effectiveWs =
        typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'].trim() : workspaceId
    if (
        tool.name !== 'update_entry' ||
        !hasCrossWorkspaceTarget ||
        typeof projectId !== 'number' ||
        (effectiveWs !== '*' && !isDefaultWorkspaceNameFn(effectiveWs))
    ) {
        return undefined
    }
    const parsedEntryId = parseCanonicalMoveEntryId(paramsObj)
    if (parsedEntryId === undefined) {
        return {
            success: false,
            error: 'Cross-workspace move from wildcard/default source requires a valid positive integer entry_id.',
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }
    if (typeof sessionContext.db?.getEntryById !== 'function') {
        return undefined
    }
    const sourceEntry = sessionContext.db.getEntryById(parsedEntryId, '*')
    const sourceProject = sourceEntry?.projectNumber
    if (
        sourceProject !== null &&
        sourceProject !== undefined &&
        sourceProject > 0 &&
        sourceProject !== projectId
    ) {
        return {
            success: false,
            error: `Entry ${String(parsedEntryId)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion:
                "🛠️ AUTONOMOUS HEALING: Cross-workspace moves from another project are blocked when mj_execute_code pins a different top-level project_number. Re-run mj_execute_code with workspace_id: '*' (omitting top-level project_number) and call mj.admin.updateEntry({ entry_id, workspace_id: '*', target_workspace_id }) without inner project_number.",
            recoverable: true,
        }
    }
    return undefined
}

export function buildPostRbacSideEffects(opts: {
    tool: ToolDefinition
    paramsObj: Record<string, unknown>
    hasCrossWorkspaceTarget: boolean
    batchArrayKey: 'entries' | 'updates' | undefined
    parentWorkspaceId: unknown
    batchCtx: BatchScopeHelpersContext | undefined
    sessionContext: ToolContext
    workspaceId: string | undefined
    projectId: number | string | undefined
    isDefaultWorkspaceName: (value: unknown) => boolean
    acceptsGithubUrls: boolean
    autoPopulateGithubUrls: (
        paramsObj: Record<string, unknown>,
        sessionContext: ToolContext,
        workspaceId: string | undefined,
        projectId: number | string | undefined
    ) => Promise<void>
}): () => Promise<Record<string, unknown> | undefined> {
    const {
        tool, paramsObj, hasCrossWorkspaceTarget, batchArrayKey, parentWorkspaceId, batchCtx,
        sessionContext, workspaceId, projectId, isDefaultWorkspaceName, acceptsGithubUrls, autoPopulateGithubUrls,
    } = opts
    return async (): Promise<Record<string, unknown> | undefined> => {
        const sourceErr = verifyWildcardUpdateSourceProject(
            tool, paramsObj, hasCrossWorkspaceTarget, sessionContext, workspaceId, projectId, isDefaultWorkspaceName
        )
        if (sourceErr !== undefined) return sourceErr
        if (batchArrayKey !== undefined && batchCtx !== undefined) {
            const batchItems = Array.isArray(paramsObj[batchArrayKey]) ? paramsObj[batchArrayKey] : []
            const wildcardErr = verifyBatchWildcardMoveProjects(batchArrayKey, batchItems, parentWorkspaceId, batchCtx)
            if (wildcardErr !== undefined) return wildcardErr.errorResult
        }
        if (acceptsGithubUrls) {
            await autoPopulateGithubUrls(paramsObj, sessionContext, workspaceId, projectId)
        }
        return undefined
    }
}
