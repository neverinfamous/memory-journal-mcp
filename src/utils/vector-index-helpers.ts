/**
 * Vector Index Helpers
 *
 * Shared vector indexing logic used by entry-creation
 * handlers (create_entry, create_entry_minimal, restore_entry, etc.).
 */

import type { VectorSearchManager } from '../vector/vector-search-manager/index.js'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { JournalEntry } from '../types/index.js'
import { logger } from './logger.js'

/**
 * Auto-index an entry (by hydrated object or ID) to the vector store for semantic search.
 * Catch errors so as not to revert the database commit, but surface the state.
 */
export async function autoIndexEntry(
    vectorManager: VectorSearchManager | undefined,
    db: IDatabaseAdapter,
    entryOrId: JournalEntry | number,
    workspaceId?: string
): Promise<'success' | 'failed' | 'disabled'> {
    if (vectorManager === undefined) return 'disabled'
    const resolvedWs =
        typeof entryOrId === 'number'
            ? workspaceId
            : (workspaceId ?? entryOrId.workspaceId)
    if (resolvedWs === undefined || resolvedWs.length === 0 || resolvedWs === '*') {
        return 'failed'
    }
    const entryId = typeof entryOrId === 'number' ? entryOrId : entryOrId.id
    try {
        const entry =
            typeof entryOrId === 'number' ? db.getEntryById(entryOrId, resolvedWs) : entryOrId
        if (!entry) return 'failed'

        await vectorManager.addEntry(entry)
        return 'success'
    } catch (error) {
        logger.error(`Failed to auto-index entry #${String(entryId)}`, {
            module: 'VectorIndex',
            error: error instanceof Error ? error.message : String(error),
        })
        return 'failed'
    }
}
