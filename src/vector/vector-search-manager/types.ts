import type { JournalEntry } from '../../types/index.js'

export interface SemanticSearchResult {
    entryId: number
    entry: JournalEntry
    distance: number
    score: number // 1.0 (exact) to 0.0 (completely orthogonal/opposite)
    similarityScore: number
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------
// The default HuggingFace model used for local embeddings
export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const REBUILD_BATCH_SIZE = 50
export const REBUILD_PAGE_SIZE = 200
