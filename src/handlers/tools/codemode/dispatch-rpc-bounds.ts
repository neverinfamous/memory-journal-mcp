/**
 * Monotonic nested RPC override scope-bound validation for Code Mode `secure-dispatcher.ts`.
 */

import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import type { RpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-registry-match.js'

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

function checkRecordAgainstRpcBounds(
    rec: Record<string, unknown>,
    pinnedWs: string | undefined,
    pinnedProj: number | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): Record<string, unknown> | undefined {
    if (pinnedWs !== undefined) {
        for (const wsKey of ['workspace_id', 'target_workspace_id'] as const) {
            const rawWs = rec[wsKey]
            if (typeof rawWs === 'string') {
                const trimmed = rawWs.trim()
                if (trimmed !== '' && trimmed !== '*' && workspacesConflict(trimmed, pinnedWs, registry)) {
                    return validationErrResult(
                        `${wsKey} '${trimmed}' conflicts with nested executeCode scope '${pinnedWs}'.`
                    )
                }
            }
        }
    }
    if (pinnedProj !== undefined) {
        const rawProj = rec['project_number']
        if (typeof rawProj === 'number' && Number.isFinite(rawProj) && rawProj !== pinnedProj) {
            return validationErrResult(
                `project_number ${String(rawProj)} conflicts with nested executeCode project_number ${String(pinnedProj)}.`
            )
        }
    }
    return undefined
}

/** Resolves monotonic effective scope from outer session bounds plus nested RPC overrides. */
export function resolveEffectiveRpcScope(
    outer: {
        workspaceId: string | undefined
        projectId: number | string | undefined
        explicitWorkspace?: boolean | undefined
        sessionId?: string | undefined
    },
    rpcOverrides: RpcExecutionOverrides | undefined,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
):
    | {
          effectiveWorkspaceId: string | undefined
          effectiveProjectId: number | string | undefined
          effectiveExplicitWorkspace: boolean | undefined
          effectiveSessionId: string | undefined
          effectiveUseSessionIdInCtx: string | undefined
      }
    | { errorResult: Record<string, unknown> } {
    const { workspaceId, projectId, explicitWorkspace, sessionId } = outer
    const outerCanNarrow = workspaceId === undefined || workspaceId === '*'
    const overrideWs = rpcOverrides?.workspaceId?.trim()
    const hasConcreteOverrideWs = overrideWs !== undefined && overrideWs !== '' && overrideWs !== '*'

    if (!outerCanNarrow && hasConcreteOverrideWs && workspaceId !== undefined && workspacesConflict(overrideWs, workspaceId, registry)) {
        return {
            errorResult: validationErrResult(
                `Nested executeCode workspace '${overrideWs}' conflicts with pinned outer workspace '${workspaceId}'.`
            ),
        }
    }
    if (
        !outerCanNarrow &&
        typeof projectId === 'number' &&
        rpcOverrides?.projectNumber !== undefined &&
        rpcOverrides.projectNumber !== projectId
    ) {
        return {
            errorResult: validationErrResult(
                `Nested executeCode project_number ${String(rpcOverrides.projectNumber)} conflicts with pinned outer project_number ${String(projectId)}.`
            ),
        }
    }

    const effectiveWorkspaceId = outerCanNarrow && hasConcreteOverrideWs ? overrideWs : workspaceId
    const effectiveExplicitWorkspace = effectiveWorkspaceId !== workspaceId ? true : explicitWorkspace
    const effectiveProjectId =
        outerCanNarrow && projectId === undefined && rpcOverrides?.projectNumber !== undefined
            ? rpcOverrides.projectNumber
            : projectId
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
