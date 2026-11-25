/**
 * Monotonic nested RPC override scope-bound validation for Code Mode `secure-dispatcher.ts`.
 */

import type { ToolDefinition } from '../../../types/index.js'
import type { RpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { pairStoredScope, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { cwdMatchesRegistryPath, findCanonicalRegistryKey } from '../../../utils/workspace-registry-match.js'
import {
    checkScopedRepoAndOwnerFields,
    checkToolSpecificRpcBounds,
    collectNestedContainerRecords,
    parsePrefixedProjectInt,
    resolveRegistryEntryProject,
    validationErrResult,
    workspacesConflict,
    type RegistryMap,
} from './dispatch-rpc-bounds-helpers.js'

function checkRecordCwdAgainstRpcBounds(
    rawCwd: unknown,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (typeof rawCwd !== 'string' || rawCwd.trim() === '') return undefined
    const trimmedCwd = rawCwd.trim()
    if (effectivePinnedWs !== undefined) {
        const key = findCanonicalRegistryKey(effectivePinnedWs, registry) ?? effectivePinnedWs
        const pinnedPath = registry?.[key]?.path
        if (pinnedPath === undefined || pinnedPath.trim() === '' || !cwdMatchesRegistryPath(pinnedPath, trimmedCwd)) {
            return validationErrResult(`cwd '${trimmedCwd}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`)
        }
        return undefined
    }
    if (pinnedProj !== undefined) {
        if (registry === undefined) {
            return validationErrResult(
                `cwd '${trimmedCwd}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
        const matchesProjectPath = Object.values(registry).some(
            (entry) =>
                entry.project_number === pinnedProj &&
                entry.path !== undefined &&
                entry.path.trim() !== '' &&
                cwdMatchesRegistryPath(entry.path, trimmedCwd)
        )
        if (!matchesProjectPath) {
            return validationErrResult(
                `cwd '${trimmedCwd}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
    }
    return undefined
}

function checkRecordWorkspaceAgainstPinnedProj(
    rec: Record<string, unknown>,
    pinnedProj: number,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    for (const key of ['workspace_id', 'target_workspace_id', 'workspace', 'repo', 'repo_name', 'repository'] as const) {
        const raw = rec[key]
        if (typeof raw !== 'string') continue
        const trimmed = raw.trim()
        if (trimmed === '' || trimmed === '*') continue
        if (trimmed.toLowerCase() === 'default') {
            return validationErrResult(
                `${key} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
        const { projectNumber } = resolveRegistryEntryProject(trimmed, registry)
        if (projectNumber !== pinnedProj) {
            return validationErrResult(
                `${key} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
    }
    return undefined
}

function checkProjectNumAgainstPinnedWorkspace(
    num: number,
    fieldName: string,
    effectivePinnedWs: string,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (!Number.isSafeInteger(num) || num <= 0) {
        return validationErrResult(
            `${fieldName} ${String(num)} conflicts with nested executeCode scope '${effectivePinnedWs}'.`
        )
    }
    try {
        pairStoredScope(effectivePinnedWs, num, registry)
        return undefined
    } catch (err) {
        return validationErrResult(err instanceof Error ? err.message : String(err))
    }
}

function checkRecordProjectAliasAgainstBounds(
    rawProject: unknown,
    fieldName: string,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (typeof rawProject === 'number') {
        if (Number.isFinite(rawProject)) {
            if (pinnedProj !== undefined && rawProject !== pinnedProj) {
                return validationErrResult(
                    `${fieldName} ${String(rawProject)} conflicts with nested executeCode project_number ${String(pinnedProj)}.`
                )
            }
            if (effectivePinnedWs !== undefined && pinnedProj === undefined) {
                return checkProjectNumAgainstPinnedWorkspace(rawProject, fieldName, effectivePinnedWs, registry)
            }
        }
        return undefined
    }
    if (typeof rawProject !== 'string') return undefined
    const trimmed = rawProject.trim()
    if (trimmed === '') return undefined
    if (trimmed === '*') {
        return effectivePinnedWs !== undefined
            ? validationErrResult(`${fieldName} '*' is not allowed inside nested executeCode scope '${effectivePinnedWs}'.`)
            : undefined
    }
    if (/^[+-]?\d+$/.test(trimmed) || /^[p#]-?\d+$/i.test(trimmed)) {
        const parsed = parsePrefixedProjectInt(trimmed)
        if (pinnedProj !== undefined && parsed !== pinnedProj) {
            return validationErrResult(
                `${fieldName} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
        if (effectivePinnedWs !== undefined && pinnedProj === undefined) {
            if (parsed === undefined) {
                return validationErrResult(
                    `${fieldName} '${trimmed}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
                )
            }
            return checkProjectNumAgainstPinnedWorkspace(parsed, fieldName, effectivePinnedWs, registry)
        }
        return undefined
    }
    if (effectivePinnedWs !== undefined && workspacesConflict(trimmed, effectivePinnedWs, registry)) {
        return validationErrResult(
            `${fieldName} '${trimmed}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
        )
    }
    if (pinnedProj !== undefined) {
        if (trimmed.toLowerCase() === 'default' || resolveRegistryEntryProject(trimmed, registry).projectNumber !== pinnedProj) {
            return validationErrResult(
                `${fieldName} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
    }
    return undefined
}

function checkSinglePinnedProjectNumValue(
    rawProj: unknown,
    fieldName: string,
    pinnedProj: number,
    registry: RegistryMap
): { resolved: number | undefined } | Record<string, unknown> {
    if (rawProj === null) {
        return validationErrResult(
            `${fieldName} cannot be cleared (null) inside nested executeCode pinned to project_number ${String(pinnedProj)}.`
        )
    }
    if (typeof rawProj === 'number') {
        if (Number.isFinite(rawProj) && rawProj !== pinnedProj) {
            return validationErrResult(
                `${fieldName} ${String(rawProj)} conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
        return { resolved: rawProj }
    }
    if (typeof rawProj !== 'string') return { resolved: undefined }
    const trimmed = rawProj.trim()
    if (trimmed === '') return { resolved: undefined }
    const parsedInt = parsePrefixedProjectInt(trimmed)
    if (parsedInt !== undefined) {
        if (parsedInt !== pinnedProj) {
            return validationErrResult(
                `${fieldName} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
        return { resolved: parsedInt }
    }
    const regProj =
        trimmed.toLowerCase() === 'default'
            ? undefined
            : resolveRegistryEntryProject(trimmed, registry).projectNumber
    if (regProj !== pinnedProj) {
        return validationErrResult(
            `${fieldName} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`
        )
    }
    return { resolved: regProj }
}

function checkPinnedProjectNumberField(
    rec: Record<string, unknown>,
    pinnedProj: number,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    let matchedPinned = false
    for (const fieldName of ['project_number', 'projectNumber', 'project_id', 'projectId'] as const) {
        if (rec[fieldName] === undefined) continue
        const checkRes = checkSinglePinnedProjectNumValue(rec[fieldName], fieldName, pinnedProj, registry)
        if (!('resolved' in checkRes)) return checkRes
        if (checkRes.resolved === pinnedProj) matchedPinned = true
    }
    const rawWs =
        typeof rec['workspace_id'] === 'string'
            ? rec['workspace_id'].trim()
            : typeof rec['workspace'] === 'string'
              ? rec['workspace'].trim()
              : undefined
    if (rawWs === '*' && !matchedPinned) {
        return validationErrResult(
            `workspace_id '*' requires project_number ${String(pinnedProj)} inside nested executeCode.`
        )
    }
    return undefined
}

function checkPinnedWorkspaceProjectNumberField(
    rawProj: unknown,
    fieldName: string,
    effectivePinnedWs: string,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (typeof rawProj === 'number' && Number.isFinite(rawProj)) {
        return checkProjectNumAgainstPinnedWorkspace(rawProj, fieldName, effectivePinnedWs, registry)
    }
    if (typeof rawProj !== 'string') return undefined
    const trimmed = rawProj.trim()
    if (trimmed === '') return undefined
    if (/^[+-]?\d+$/.test(trimmed) || /^[p#]-?\d+$/i.test(trimmed)) {
        const parsedInt = parsePrefixedProjectInt(trimmed)
        if (parsedInt === undefined) {
            return validationErrResult(
                `${fieldName} '${trimmed}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
            )
        }
        return checkProjectNumAgainstPinnedWorkspace(parsedInt, fieldName, effectivePinnedWs, registry)
    }
    if (trimmed !== '*' && workspacesConflict(trimmed, effectivePinnedWs, registry)) {
        return validationErrResult(
            `${fieldName} '${trimmed}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
        )
    }
    return undefined
}

function checkRecordAgainstRpcBounds(
    rec: Record<string, unknown>,
    pinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    const effectivePinnedWs =
        pinnedWs ?? (pinnedProj !== undefined ? uniqueWorkspaceForProject(pinnedProj, registry) : undefined)
    if (effectivePinnedWs !== undefined) {
        for (const wsKey of ['workspace_id', 'target_workspace_id', 'workspace'] as const) {
            const rawWs = rec[wsKey]
            if (typeof rawWs !== 'string') continue
            const trimmed = rawWs.trim()
            if (trimmed === '*') {
                return validationErrResult(
                    `${wsKey} '*' is not allowed inside nested executeCode scope '${effectivePinnedWs}'.`
                )
            }
            if (trimmed !== '' && workspacesConflict(trimmed, effectivePinnedWs, registry)) {
                return validationErrResult(
                    `${wsKey} '${trimmed}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
                )
            }
        }
        const repoErr = checkScopedRepoAndOwnerFields(rec, effectivePinnedWs, registry)
        if (repoErr !== undefined) return repoErr
    }
    for (const projAliasKey of ['project', 'project_name', 'projectName'] as const) {
        const projAliasErr = checkRecordProjectAliasAgainstBounds(
            rec[projAliasKey], projAliasKey, effectivePinnedWs, pinnedProj, registry
        )
        if (projAliasErr !== undefined) return projAliasErr
    }
    const cwdErr = checkRecordCwdAgainstRpcBounds(rec['cwd'], effectivePinnedWs, pinnedProj, registry)
    if (cwdErr !== undefined) return cwdErr

    if (pinnedProj !== undefined) {
        const wsProjErr = checkRecordWorkspaceAgainstPinnedProj(rec, pinnedProj, registry)
        if (wsProjErr !== undefined) return wsProjErr
        const pnErr = checkPinnedProjectNumberField(rec, pinnedProj, registry)
        if (pnErr !== undefined) return pnErr
    } else if (effectivePinnedWs !== undefined) {
        for (const pnKey of ['project_number', 'projectNumber', 'project_id', 'projectId'] as const) {
            const wsProjErr = checkPinnedWorkspaceProjectNumberField(rec[pnKey], pnKey, effectivePinnedWs, registry)
            if (wsProjErr !== undefined) return wsProjErr
        }
    }
    return undefined
}

/** Resolves monotonic effective scope from outer session bounds plus nested RPC overrides. */
export function resolveEffectiveRpcScope(
    outer: { workspaceId: string | undefined; projectId: number | string | undefined; explicitWorkspace?: boolean | undefined; sessionId?: string | undefined },
    rpcOverrides: RpcExecutionOverrides | undefined,
    registry: RegistryMap
):
    | { effectiveWorkspaceId: string | undefined; effectiveProjectId: number | string | undefined; effectiveExplicitWorkspace: boolean | undefined; effectiveSessionId: string | undefined; effectiveUseSessionIdInCtx: string | undefined }
    | { errorResult: Record<string, unknown> } {
    const { workspaceId, projectId, explicitWorkspace, sessionId } = outer
    const outerCanNarrow = workspaceId === undefined || workspaceId === '*'
    const overrideWs = rpcOverrides?.workspaceId?.trim()
    const hasConcreteOverrideWs = overrideWs !== undefined && overrideWs !== '' && overrideWs !== '*'

    if (!outerCanNarrow && hasConcreteOverrideWs && workspaceId !== undefined && workspacesConflict(overrideWs, workspaceId, registry)) {
        return { errorResult: validationErrResult(`Nested executeCode workspace '${overrideWs}' conflicts with pinned outer workspace '${workspaceId}'.`) }
    }
    if (typeof projectId === 'number' && rpcOverrides?.projectNumber !== undefined && rpcOverrides.projectNumber !== projectId) {
        return { errorResult: validationErrResult(`Nested executeCode project_number ${String(rpcOverrides.projectNumber)} conflicts with pinned outer project_number ${String(projectId)}.`) }
    }

    const effectiveProjectId =
        projectId === undefined && rpcOverrides?.projectNumber !== undefined
            ? rpcOverrides.projectNumber
            : projectId
    const derivedOverrideWs =
        !hasConcreteOverrideWs &&
        outerCanNarrow &&
        typeof effectiveProjectId === 'number' &&
        rpcOverrides?.projectNumber !== undefined
            ? uniqueWorkspaceForProject(effectiveProjectId, registry)
            : undefined
    const effectiveWorkspaceId = outerCanNarrow && hasConcreteOverrideWs
        ? overrideWs
        : derivedOverrideWs ?? workspaceId
    if (
        typeof effectiveProjectId === 'number' &&
        typeof effectiveWorkspaceId === 'string' &&
        effectiveWorkspaceId !== '*' &&
        (rpcOverrides?.projectNumber !== undefined || hasConcreteOverrideWs)
    ) {
        try {
            pairStoredScope(effectiveWorkspaceId, effectiveProjectId, registry)
        } catch (err) {
            return { errorResult: validationErrResult(err instanceof Error ? err.message : String(err)) }
        }
    }
    const effectiveExplicitWorkspace = hasConcreteOverrideWs || effectiveWorkspaceId !== workspaceId ? true : explicitWorkspace
    const effectiveSessionId =
        rpcOverrides?.sessionId !== undefined && rpcOverrides.sessionId.trim() !== ''
            ? rpcOverrides.sessionId.trim()
            : sessionId
    return {
        effectiveWorkspaceId,
        effectiveProjectId,
        effectiveExplicitWorkspace,
        effectiveSessionId,
        effectiveUseSessionIdInCtx: effectiveSessionId,
    }
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value)
}

function promoteBatchAliasIfNeeded(
    paramsObj: Record<string, unknown>,
    canonicalKey: 'entries' | 'updates',
    aliasKeys: readonly ('items' | 'entries')[],
    promoteAlias: boolean
): unknown[] | undefined {
    const existing = paramsObj[canonicalKey]
    if (isUnknownArray(existing)) return existing
    if (existing !== undefined) return undefined
    for (const aliasKey of aliasKeys) {
        const candidate = paramsObj[aliasKey]
        if (isUnknownArray(candidate)) {
            if (promoteAlias) {
                paramsObj[canonicalKey] = candidate
                Reflect.deleteProperty(paramsObj, aliasKey)
            }
            return candidate
        }
    }
    return undefined
}

/** Resolve batch array items (or canonical key with alias promotion when explicit canonical key is undefined). */
export function resolveBatchItemsForBounds(
    toolName: string,
    paramsObj: Record<string, unknown>,
    promoteAlias = false
): { key: 'entries' | 'updates'; items: unknown[] } | undefined {
    if (toolName === 'batch_create_entries' || toolName === 'team_batch_create_entries') {
        const items = promoteBatchAliasIfNeeded(paramsObj, 'entries', ['items'], promoteAlias)
        return items !== undefined ? { key: 'entries', items } : undefined
    }
    if (toolName === 'batch_update_entries' || toolName === 'team_batch_update_entries') {
        const items = promoteBatchAliasIfNeeded(paramsObj, 'updates', ['items', 'entries'], promoteAlias)
        return items !== undefined ? { key: 'updates', items } : undefined
    }
    return undefined
}

/**
 * Ensures nested `mj.executeCode` RPC overrides act as monotonic scope bounds that cannot be
 * widened by explicit tool or batch-item parameters.
 */
export function validateRpcOverrideBounds(
    tool: ToolDefinition,
    normalizedParams: unknown,
    rpcOverrides: RpcExecutionOverrides | undefined,
    registry: RegistryMap
): Record<string, unknown> | undefined {
    if (rpcOverrides === undefined || !isRecord(normalizedParams)) return undefined
    const rawWs = rpcOverrides.workspaceId?.trim()
    const pinnedWs = rawWs !== undefined && rawWs !== '' && rawWs !== '*' ? rawWs : undefined
    const pinnedProj = rpcOverrides.projectNumber
    if (pinnedWs === undefined && pinnedProj === undefined) return undefined

    const effectivePinnedWs =
        pinnedWs ?? (pinnedProj !== undefined ? uniqueWorkspaceForProject(pinnedProj, registry) : undefined)
    for (const candidate of [normalizedParams, ...collectNestedContainerRecords(normalizedParams)]) {
        const toolErr = checkToolSpecificRpcBounds(tool.name, candidate, effectivePinnedWs, pinnedProj, registry)
        if (toolErr !== undefined) return toolErr

        const recErr = checkRecordAgainstRpcBounds(candidate, pinnedWs, pinnedProj, registry)
        if (recErr !== undefined) return recErr
    }

    const resolvedBatch = resolveBatchItemsForBounds(tool.name, normalizedParams)
    if (resolvedBatch !== undefined) {
        for (const item of resolvedBatch.items) {
            if (!isRecord(item)) continue
            for (const candidate of [item, ...collectNestedContainerRecords(item)]) {
                const itemErr = checkRecordAgainstRpcBounds(candidate, pinnedWs, pinnedProj, registry)
                if (itemErr !== undefined) return itemErr
            }
        }
    }
    return undefined
}
