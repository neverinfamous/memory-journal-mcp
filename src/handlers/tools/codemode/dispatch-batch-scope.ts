/**
 * Per-item batch parameter normalization helpers for Code Mode dispatch scope enforcement.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-resolver.js'
import { pairStoredScope } from '../../../utils/write-scope.js'
import { resolveBatchItemsForBounds } from './dispatch-rpc-bounds.js'
import { lookupRegistryEntry } from './session-context.js'
export {
    buildPostRbacSideEffects,
    verifyWildcardUpdateSourceProject,
} from './dispatch-batch-wildcard.js'

export interface BatchScopeHelpersContext {
    projectId: number | string | undefined
    workspaceId: string | undefined
    explicitWorkspace?: boolean | undefined
    sessionId?: string | undefined
    toolName?: string | undefined
    sessionContext?: ToolContext | undefined
    deferWildcardCheck?: boolean | undefined
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

function trimmedRepoField(obj: Record<string, unknown>): string | undefined {
    for (const key of ['repo', 'repo_name', 'repoName', 'repository']) {
        const val = trimmedStringField(obj, key)
        if (val !== undefined) return val
    }
    return undefined
}

function resolveBatchItemRepoKey(
    rawRepo: string,
    reg: NonNullable<ToolContext['config']>['projectRegistry']
): string | undefined {
    if (!reg) return undefined
    const direct = findCanonicalRegistryKey(rawRepo, reg)
    if (direct !== undefined) return direct
    if (/[/\\]/.test(rawRepo)) {
        const leaf = rawRepo.split(/[/\\]/).filter(Boolean).pop()?.trim() ?? ''
        if (leaf !== '') return findCanonicalRegistryKey(leaf, reg)
    }
    return undefined
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

function pairBatchItemWorkspaceProject(
    nextItem: Record<string, unknown>,
    batchArrayKey: 'entries' | 'updates',
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext,
    hasItemWs: boolean,
    itemCrossWsMove: boolean,
    itemProjNum: number | undefined
): void {
    const callerItemWs = trimmedStringField(nextItem, 'workspace_id')
    const itemTargetWs = trimmedStringField(nextItem, 'target_workspace_id')
    if (itemTargetWs !== undefined && itemProjNum !== undefined) {
        pairStoredScope(itemTargetWs, itemProjNum, reg)
    } else if (callerItemWs !== undefined && callerItemWs !== '*' && !itemCrossWsMove) {
        const wsReg = lookupRegistryEntry(reg, callerItemWs)
        if (itemProjNum !== undefined) {
            pairStoredScope(callerItemWs, itemProjNum, reg)
        } else if (
            hasItemWs &&
            batchArrayKey === 'entries' &&
            !ctx.isDefaultWorkspaceName(callerItemWs) &&
            wsReg?.project_number !== undefined &&
            nextItem['project_number'] === undefined
        ) {
            nextItem['project_number'] = wsReg.project_number
        }
    }
    if (
        !itemCrossWsMove &&
        ctx.explicitWorkspace === true &&
        !hasItemWs &&
        itemProjNum !== undefined &&
        typeof ctx.workspaceId === 'string' &&
        ctx.workspaceId !== '*'
    ) {
        pairStoredScope(ctx.workspaceId, itemProjNum, reg)
        nextItem['workspace_id'] = ctx.workspaceId
    }
}

interface ParentBatchScope {
    parentWs: string | undefined
    parentProjectNumber: number | undefined
    overridesSessionScope: boolean
}

function computeParentBatchScope(
    parentWorkspaceId: unknown,
    parentProjectNumber: unknown,
    ctx: BatchScopeHelpersContext,
    batchArrayKey: 'entries' | 'updates'
): ParentBatchScope {
    const parentWs =
        typeof parentWorkspaceId === 'string' && parentWorkspaceId.trim() !== ''
            ? parentWorkspaceId.trim()
            : undefined
    const parentProj =
        typeof parentProjectNumber === 'number' && Number.isFinite(parentProjectNumber)
            ? parentProjectNumber
            : undefined
    const isWildcardUpdate =
        batchArrayKey === 'updates' && parentWs === '*' && ctx.workspaceId !== '*'
    const overridesSessionScope =
        isWildcardUpdate ||
        (parentWs !== undefined &&
            parentWs !== '*' &&
            (typeof ctx.workspaceId !== 'string' ||
                parentWs.toLowerCase() !== ctx.workspaceId.toLowerCase())) ||
        (parentProj !== undefined &&
            (typeof ctx.projectId !== 'number' || parentProj !== ctx.projectId))
    return { parentWs, parentProjectNumber: parentProj, overridesSessionScope }
}

function isCrossWorkspaceBatchItemMove(
    itemTargetWs: string | undefined,
    callerItemWs: string | undefined,
    parentScope: ParentBatchScope,
    ctx: BatchScopeHelpersContext
): boolean {
    if (itemTargetWs === undefined) return false
    const effectiveSourceWs =
        callerItemWs ??
        (parentScope.parentWs !== '*' ? parentScope.parentWs : undefined) ??
        (ctx.workspaceId !== '*' ? ctx.workspaceId : undefined)
    return itemTargetWs.toLowerCase() !== effectiveSourceWs?.toLowerCase()
}

function resolveBatchItemAliasAndTarget(
    nextItem: Record<string, unknown>,
    batchArrayKey: 'entries' | 'updates',
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: BatchScopeHelpersContext,
    itemAliasDerivedWs: boolean,
    parentScope: ParentBatchScope
): { errorResult: Record<string, unknown> } | undefined {
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
    const itemCrossWsMove = isCrossWorkspaceBatchItemMove(itemTargetWs, callerItemWs, parentScope, ctx)
    pairBatchItemWorkspaceProject(
        nextItem, batchArrayKey, reg, ctx, hasItemWs, itemCrossWsMove, itemProjNum
    )
    return undefined
}

function shouldApplyBatchItemDefaultProject(
    nextItem: Record<string, unknown>,
    ctx: BatchScopeHelpersContext,
    callerItemWs: string | undefined,
    callerItemRepo: string | undefined,
    itemCrossWsMove: boolean,
    parentOverridesSessionScope: boolean
): boolean {
    if (
        itemCrossWsMove ||
        parentOverridesSessionScope ||
        nextItem['project_number'] !== undefined ||
        typeof ctx.projectId !== 'number'
    ) {
        return false
    }
    const defaultWsAllowed =
        !ctx.isDefaultWorkspaceName(callerItemWs) ||
        (ctx.isDefaultWorkspaceName(ctx.workspaceId) && ctx.explicitWorkspace === true)
    const wsMatchesParent =
        (callerItemWs === undefined && callerItemRepo === undefined) ||
        (typeof ctx.workspaceId === 'string' &&
            callerItemWs?.toLowerCase() === ctx.workspaceId.toLowerCase())
    return defaultWsAllowed && wsMatchesParent
}

function applyBatchItemSessionDefaults(
    nextItem: Record<string, unknown>,
    ctx: BatchScopeHelpersContext,
    itemAliasDerivedWs: boolean,
    parentScope: ParentBatchScope,
    batchArrayKey: 'entries' | 'updates'
): void {
    const { projectId, workspaceId, explicitWorkspace, isDefaultWorkspaceName } = ctx
    const callerItemWs = trimmedStringField(nextItem, 'workspace_id')
    const callerItemRepo = trimmedRepoField(nextItem)
    const hasItemWs = (callerItemWs !== undefined && !itemAliasDerivedWs) || callerItemRepo !== undefined
    const itemTargetWs = trimmedStringField(nextItem, 'target_workspace_id')
    const itemCrossWsMove = isCrossWorkspaceBatchItemMove(itemTargetWs, callerItemWs, parentScope, ctx)

    if (
        !hasItemWs &&
        nextItem['project_number'] === undefined &&
        !parentScope.overridesSessionScope &&
        workspaceId !== undefined &&
        workspaceId !== '*' &&
        (!isDefaultWorkspaceName(workspaceId) || explicitWorkspace === true)
    ) {
        nextItem['workspace_id'] = workspaceId
    }
    if (
        shouldApplyBatchItemDefaultProject(
            nextItem,
            ctx,
            callerItemWs,
            callerItemRepo,
            itemCrossWsMove,
            parentScope.overridesSessionScope
        ) &&
        typeof projectId === 'number'
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

export function parseCanonicalMoveEntryId(record: Record<string, unknown>): number | undefined {
    const raw = record['entry_id'] ?? record['entryId'] ?? record['id']
    if (typeof raw === 'number') {
        return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined
    }
    if (typeof raw !== 'string') return undefined
    const trimmed = raw.trim()
    const stripped = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed
    if (!/^[1-9]\d*$/.test(stripped)) return undefined
    const parsed = Number(stripped)
    return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === stripped
        ? parsed
        : undefined
}

export function verifyBatchWildcardMoveProjects(
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
        if (targetWs === undefined) continue
        const itemWs = trimmedStringField(item, 'workspace_id')
        const effectiveSourceWs = itemWs ?? parentWs ?? workspaceId
        if (effectiveSourceWs === '*' || ctx.isDefaultWorkspaceName(effectiveSourceWs)) {
            const entryId = parseCanonicalMoveEntryId(item)
            if (entryId === undefined) {
                return {
                    errorResult: {
                        success: false,
                        error: 'Cross-workspace batch move from wildcard/default source requires a valid positive integer entry_id.',
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    },
                }
            }
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
    const parentScope = computeParentBatchScope(
        parentWorkspaceId,
        paramsObj['project_number'],
        ctx,
        batchArrayKey
    )
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
        if (nextItem['workspace_id'] === undefined) {
            const rawRepo = trimmedRepoField(nextItem)
            const matchedRepoWs = rawRepo !== undefined ? resolveBatchItemRepoKey(rawRepo, reg) : undefined
            if (matchedRepoWs !== undefined) nextItem['workspace_id'] = matchedRepoWs
        }

        const itemProjErr = ctx.coerceProjectNumberField(nextItem, reg, true)
        if (itemProjErr !== undefined) return itemProjErr

        const aliasErr = resolveBatchItemAliasAndTarget(
            nextItem, batchArrayKey, reg, ctx, itemAliasDerivedWs, parentScope
        )
        if (aliasErr !== undefined) return aliasErr
        applyBatchItemSessionDefaults(
            nextItem,
            ctx,
            itemAliasDerivedWs,
            parentScope,
            batchArrayKey
        )
        nextItems.push(nextItem)
    }
    if (ctx.deferWildcardCheck !== true) {
        const wildcardErr = verifyBatchWildcardMoveProjects(batchArrayKey, nextItems, parentWorkspaceId, ctx)
        if (wildcardErr !== undefined) return wildcardErr
    }
    paramsObj[batchArrayKey] = nextItems
    return undefined
}

export function prepareBatchDispatch(
    tool: ToolDefinition,
    paramsObj: Record<string, unknown>,
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    baseCtx: Omit<BatchScopeHelpersContext, 'sessionId' | 'toolName' | 'deferWildcardCheck'> & {
        sessionId: string | undefined
    }
):
    | { batchArrayKey?: 'entries' | 'updates'; batchCtx?: BatchScopeHelpersContext }
    | { errorResult: Record<string, unknown> } {
    const batchArrayKey = resolveBatchItemsForBounds(tool.name, paramsObj, true)?.key
    if (batchArrayKey === undefined) return {}
    if (
        batchArrayKey === 'updates' &&
        paramsObj['project_number'] === undefined &&
        typeof baseCtx.projectId === 'number' &&
        (paramsObj['workspace_id'] === '*' || (paramsObj['workspace_id'] === undefined && baseCtx.workspaceId === '*'))
    ) {
        paramsObj['project_number'] = baseCtx.projectId
    }
    const effectiveBatchSessionId = trimmedStringField(paramsObj, 'session_id') ?? baseCtx.sessionId
    const batchCtx: BatchScopeHelpersContext = {
        ...baseCtx, sessionId: effectiveBatchSessionId, toolName: tool.name, deferWildcardCheck: true,
    }
    const batchError = normalizeBatchDispatchItems(batchArrayKey, paramsObj, reg, batchCtx)
    return batchError ?? { batchArrayKey, batchCtx }
}
