/**
 * Team Tool Helpers
 *
 * Shared constants and utilities used across all team tool sub-modules.
 */

import type { ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'

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
    return teamDb.getAuthorsForEntries(entryIds)
}

/**
 * Fetch a single author for an entry ID.
 */
export function fetchAuthor(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entryId: number
): string | null {
    const authorMap = teamDb.getAuthorsForEntries([entryId])
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
            .notifyResourceUpdated('memory://briefing')
            .catch(logErr)
    }
}

/**
 * Derive the project number for a team tool call. A registered workspace keeps its
 * registry project. Otherwise use the explicit number, then the configured default.
 */
export function resolveTeamProjectNumber(
    context: ToolContext,
    wsId: string,
    explicitProjectNumber: number | null | undefined
): number | null | undefined {
    const trimmed = wsId.trim()
    if (trimmed === '' || trimmed === '*') {
        if (explicitProjectNumber !== undefined && explicitProjectNumber !== null) return explicitProjectNumber
        return context.config?.defaultProjectNumber
    }
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const paired = pairStoredScope(trimmed, explicitProjectNumber, registry)
    if (paired.projectNumber !== undefined && paired.projectNumber !== null) return paired.projectNumber
    // [INVARIANT] An omitted workspace that resolved to `default` keeps the configured project. A supplied number owned by another workspace is already rejected.
    return context.config?.defaultProjectNumber
}
