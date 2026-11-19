/**
 * Monotonic nested RPC override scope-bound validation for Code Mode `secure-dispatcher.ts`.
 */

import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import type { RpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { pairStoredScope, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { cwdMatchesRegistryPath, findCanonicalRegistryKey } from '../../../utils/workspace-registry-match.js'

function validationErrResult(error: string): Record<string, unknown> {
    return {
        success: false,
        error,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

function workspacesConflict(
    explicitWs: string,
    pinnedWs: string,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): boolean {
    const canonExplicit = findCanonicalRegistryKey(explicitWs, registry) ?? explicitWs
    const canonPinned = findCanonicalRegistryKey(pinnedWs, registry) ?? pinnedWs
    return canonExplicit.toLowerCase() !== canonPinned.toLowerCase()
}

function resolveRegistryEntryProject(
    keyOrRepo: string,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): { matchedKey: string | undefined; projectNumber: number | undefined } {
    if (registry === undefined) return { matchedKey: undefined, projectNumber: undefined }
    const direct = findCanonicalRegistryKey(keyOrRepo, registry)
    if (direct !== undefined) {
        return { matchedKey: direct, projectNumber: registry[direct]?.project_number }
    }
    const slug = keyOrRepo.split(/[/\\]/).filter(Boolean).pop()
    const slugKey = slug !== undefined && slug !== '' ? findCanonicalRegistryKey(slug, registry) : undefined
    return {
        matchedKey: slugKey,
        projectNumber: slugKey !== undefined ? registry[slugKey]?.project_number : undefined,
    }
}

function checkRecordCwdAgainstRpcBounds(
    rawCwd: unknown,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
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
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): Record<string, unknown> | undefined {
    for (const key of ['workspace_id', 'target_workspace_id', 'repo', 'repo_name'] as const) {
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

function checkRecordAgainstRpcBounds(
    rec: Record<string, unknown>,
    pinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): Record<string, unknown> | undefined {
    const effectivePinnedWs =
        pinnedWs ?? (pinnedProj !== undefined ? uniqueWorkspaceForProject(pinnedProj, registry) : undefined)
    if (effectivePinnedWs !== undefined) {
        for (const wsKey of ['workspace_id', 'target_workspace_id'] as const) {
            const rawWs = rec[wsKey]
            if (typeof rawWs === 'string') {
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
        }
        for (const repoKey of ['repo', 'repo_name'] as const) {
            const rawRepo = rec[repoKey]
            if (typeof rawRepo === 'string' && rawRepo.trim() !== '') {
                const trimmedRepo = rawRepo.trim()
                const repoSlug = trimmedRepo.split(/[/\\]/).filter(Boolean).pop() ?? trimmedRepo
                const resolvedRepo =
                    findCanonicalRegistryKey(trimmedRepo, registry) ??
                    findCanonicalRegistryKey(repoSlug, registry) ??
                    repoSlug
                if (workspacesConflict(resolvedRepo, effectivePinnedWs, registry)) {
                    return validationErrResult(
                        `${repoKey} '${trimmedRepo}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
                    )
                }
            }
        }
    }
    const cwdErr = checkRecordCwdAgainstRpcBounds(rec['cwd'], effectivePinnedWs, pinnedProj, registry)
    if (cwdErr !== undefined) return cwdErr

    if (pinnedProj !== undefined) {
        const wsProjErr = checkRecordWorkspaceAgainstPinnedProj(rec, pinnedProj, registry)
        if (wsProjErr !== undefined) return wsProjErr
        const rawProj = rec['project_number']
        if (typeof rawProj === 'number' && Number.isFinite(rawProj) && rawProj !== pinnedProj) {
            return validationErrResult(
                `project_number ${String(rawProj)} conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
        if (
            typeof rec['workspace_id'] === 'string' &&
            rec['workspace_id'].trim() === '*' &&
            rawProj !== pinnedProj
        ) {
            return validationErrResult(
                `workspace_id '*' requires project_number ${String(pinnedProj)} inside nested executeCode.`
            )
        }
    }
    return undefined
}

/** Resolves monotonic effective scope from outer session bounds plus nested RPC overrides. */
export function resolveEffectiveRpcScope(
    outer: { workspaceId: string | undefined; projectId: number | string | undefined; explicitWorkspace?: boolean | undefined; sessionId?: string | undefined },
    rpcOverrides: RpcExecutionOverrides | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
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
    if (!outerCanNarrow && typeof projectId === 'number' && rpcOverrides?.projectNumber !== undefined && rpcOverrides.projectNumber !== projectId) {
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
        !outerCanNarrow &&
        projectId === undefined &&
        typeof rpcOverrides?.projectNumber === 'number' &&
        typeof effectiveWorkspaceId === 'string' &&
        effectiveWorkspaceId !== '*'
    ) {
        try {
            pairStoredScope(effectiveWorkspaceId, rpcOverrides.projectNumber, registry)
        } catch (err) {
            return { errorResult: validationErrResult(err instanceof Error ? err.message : String(err)) }
        }
    }
    const effectiveExplicitWorkspace = effectiveWorkspaceId !== workspaceId ? true : explicitWorkspace
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

/**
 * Ensures nested `mj.executeCode` RPC overrides act as monotonic scope bounds that cannot be
 * widened by explicit tool or batch-item parameters.
 */
export function validateRpcOverrideBounds(
    tool: ToolDefinition,
    normalizedParams: unknown,
    rpcOverrides: RpcExecutionOverrides | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): Record<string, unknown> | undefined {
    if (rpcOverrides === undefined || !isRecord(normalizedParams)) return undefined
    const rawWs = rpcOverrides.workspaceId?.trim()
    const pinnedWs = rawWs !== undefined && rawWs !== '' && rawWs !== '*' ? rawWs : undefined
    const pinnedProj = rpcOverrides.projectNumber
    if (pinnedWs === undefined && pinnedProj === undefined) return undefined

    const topErr = checkRecordAgainstRpcBounds(normalizedParams, pinnedWs, pinnedProj, registry)
    if (topErr !== undefined) return topErr

    const batchKey =
        (tool.name === 'batch_create_entries' || tool.name === 'team_batch_create_entries') &&
        Array.isArray(normalizedParams['entries'])
            ? 'entries'
            : (tool.name === 'batch_update_entries' || tool.name === 'team_batch_update_entries') &&
                Array.isArray(normalizedParams['updates'])
              ? 'updates'
              : undefined

    if (batchKey !== undefined) {
        const batchItems = normalizedParams[batchKey]
        if (Array.isArray(batchItems)) {
            for (const item of batchItems) {
                if (!isRecord(item)) continue
                const itemErr = checkRecordAgainstRpcBounds(item, pinnedWs, pinnedProj, registry)
                if (itemErr !== undefined) return itemErr
            }
        }
    }
    return undefined
}
