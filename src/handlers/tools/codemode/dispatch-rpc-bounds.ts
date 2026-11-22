/**
 * Monotonic nested RPC override scope-bound validation for Code Mode `secure-dispatcher.ts`.
 */

import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import type { RpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { pairStoredScope, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { cwdMatchesRegistryPath, findCanonicalRegistryKey } from '../../../utils/workspace-registry-match.js'
import { assertSafeDirectoryPath, PathTraversalError } from '../../../utils/security-utils.js'

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
    for (const key of ['workspace_id', 'target_workspace_id', 'repo', 'repo_name', 'repository'] as const) {
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

function resolvePinnedPathsForScope(
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): string[] {
    if (registry === undefined) return []
    if (effectivePinnedWs !== undefined) {
        const key = findCanonicalRegistryKey(effectivePinnedWs, registry) ?? effectivePinnedWs
        const p = registry[key]?.path
        return typeof p === 'string' && p.trim() !== '' ? [p] : []
    }
    if (pinnedProj !== undefined) {
        return Object.values(registry).flatMap((e) =>
            e.project_number === pinnedProj && typeof e.path === 'string' && e.path.trim() !== ''
                ? [e.path]
                : []
        )
    }
    return []
}

function checkScopedRepoAndOwnerFields(
    rec: Record<string, unknown>,
    effectivePinnedWs: string,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): Record<string, unknown> | undefined {
    const pinnedOwner = effectivePinnedWs.includes('/') ? effectivePinnedWs.split('/')[0] : undefined
    const rawOwner = rec['owner']
    if (typeof rawOwner === 'string' && rawOwner.trim() !== '' && pinnedOwner !== undefined) {
        if (rawOwner.trim().toLowerCase() !== pinnedOwner.toLowerCase()) {
            return validationErrResult(
                `owner '${rawOwner.trim()}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
            )
        }
    }
    for (const repoKey of ['repo', 'repo_name', 'repository'] as const) {
        const rawRepo = rec[repoKey]
        if (typeof rawRepo !== 'string' || rawRepo.trim() === '') continue
        const trimmedRepo = rawRepo.trim()
        const slashParts = trimmedRepo.split(/[/\\]/).filter(Boolean)
        if (pinnedOwner !== undefined && slashParts.length >= 2 && slashParts[0]?.toLowerCase() !== pinnedOwner.toLowerCase()) {
            return validationErrResult(
                `${repoKey} '${trimmedRepo}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`
            )
        }
        const repoSlug = slashParts.pop() ?? trimmedRepo
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
    return undefined
}

const PROJECT_ADMIN_TOOL_NAMES = new Set([
    'get_project', 'register_project', 'update_project', 'delete_project',
])
const IO_DIR_TOOL_NAMES = new Set([
    'export_markdown', 'import_markdown', 'import_external',
    'team_export_markdown', 'team_import_markdown', 'team_import_external',
])

function checkDirectoryBoundsForScope(
    dirVal: unknown,
    fieldName: string,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry'],
    requirePinnedPath: boolean
): Record<string, unknown> | undefined {
    if (typeof dirVal !== 'string' || dirVal.trim() === '') return undefined
    const allowedPaths = resolvePinnedPathsForScope(effectivePinnedWs, pinnedProj, registry)
    if (allowedPaths.length === 0) {
        return requirePinnedPath
            ? validationErrResult(`${fieldName} is not allowed without a registered path in nested executeCode scope.`)
            : undefined
    }
    try {
        assertSafeDirectoryPath(dirVal.trim(), allowedPaths)
        return undefined
    } catch (err) {
        const msg = err instanceof PathTraversalError ? err.message : `${fieldName} conflicts with nested executeCode scope.`
        return validationErrResult(msg)
    }
}

function checkToolSpecificRpcBounds(
    toolName: string,
    rec: Record<string, unknown>,
    effectivePinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): Record<string, unknown> | undefined {
    if (toolName === 'update_configuration') {
        return validationErrResult("Tool 'update_configuration' is not allowed inside a scope-narrowed nested executeCode call.")
    }
    if (PROJECT_ADMIN_TOOL_NAMES.has(toolName)) {
        for (const nameKey of ['name', 'new_name'] as const) {
            const rawName = rec[nameKey]
            if (typeof rawName !== 'string' || rawName.trim() === '') continue
            const trimmed = rawName.trim()
            if (effectivePinnedWs !== undefined && workspacesConflict(trimmed, effectivePinnedWs, registry)) {
                return validationErrResult(`${nameKey} '${trimmed}' conflicts with nested executeCode scope '${effectivePinnedWs}'.`)
            }
            if (pinnedProj !== undefined && resolveRegistryEntryProject(trimmed, registry).projectNumber !== pinnedProj) {
                return validationErrResult(`${nameKey} '${trimmed}' conflicts with nested executeCode project_number ${String(pinnedProj)}.`)
            }
        }
        return checkDirectoryBoundsForScope(rec['absolute_path'], 'absolute_path', effectivePinnedWs, pinnedProj, registry, true)
    }
    if (IO_DIR_TOOL_NAMES.has(toolName)) {
        for (const dirKey of ['output_dir', 'source_dir'] as const) {
            const dirErr = checkDirectoryBoundsForScope(rec[dirKey], dirKey, effectivePinnedWs, pinnedProj, registry, false)
            if (dirErr !== undefined) return dirErr
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
        const repoErr = checkScopedRepoAndOwnerFields(rec, effectivePinnedWs, registry)
        if (repoErr !== undefined) return repoErr
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

    const effectivePinnedWs =
        pinnedWs ?? (pinnedProj !== undefined ? uniqueWorkspaceForProject(pinnedProj, registry) : undefined)
    const toolErr = checkToolSpecificRpcBounds(tool.name, normalizedParams, effectivePinnedWs, pinnedProj, registry)
    if (toolErr !== undefined) return toolErr

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
