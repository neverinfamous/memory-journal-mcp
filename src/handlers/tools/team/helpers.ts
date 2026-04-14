/**
 * Team Tool Helpers
 *
 * Shared constants and utilities used across all team tool sub-modules.
 */

import type { ToolContext } from '../../../types/index.js'

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
    const authorMap = new Map<number, string | null>()
    if (entryIds.length === 0) return authorMap

    const placeholders = entryIds.map(() => '?').join(',')
    const result = teamDb._executeRawQueryUnsafe(
        `SELECT id, author FROM memory_journal WHERE id IN (${placeholders})`,
        entryIds
    )
    if (result[0]) {
        for (const row of result[0].values) {
            authorMap.set(row[0] as number, (row[1] as string) ?? null)
        }
    }
    return authorMap
}

/**
 * Fetch a single author for an entry ID.
 */
export function fetchAuthor(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entryId: number
): string | null {
    const result = teamDb._executeRawQueryUnsafe('SELECT author FROM memory_journal WHERE id = ?', [
        entryId,
    ])
    return (result[0]?.values[0]?.[0] as string) ?? null
}
