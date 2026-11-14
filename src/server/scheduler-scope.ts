/**
 * [BOUNDARY] Workspace and auto-prune scope helpers for the background `Scheduler`.
 * [INVARIANT] Background jobs pass `runtime: null` so they never inherit sticky
 * per-session context (C3), and reject unscoped `'*'` / conflicting pairs (C5).
 */

import type { ToolHandlerConfig } from '../types/index.js'
import { resolveAutoPruneScope, resolveWorkspaceId } from '../utils/workspace-resolver.js'

export interface SchedulerWorkspaceScope {
    defaultWorkspaceId?: string
    defaultProjectNumber?: number
    projectRegistry?: ToolHandlerConfig['projectRegistry']
}

export function resolveSchedulerDefaultWorkspace(scope: SchedulerWorkspaceScope): string {
    const { defaultWorkspaceId, defaultProjectNumber, projectRegistry } = scope
    return resolveWorkspaceId(defaultWorkspaceId, defaultProjectNumber, {
        ...(defaultWorkspaceId !== undefined ? { defaultWorkspaceId } : {}),
        ...(defaultProjectNumber !== undefined ? { defaultProjectNumber } : {}),
        ...(projectRegistry !== undefined ? { projectRegistry } : {}),
        runtime: null,
    })
}

export function resolveSchedulerPruneScope(scope: SchedulerWorkspaceScope): {
    workspaceId: string
    projectNumber?: number
} {
    return resolveAutoPruneScope(
        scope.defaultWorkspaceId,
        scope.defaultProjectNumber,
        scope.projectRegistry,
        { runtime: null }
    )
}

export function applySchedulerWorkspaceUpdates(
    target: SchedulerWorkspaceScope,
    updates: SchedulerWorkspaceScope
): void {
    if (updates.defaultWorkspaceId !== undefined) {
        target.defaultWorkspaceId = updates.defaultWorkspaceId
    } else {
        delete target.defaultWorkspaceId
    }
    if (updates.defaultProjectNumber !== undefined) {
        target.defaultProjectNumber = updates.defaultProjectNumber
    } else {
        delete target.defaultProjectNumber
    }
    if (updates.projectRegistry !== undefined) {
        target.projectRegistry = updates.projectRegistry
    } else {
        delete target.projectRegistry
    }
}
