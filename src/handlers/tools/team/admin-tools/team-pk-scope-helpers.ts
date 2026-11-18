import type { ToolContext } from '../../../../types/index.js'
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
