import type { JournalEntry, ToolContext } from '../../../../types/index.js'
import {
    activeProjectRegistry,
    concreteWorkspace,
    exactRegistryKey,
    workspacesForProject,
} from '../../../../utils/write-scope.js'
import { resolveTeamProjectNumber } from '../helpers.js'

/**
 * Resolve the effective `project_number` for team single-entry and link mutations.
 * [INVARIANT] Active session/config `project_number` wins first via `resolveTeamProjectNumber`.
 * Falling back to `existingProjectNumber` is blocked when the caller explicitly targeted `'default'`
 * without specifying `project_number`, matching `team_get_entry_by_id` and `team_batch_delete_entries`.
 */
export function resolveTeamMutationProjectNumber(
    context: ToolContext,
    wsId: string,
    explicitProjectNumber: number | undefined,
    explicitWorkspaceId: string | undefined,
    existingProjectNumber: number | null | undefined
): number | undefined {
    const resolved = resolveTeamProjectNumber(
        context,
        wsId,
        explicitProjectNumber,
        explicitWorkspaceId
    )
    if (resolved !== undefined && resolved !== null) {
        return resolved
    }
    if (explicitWorkspaceId?.trim().toLowerCase() === 'default') {
        return undefined
    }
    return existingProjectNumber ?? undefined
}

/**
 * Allow registered workspaces to access and realign legacy team entries whose stored
 * `projectNumber` drifted after a `projectRegistry` renumbering, provided the stored
 * `projectNumber` is orphaned (not registered to any workspace) and the entry's concrete
 * `workspaceId` canonically matches `wsId` and `targetProjectNumber`.
 */
export function canRealignOrphanedRegisteredProject(
    context: ToolContext,
    wsId: string,
    targetProjectNumber: number,
    existing: Pick<JournalEntry, 'workspaceId' | 'projectNumber'> | null | undefined
): boolean {
    if (existing === null || existing === undefined) return false
    const storedProject = existing.projectNumber
    if (storedProject === null || storedProject === undefined) return false
    if (storedProject === targetProjectNumber) return true
    const storedWs = concreteWorkspace(existing.workspaceId)
    if (storedWs === undefined) return false
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const regKey = exactRegistryKey(storedWs, registry)
    if (regKey === undefined) return false
    if (wsId.trim().toLowerCase() !== regKey.toLowerCase()) return false
    if (registry?.[regKey]?.project_number !== targetProjectNumber) return false
    return workspacesForProject(storedProject, registry).length === 0
}
