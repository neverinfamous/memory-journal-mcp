import type { Database } from 'better-sqlite3'

/**
 * Standard Levenshtein distance algorithm.
 * Calculates the minimum number of single-character edits required to change one word into the other.
 */
export function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    const aLower = a.toLowerCase()
    const bLower = b.toLowerCase()

    const cols = a.length + 1
    const rows = b.length + 1
    const matrix = new Int32Array(rows * cols)

    for (let i = 0; i < rows; i++) {
        matrix[i * cols] = i
    }

    for (let j = 0; j < cols; j++) {
        matrix[j] = j
    }

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            if (bLower.charAt(i - 1) === aLower.charAt(j - 1)) {
                matrix[i * cols + j] = matrix[(i - 1) * cols + (j - 1)] ?? 0
            } else {
                matrix[i * cols + j] = Math.min(
                    (matrix[(i - 1) * cols + (j - 1)] ?? 0) + 1, // substitution
                    (matrix[i * cols + (j - 1)] ?? 0) + 1,       // insertion
                    (matrix[(i - 1) * cols + j] ?? 0) + 1        // deletion
                )
            }
        }
    }

    return matrix[(rows - 1) * cols + (cols - 1)] ?? 0
}

/**
 * Builds a vocabulary for fuzzy matching consisting of tag names and entry types.
 * This represents the core ontology of the journal and provides high-value corrections.
 */
export function buildVocabulary(db: Database): string[] {
    const vocab = new Set<string>()

    // Get all tag names
    try {
        const tags = db.prepare('SELECT name FROM tags').all() as { name: string }[]
        for (const tag of tags) {
            vocab.add(tag.name.toLowerCase())
        }
    } catch {
        // Ignore if table doesn't exist yet
    }

    // Get all distinct entry types
    try {
        const types = db.prepare('SELECT DISTINCT entry_type FROM memory_journal WHERE entry_type IS NOT NULL').all() as { entry_type: string }[]
        for (const type of types) {
            vocab.add(type.entry_type.toLowerCase())
        }
    } catch {
        // Ignore if table doesn't exist yet
    }

    return Array.from(vocab)
}

/**
 * Finds matches within the given maxDistance.
 */
export function findFuzzyMatches(token: string, vocabulary: string[], maxDistance = 2): { match: string; distance: number }[] {
    const t = token.toLowerCase()
    
    // Don't try to fuzzy match very short tokens
    if (t.length <= 3) return []

    const matches: { match: string; distance: number }[] = []

    for (const word of vocabulary) {
        // Quick length filter to avoid unnecessary distance calculations
        if (Math.abs(word.length - t.length) > maxDistance) continue

        const dist = levenshteinDistance(t, word)
        if (dist <= maxDistance && dist > 0) { // Don't return exact matches as suggestions
            matches.push({ match: word, distance: dist })
        }
    }

    return matches.sort((a, b) => a.distance - b.distance)
}

/**
 * Expands a query by checking each token against the vocabulary.
 */
export function expandFuzzyQuery(query: string, vocabulary: string[], autoCorrect = false): { expanded: string; suggestions: string[]; corrected: boolean } {
    if (!query || query.trim() === '') {
        return { expanded: query, suggestions: [], corrected: false }
    }

    const tokens = query.split(/\s+/)
    let queryCorrected = false
    const allSuggestions = new Set<string>()
    const newTokens: string[] = []

    for (const token of tokens) {
        // Ignore tokens that contain special characters or are quoted
        if (/[^a-zA-Z0-9_-]/.test(token) || token.startsWith('"')) {
            newTokens.push(token)
            continue
        }

        const matches = findFuzzyMatches(token, vocabulary)
        
        if (matches.length > 0) {
            // High confidence correction (distance 1)
            const bestMatch = matches[0]
            if (bestMatch && autoCorrect && bestMatch.distance <= 1) {
                newTokens.push(bestMatch.match)
                queryCorrected = true
                continue
            }

            // Just collect suggestions
            for (const m of matches) {
                allSuggestions.add(m.match)
            }
        }
        
        newTokens.push(token)
    }

    return {
        expanded: newTokens.join(' '),
        suggestions: Array.from(allSuggestions),
        corrected: queryCorrected
    }
}
