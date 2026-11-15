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
    isDefaultWorkspaceName: (value: unknown) => boolean
    coerceProjectNumberField: (
        obj: Record<string, unknown>,
        registry: NonNullable<ToolContext['config']>['projectRegistry']
    ) => { errorResult: Record<string, unknown> } | undefined
}

function resolveBatchItemAliasAndTarget(
    nextItem: Record<string, unknown>,
    batchArrayKey: 'entries' | 'updates',
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext,
    itemAliasDerivedWs: boolean
): void {
    const { workspaceId, explicitWorkspace, isDefaultWorkspaceName } = ctx
    const rawItemWs =
        typeof nextItem['workspace_id'] === 'string' && nextItem['workspace_id'].trim() !== ''
            ? nextItem['workspace_id'].trim()
            : undefined
    const itemProjNum =
        typeof nextItem['project_number'] === 'number' && Number.isFinite(nextItem['project_number'])
            ? nextItem['project_number']
            : undefined

    if (
        itemAliasDerivedWs &&
        explicitWorkspace === true &&
        typeof workspaceId === 'string' &&
        workspaceId !== '*'
    ) {
        if (rawItemWs !== undefined && rawItemWs.toLowerCase() !== workspaceId.toLowerCase()) {
            throw new ValidationError(
                `Project alias resolved workspace '${rawItemWs}' does not match session workspace '${workspaceId}'.`
            )
        }
        if (itemProjNum !== undefined) pairStoredScope(workspaceId, itemProjNum, reg)
        nextItem['workspace_id'] = workspaceId
    }

    const callerItemWs =
        typeof nextItem['workspace_id'] === 'string' && nextItem['workspace_id'].trim() !== ''
            ? nextItem['workspace_id'].trim()
            : undefined
    const hasItemWs = callerItemWs !== undefined && !itemAliasDerivedWs
    const itemTargetWs =
        typeof nextItem['target_workspace_id'] === 'string' && nextItem['target_workspace_id'].trim() !== ''
            ? nextItem['target_workspace_id'].trim()
            : undefined
    const itemCrossWsMove =
        itemTargetWs !== undefined &&
        (typeof workspaceId !== 'string' || itemTargetWs.toLowerCase() !== workspaceId.toLowerCase())

    if (itemTargetWs !== undefined && itemProjNum !== undefined) {
        pairStoredScope(itemTargetWs, itemProjNum, reg)
    } else if (hasItemWs && callerItemWs !== '*' && !itemCrossWsMove) {
        const wsReg = lookupRegistryEntry(reg, callerItemWs)
        if (itemProjNum !== undefined) {
            pairStoredScope(callerItemWs, itemProjNum, reg)
        } else if (
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
}

function applyBatchItemSessionDefaults(
    nextItem: Record<string, unknown>,
    ctx: BatchScopeHelpersContext,
    itemAliasDerivedWs: boolean
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

    if (
        !hasItemWs &&
        !hasItemProj &&
        workspaceId !== undefined &&
        workspaceId !== '*' &&
        (!isDefaultWorkspaceName(workspaceId) || explicitWorkspace === true)
    ) {
        nextItem['workspace_id'] = workspaceId
    }
    if (
        !itemCrossWsMove &&
        nextItem['project_number'] === undefined &&
        typeof projectId === 'number' &&
        !isDefaultWorkspaceName(callerItemWs) &&
        (callerItemWs === undefined ||
            (typeof workspaceId === 'string' &&
                callerItemWs.toLowerCase() === workspaceId.toLowerCase()))
    ) {
        nextItem['project_number'] = projectId
    }
}

export function normalizeBatchDispatchItems(
    batchArrayKey: 'entries' | 'updates',
    paramsObj: Record<string, unknown>,
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext
): { errorResult: Record<string, unknown> } | undefined {
    const nextItems: unknown[] = []
    for (const item of paramsObj[batchArrayKey] as unknown[]) {
        if (!isRecord(item)) {
            nextItems.push(item)
            continue
        }
        const nextItem = { ...item }
        const itemAliasDerivedWs = nextItem['_alias_derived_workspace'] === true
        delete nextItem['_alias_derived_workspace']

        const itemProjErr = ctx.coerceProjectNumberField(nextItem, reg)
        if (itemProjErr !== undefined) return itemProjErr

        resolveBatchItemAliasAndTarget(nextItem, batchArrayKey, reg, ctx, itemAliasDerivedWs)
        applyBatchItemSessionDefaults(nextItem, ctx, itemAliasDerivedWs)
        nextItems.push(nextItem)
    }
    paramsObj[batchArrayKey] = nextItems
    return undefined
}
