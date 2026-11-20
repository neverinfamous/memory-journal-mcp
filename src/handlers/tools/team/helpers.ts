/**
 * Team Tool Helpers
 *
 * Shared constants and utilities used across all team tool sub-modules.
 */

import type { JournalEntry, ToolContext } from '../../../types/index.js'
import { PermissionError } from '../../../types/errors.js'
import { logger } from '../../../utils/logger.js'
import { isTargetExcludedByRules } from '../dummy-filter-helpers.js'
import { isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import { sanitizeAuthor } from '../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { findWorkspaceByProjectNumber } from '../../../utils/workspace-resolver-registry.js'
import {
    activeProjectRegistry,
    concreteWorkspace,
    exactRegistryKey,
    pairStoredScope,
    workspacesForProject,
} from '../../../utils/write-scope.js'
import { TeamGetEntryByIdSchema } from './schemas.js'

// ============================================================================
// Constants
// ============================================================================

export const TEAM_DB_NOT_CONFIGURED =
    'Team database not configured. Set TEAM_DB_PATH environment variable to enable team collaboration.'

/** Structured error response for unconfigured team DB — reused by all 20 team tools. */
export const TEAM_DB_ERROR_RESPONSE = {
    success: false as const,
    error: TEAM_DB_NOT_CONFIGURED,
    code: 'CONFIGURATION_ERROR',
    category: 'configuration',
    suggestion:
        'Set TEAM_DB_PATH environment variable or --team-db CLI flag to enable team collaboration.',
    recoverable: true,
}

/**
 * Enforce active `--tool-filter` rules before delegating a canonical fallback tool (M14).
 */
export function assertCanonicalFallbackToolAllowed(
    toolName: string,
    groupName: string,
    context: ToolContext,
    readOnlyHint = false
): void {
    const filterCfg = context.config?.filterConfig
    if (filterCfg === undefined || filterCfg === null) return
    if (
        isTargetExcludedByRules([toolName, groupName], filterCfg) ||
        !isToolVisibleForFilter(toolName, readOnlyHint, filterCfg.raw) ||
        (context.config?.codemodeInternalFullAccess !== true &&
            !filterCfg.enabledTools.has(toolName))
    ) {
        throw new PermissionError(`Tool '${toolName}' is disabled by active tool filter.`)
    }
}

// ============================================================================
// Author Helpers
// ============================================================================

/**
 * Batch-fetch author names for a list of entry IDs.
 * Returns a Map<entryId, author> for O(1) lookups.
 */
export function batchFetchAuthors(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entryIds: number[]
): Map<number, string | null> {
    if (entryIds.length === 0) return new Map<number, string | null>()
    const rawMap = teamDb.getAuthorsForEntries(entryIds)
    const sanitizedMap = new Map<number, string | null>()
    for (const [id, author] of rawMap.entries()) {
        sanitizedMap.set(id, author !== null ? sanitizeAuthor(author) : null)
    }
    return sanitizedMap
}

/**
 * Fetch a single author for an entry ID.
 */
export function fetchAuthor(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entryId: number
): string | null {
    const authorMap = batchFetchAuthors(teamDb, [entryId])
    return authorMap.get(entryId) ?? null
}

/**
 * Trigger MCP resource subscriptions for team resources.
 */
export function triggerTeamNotifications(context: ToolContext): void {
    if (context.config?.subscriptionManager) {
        const logErr = (err: unknown): void => {
            logger.debug('Team resource notification failed', { error: err })
        }
        void context.config.subscriptionManager
            .notifyResourceUpdated('memory://team/recent')
            .catch(logErr)
        void context.config.subscriptionManager
            .notifyResourceUpdated('memory://team/statistics')
            .catch(logErr)
        void context.config.subscriptionManager
            .notifyResourceUpdated('memory://briefing')
            .catch(logErr)
    }
}

/** Structured error response for missing required team project_number. */
export function missingTeamProjectNumberError(
    error = 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.'
): {
    success: false
    error: string
    code: 'VALIDATION_ERROR'
    category: 'validation'
    suggestion: string
    recoverable: true
} {
    return {
        success: false,
        error,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion:
            "🛠️ AUTONOMOUS HEALING: Specify a concrete registered workspace_id and project_number (or configure DEFAULT_PROJECT_NUMBER). Team DB enforces per-project tenant isolation and rejects workspace_id: '*'; for global audits, iterate Object.entries((await mj.admin.listProjects({})).projects) and call mj.team.teamGetRecent({ workspace_id, project_number, limit: 200 }) per project instead of probing sequential IDs.",
        recoverable: true,
    }
}

/**
 * Derive the project number for a team tool call. A registered workspace keeps its
 * registry project. Otherwise use the explicit number, then the configured default.
 */
export function resolveTeamProjectNumber(
    context: ToolContext,
    wsId: string,
    explicitProjectNumber: number | null | undefined,
    explicitWorkspaceId?: string
): number | null | undefined {
    const trimmed = wsId.trim()
    if (trimmed === '' || trimmed === '*') {
        // [INVARIANT] The wildcard never inherits the server default project; callers must supply or derive it from the stored entry.
        return explicitProjectNumber
    }
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const paired = pairStoredScope(trimmed, explicitProjectNumber, registry)
    if (paired.projectNumber !== undefined && paired.projectNumber !== null) return paired.projectNumber
    // [INVARIANT] Only an omitted workspace that resolved to `default` keeps the configured project;
    // explicit `workspace_id: 'default'` or unregistered named workspaces never inherit `defaultProjectNumber`.
    const explicitlyRequestedDefault = explicitWorkspaceId?.trim().toLowerCase() === 'default'
    if (trimmed.toLowerCase() === 'default' && !explicitlyRequestedDefault) {
        const defaultProj = context.config?.defaultProjectNumber
        if (defaultProj === undefined) return undefined
        return findWorkspaceByProjectNumber(defaultProj, registry) === undefined
            ? defaultProj
            : undefined
    }
    return undefined
}

function filterScopedTeamRelationships(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entryId: number,
    entry: JournalEntry,
    effectiveWsId: string
): ReturnType<NonNullable<ToolContext['teamDb']>['getRelationships']> {
    const rawRels = teamDb.getRelationships(entryId, effectiveWsId)
    const peerIds = [
        ...new Set(
            rawRels.map((rel) => (rel.fromEntryId === entryId ? rel.toEntryId : rel.fromEntryId))
        ),
    ]
    const peersMap =
        peerIds.length > 0 && typeof teamDb.getEntriesByIds === 'function'
            ? teamDb.getEntriesByIds(peerIds, effectiveWsId)
            : new Map(
                  peerIds
                      .map((id) => [id, teamDb.getEntryById(id, effectiveWsId)] as const)
                      .filter(
                          (pair): pair is readonly [number, JournalEntry] =>
                              pair[1] !== null && pair[1] !== undefined
                      )
              )
    return rawRels.filter((rel) => {
        const peerId = rel.fromEntryId === entryId ? rel.toEntryId : rel.fromEntryId
        const peer = peersMap.get(peerId)
        return (
            peer !== undefined &&
            peer.projectNumber === entry.projectNumber &&
            (effectiveWsId === '*' || peer.workspaceId === effectiveWsId)
        )
    })
}

export function executeTeamGetEntryById(
    context: ToolContext,
    teamDb: NonNullable<ToolContext['teamDb']>,
    params: unknown
): Record<string, unknown> {
    const { entry_id, include_relationships, project_number, workspace_id } =
        TeamGetEntryByIdSchema.parse(params)
    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
    const projectNumber = resolveTeamProjectNumber(context, wsId, project_number, workspace_id)
    if (projectNumber === undefined || projectNumber === null) {
        return missingTeamProjectNumberError()
    }

    const entry = teamDb.getEntryById(entry_id, wsId)
    if (!entry) {
        return {
            success: false,
            error: `Team entry ${String(entry_id)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the team entry ID and try again',
            recoverable: true,
        }
    }

    const canRealignLegacyProject = (): boolean => {
        if (entry.projectNumber === null || entry.projectNumber === undefined) return false
        const storedWs = concreteWorkspace(entry.workspaceId)
        if (storedWs === undefined) return false
        const registry = activeProjectRegistry(context.config?.projectRegistry)
        const regKey = exactRegistryKey(storedWs, registry)
        if (regKey?.toLowerCase() !== wsId.trim().toLowerCase()) return false
        if (registry?.[regKey]?.project_number !== projectNumber) return false
        return workspacesForProject(entry.projectNumber, registry).length === 0
    }

    if (entry.projectNumber !== projectNumber && !canRealignLegacyProject()) {
        return {
            success: false,
            error: `Team entry ${String(entry_id)} does not belong to project ${String(projectNumber)}`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the team entry ID and project number, and try again',
            recoverable: true,
        }
    }

    const effectiveWsId = entry.workspaceId ?? wsId
    const author = fetchAuthor(teamDb, entry_id)
    const result: Record<string, unknown> = {
        success: true,
        entry: { ...entry, author },
    }
    if (include_relationships) {
        result['relationships'] = filterScopedTeamRelationships(teamDb, entry_id, entry, effectiveWsId)
    }
    const importance = teamDb.calculateImportance(entry_id, effectiveWsId)
    if (importance !== null) result['importance'] = importance
    return result
}
