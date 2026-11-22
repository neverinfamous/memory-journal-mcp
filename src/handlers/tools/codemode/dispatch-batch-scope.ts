/**
 * Per-item batch parameter normalization helpers for Code Mode dispatch scope enforcement.
 */

import type { ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { pairStoredScope } from '../../../utils/write-scope.js'
import { lookupRegistryEntry } from './session-context.js'

export interface BatchScopeHelpersContext {
    projectId: number | string | undefined
    workspaceId: string | undefined
    explicitWorkspace?: boolean | undefined
    sessionId?: string | undefined
    toolName?: string | undefined
    sessionContext?: ToolContext | undefined
    isDefaultWorkspaceName: (value: unknown) => boolean
    coerceProjectNumberField: (
        obj: Record<string, unknown>,
        registry: NonNullable<ToolContext['config']>['projectRegistry'],
        requirePositiveInt?: boolean
    ) => { errorResult: Record<string, unknown> } | undefined
}

function trimmedStringField(obj: Record<string, unknown>, key: string): string | undefined {
    const raw = obj[key]
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

function applyBatchAliasWorkspaceOverride(
    nextItem: Record<string, unknown>,
    itemProjNum: number | undefined,
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext
): void {
    const { workspaceId, explicitWorkspace } = ctx
    if (explicitWorkspace !== true || typeof workspaceId !== 'string' || workspaceId === '*') {
        return
    }
    const rawItemWs = trimmedStringField(nextItem, 'workspace_id')
    if (rawItemWs !== undefined && rawItemWs.toLowerCase() !== workspaceId.toLowerCase()) {
        throw new ValidationError(
            `Project alias resolved workspace '${rawItemWs}' does not match session workspace '${workspaceId}'.`
        )
    }
    if (itemProjNum !== undefined) pairStoredScope(workspaceId, itemProjNum, reg)
    nextItem['workspace_id'] = workspaceId
}

function resolveBatchItemAliasAndTarget(
    nextItem: Record<string, unknown>,
    batchArrayKey: 'entries' | 'updates',
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext,
    itemAliasDerivedWs: boolean
): { errorResult: Record<string, unknown> } | undefined {
    const { workspaceId, explicitWorkspace, isDefaultWorkspaceName } = ctx
    const itemProjNum =
        typeof nextItem['project_number'] === 'number' && Number.isFinite(nextItem['project_number'])
            ? nextItem['project_number']
            : undefined
    if (itemAliasDerivedWs) {
        applyBatchAliasWorkspaceOverride(nextItem, itemProjNum, reg, ctx)
    }

    const callerItemWs = trimmedStringField(nextItem, 'workspace_id')
    const hasItemWs = callerItemWs !== undefined && !itemAliasDerivedWs
    const itemTargetWs = trimmedStringField(nextItem, 'target_workspace_id')
    if (itemTargetWs === '*') {
        return {
            errorResult: {
                success: false,
                error: "target_workspace_id cannot be '*'. Provide a concrete destination workspace.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: true,
            },
        }
    }
    const itemCrossWsMove =
        itemTargetWs !== undefined &&
        (typeof workspaceId !== 'string' || itemTargetWs.toLowerCase() !== workspaceId.toLowerCase())

    if (itemTargetWs !== undefined && itemProjNum !== undefined) {
        pairStoredScope(itemTargetWs, itemProjNum, reg)
    } else if (callerItemWs !== undefined && callerItemWs !== '*' && !itemCrossWsMove) {
        const wsReg = lookupRegistryEntry(reg, callerItemWs)
        if (itemProjNum !== undefined) {
            pairStoredScope(callerItemWs, itemProjNum, reg)
        } else if (
            hasItemWs &&
            batchArrayKey === 'entries' &&
            !isDefaultWorkspaceName(callerItemWs) &&
            wsReg?.project_number !== undefined &&
            nextItem['project_number'] === undefined
        ) {
            nextItem['project_number'] = wsReg.project_number
        }
    }

    if (
        !itemCrossWsMove &&
        explicitWorkspace === true &&
        !hasItemWs &&
        itemProjNum !== undefined &&
        typeof workspaceId === 'string' &&
        workspaceId !== '*'
    ) {
        pairStoredScope(workspaceId, itemProjNum, reg)
        nextItem['workspace_id'] = workspaceId
    }
    return undefined
}

function applyBatchItemSessionDefaults(
    nextItem: Record<string, unknown>,
    ctx: BatchScopeHelpersContext,
    itemAliasDerivedWs: boolean,
    parentWorkspaceId: unknown,
    batchArrayKey: 'entries' | 'updates'
): void {
    const { projectId, workspaceId, explicitWorkspace, isDefaultWorkspaceName } = ctx
    const callerItemWs =
        typeof nextItem['workspace_id'] === 'string' && nextItem['workspace_id'].trim() !== ''
            ? nextItem['workspace_id'].trim()
            : undefined
    const hasItemWs = callerItemWs !== undefined && !itemAliasDerivedWs
    const hasItemProj = nextItem['project_number'] !== undefined
    const itemTargetWs =
        typeof nextItem['target_workspace_id'] === 'string' && nextItem['target_workspace_id'].trim() !== ''
            ? nextItem['target_workspace_id'].trim()
            : undefined
    const itemCrossWsMove =
        itemTargetWs !== undefined &&
        (typeof workspaceId !== 'string' || itemTargetWs.toLowerCase() !== workspaceId.toLowerCase())
    const parentIsWildcardUpdate =
        batchArrayKey === 'updates' &&
        typeof parentWorkspaceId === 'string' &&
        parentWorkspaceId.trim() === '*' &&
        workspaceId !== '*'

    if (
        !hasItemWs &&
        !hasItemProj &&
        !parentIsWildcardUpdate &&
        workspaceId !== undefined &&
        workspaceId !== '*' &&
        (!isDefaultWorkspaceName(workspaceId) || explicitWorkspace === true)
    ) {
        nextItem['workspace_id'] = workspaceId
    }
    if (
        !itemCrossWsMove &&
        !parentIsWildcardUpdate &&
        nextItem['project_number'] === undefined &&
        typeof projectId === 'number' &&
        (!isDefaultWorkspaceName(callerItemWs) ||
            (isDefaultWorkspaceName(workspaceId) && explicitWorkspace === true)) &&
        (callerItemWs === undefined ||
            (typeof workspaceId === 'string' &&
                callerItemWs.toLowerCase() === workspaceId.toLowerCase()))
    ) {
        nextItem['project_number'] = projectId
    }
    if (
        batchArrayKey === 'entries' &&
        ctx.sessionId !== undefined &&
        ctx.sessionId !== '' &&
        trimmedStringField(nextItem, 'session_id') === undefined
    ) {
        nextItem['session_id'] = ctx.sessionId
    }
}

function verifyBatchWildcardMoveProjects(
    batchArrayKey: 'entries' | 'updates',
    nextItems: readonly unknown[],
    parentWorkspaceId: unknown,
    ctx: BatchScopeHelpersContext
): { errorResult: Record<string, unknown> } | undefined {
    const { projectId, workspaceId, toolName, sessionContext } = ctx
    if (batchArrayKey !== 'updates' || typeof projectId !== 'number') return undefined
    const targetDb = toolName === 'team_batch_update_entries' ? sessionContext?.teamDb : sessionContext?.db
    if (typeof targetDb?.getEntryById !== 'function') return undefined

    const parentWs = typeof parentWorkspaceId === 'string' ? parentWorkspaceId.trim() : undefined
    const wildcardIds: number[] = []
    for (const item of nextItems) {
        if (!isRecord(item)) continue
        const targetWs = trimmedStringField(item, 'target_workspace_id')
        const entryId = item['entry_id']
        if (targetWs === undefined || typeof entryId !== 'number') continue
        const itemWs = trimmedStringField(item, 'workspace_id')
        const effectiveSourceWs = itemWs ?? parentWs ?? workspaceId
        if (effectiveSourceWs === '*' || ctx.isDefaultWorkspaceName(effectiveSourceWs)) {
            wildcardIds.push(entryId)
        }
    }
    if (wildcardIds.length === 0) return undefined

    const prefetched =
        typeof targetDb.getEntriesByIds === 'function'
            ? targetDb.getEntriesByIds(wildcardIds, '*')
            : undefined
    for (const entryId of wildcardIds) {
        const sourceEntry =
            prefetched !== undefined ? prefetched.get(entryId) : targetDb.getEntryById(entryId, '*')
        if (sourceEntry !== null && sourceEntry !== undefined && sourceEntry.projectNumber !== projectId) {
            return {
                errorResult: {
                    success: false,
                    error: `Batch update aborted because entries were not found in the requested project: ${String(entryId)}. No rows were updated.`,
                    code: 'RESOURCE_NOT_FOUND',
                    category: 'resource',
                    recoverable: true,
                },
            }
        }
    }
    return undefined
}

export function normalizeBatchDispatchItems(
    batchArrayKey: 'entries' | 'updates',
    paramsObj: Record<string, unknown>,
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext
): { errorResult: Record<string, unknown> } | undefined {
    const rawItems = paramsObj[batchArrayKey]
    if (!Array.isArray(rawItems)) return undefined
    const parentWorkspaceId = paramsObj['workspace_id']
    const nextItems: unknown[] = []
    for (const item of rawItems) {
        if (!isRecord(item)) {
            nextItems.push(item)
            continue
        }
        const nextItem = { ...item }
        if (typeof nextItem['workspace_id'] === 'string') {
            const trimmedWs = nextItem['workspace_id'].trim()
            if (trimmedWs === '') delete nextItem['workspace_id']
            else nextItem['workspace_id'] = trimmedWs
        }
        if (typeof nextItem['target_workspace_id'] === 'string') {
            const trimmedTarget = nextItem['target_workspace_id'].trim()
            if (trimmedTarget === '') delete nextItem['target_workspace_id']
            else nextItem['target_workspace_id'] = trimmedTarget
        }
        const itemAliasDerivedWs = nextItem['_alias_derived_workspace'] === true
        delete nextItem['_alias_derived_workspace']

        const itemProjErr = ctx.coerceProjectNumberField(nextItem, reg, true)
        if (itemProjErr !== undefined) return itemProjErr

        const aliasErr = resolveBatchItemAliasAndTarget(nextItem, batchArrayKey, reg, ctx, itemAliasDerivedWs)
        if (aliasErr !== undefined) return aliasErr
        applyBatchItemSessionDefaults(
            nextItem,
            ctx,
            itemAliasDerivedWs,
            parentWorkspaceId,
            batchArrayKey
        )
        nextItems.push(nextItem)
    }
    const wildcardErr = verifyBatchWildcardMoveProjects(batchArrayKey, nextItems, parentWorkspaceId, ctx)
    if (wildcardErr !== undefined) return wildcardErr
    paramsObj[batchArrayKey] = nextItems
    return undefined
}
