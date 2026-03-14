/**
 * Vector Index Helpers
 *
 * Shared fire-and-forget vector indexing logic used by entry-creation
 * handlers (create_entry, create_entry_minimal, restore_entry, etc.).
 */

import type { VectorSearchManager } from '../vector/vector-search-manager.js'

/**
 * Auto-index an entry to the vector store for semantic search.
 * Non-critical — failures are silently ignored because the entry
 * is already persisted in the database.
 */
export function autoIndexEntry(
    vectorManager: VectorSearchManager | undefined,
    entryId: number,
    content: string
): void {
    if (vectorManager === undefined) return
    vectorManager.addEntry(entryId, content).catch(() => {
        // Non-critical failure — entry already saved to DB
    })
}
