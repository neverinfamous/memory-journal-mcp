/**
 * Vector Index Helpers
 *
 * Shared vector indexing logic used by entry-creation
 * handlers (create_entry, create_entry_minimal, restore_entry, etc.).
 */

import type { VectorSearchManager } from '../vector/vector-search-manager.js'
import { logger } from './logger.js'

/**
 * Auto-index an entry to the vector store for semantic search.
 * Catch errors so as not to revert the database commit, but surface the state.
 */
export async function autoIndexEntry(
    vectorManager: VectorSearchManager | undefined,
    entryId: number,
    content: string
): Promise<'success' | 'failed' | 'disabled'> {
    if (vectorManager === undefined) return 'disabled'
    try {
        const result = await vectorManager.addEntry(entryId, content)
        if (!result.success) {
            logger.error(`Failed to auto-index entry #${String(entryId)}`, {
                module: 'VectorIndex',
                error: result.error || 'Unknown error',
            })
            return 'failed'
        }
        return 'success'
    } catch (error) {
        logger.error(`Failed to auto-index entry #${String(entryId)}`, {
            module: 'VectorIndex',
            error: error instanceof Error ? error.message : String(error),
        })
        return 'failed'
    }
}
