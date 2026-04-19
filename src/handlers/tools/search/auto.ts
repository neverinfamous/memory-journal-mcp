/**
 * Search Group — Auto-Mode Query Classifier
 *
 * Heuristic that inspects a query string and selects the best search
 * strategy: 'fts', 'semantic', or 'hybrid'.
 *
 * This is the core of the `mode: 'auto'` default in `search_entries`.
 */

/** Search mode types supported by search_entries */
export type SearchMode = 'auto' | 'fts' | 'semantic' | 'hybrid'

/** Pattern: question-like queries that indicate semantic intent */
const QUESTION_PATTERNS = [
    /^(how|what|why|when|where|who|which|can|does|is|are|was|were|did|should|could|would|explain|show|find|describe)\b/i,
    /\?$/,
]

/** Pattern: quoted phrases indicating exact-match (FTS5) intent */
const QUOTED_PHRASE_PATTERN = /"[^"]+"/

/**
 * Classify a search query into the optimal search mode.
 *
 * Rules (applied in order):
 * 1. Quoted phrases → FTS5 (exact match intent)
 * 2. 1-2 words → FTS5 (keyword match is more precise)
 * 3. Questions → Semantic (conceptual intent)
 * 4. 3+ words → Hybrid RRF (benefits from both)
 *
 * @param query - The search query string
 * @returns The recommended search mode
 */
export function classifyQuery(query: string): Exclude<SearchMode, 'auto'> {
    const trimmed = query.trim()

    // Empty or whitespace-only → FTS5 (will return recent entries or empty)
    if (trimmed.length === 0) {
        return 'fts'
    }

    // Rule 1: Quoted phrases → FTS5 (exact match intent)
    if (QUOTED_PHRASE_PATTERN.test(trimmed)) {
        return 'fts'
    }

    // Count words (split on whitespace)
    const words = trimmed.split(/\s+/)
    const wordCount = words.length

    // Rule 2: 1-2 words → FTS5 (keyword match is more precise)
    if (wordCount <= 2) {
        return 'fts'
    }

    // Rule 3: Questions → Semantic (conceptual intent)
    for (const pattern of QUESTION_PATTERNS) {
        if (pattern.test(trimmed)) {
            return 'semantic'
        }
    }

    // Rule 4: 3+ words, no quotes, not a question → Hybrid RRF
    return 'hybrid'
}

/**
 * Resolve the effective search mode from user-specified mode and query.
 *
 * - Explicit modes ('fts', 'semantic', 'hybrid') are used as-is
 * - 'auto' (default) delegates to classifyQuery()
 *
 * @param mode - User-specified search mode
 * @param query - The search query string
 * @returns The resolved search mode and whether it was auto-selected
 */
export function resolveSearchMode(
    mode: SearchMode,
    query: string
): { resolvedMode: Exclude<SearchMode, 'auto'>; isAuto: boolean } {
    if (mode === 'auto') {
        return { resolvedMode: classifyQuery(query), isAuto: true }
    }
    return { resolvedMode: mode, isAuto: false }
}
