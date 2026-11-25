import type { Database } from 'better-sqlite3'
import { isMissingTableError } from '../schema-errors.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

const NON_TOKEN_CHAR_RE = /[^a-zA-Z0-9_-]/
const WHITESPACE_SPLIT_RE = /\s+/
const VOCAB_TTL_MS = 5_000
const MAX_VOCAB_CACHE_WORKSPACES = 64
const vocabCache = new WeakMap<Database, Map<string, { expiresAt: number; vocab: string[] }>>()

/**
 * Rolling 2-row Levenshtein distance algorithm with optional early row-minimum bailout.
 * Calculates the minimum number of single-character edits required to change one word into the other.
 */
export function levenshteinDistance(a: string, b: string, maxDistance?: number): number {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    if (maxDistance !== undefined && Math.abs(a.length - b.length) > maxDistance) {
        return maxDistance + 1
    }

    // Orient shorter string along columns for smaller Int32Array allocation
    const s = a.length <= b.length ? a.toLowerCase() : b.toLowerCase()
    const t = a.length <= b.length ? b.toLowerCase() : a.toLowerCase()
    const m = s.length
    const n = t.length

    let prev = new Int32Array(m + 1)
    let curr = new Int32Array(m + 1)
    for (let j = 0; j <= m; j++) prev[j] = j

    for (let i = 1; i <= n; i++) {
        curr[0] = i
        let rowMin = i
        const ti = t.charCodeAt(i - 1)
        for (let j = 1; j <= m; j++) {
            const cost = ti === s.charCodeAt(j - 1) ? 0 : 1
            const val = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
            curr[j] = val
            if (val < rowMin) rowMin = val
        }
        if (maxDistance !== undefined && rowMin > maxDistance) {
            return maxDistance + 1
        }
        const tmp = prev
        prev = curr
        curr = tmp
    }

    return prev[m] ?? 0
}

function storeCachedVocabulary(
    db: Database,
    scopeId: string,
    now: number,
    result: string[]
): void {
    let byWs = vocabCache.get(db)
    if (!byWs) {
        byWs = new Map()
        vocabCache.set(db, byWs)
    }
    for (const [k, v] of byWs.entries()) {
        if (v.expiresAt <= now) byWs.delete(k)
    }
    while (byWs.size >= MAX_VOCAB_CACHE_WORKSPACES) {
        const oldestKey = byWs.keys().next().value
        if (oldestKey === undefined) break
        byWs.delete(oldestKey)
    }
    byWs.set(scopeId, { expiresAt: now + VOCAB_TTL_MS, vocab: result })
}

/**
 * Builds a vocabulary for fuzzy matching consisting of tag names and entry types (cached for 5s per DB/workspace).
 */
export function buildVocabulary(db: Database, workspaceId?: string): string[] {
    const scopeId = effectiveWorkspace(workspaceId)
    const now = Date.now()
    const byWs = vocabCache.get(db)
    const cached = byWs?.get(scopeId)
    if (cached && cached.expiresAt > now) {
        if (byWs !== undefined) {
            byWs.delete(scopeId)
            byWs.set(scopeId, cached)
        }
        return cached.vocab
    }

    const vocab = new Set<string>()
    const scoped = scopeId !== '*'

    // Get tag names
    try {
        const tags = scoped
            ? db
                  .prepare<unknown[], { name: string }>(
                      `SELECT DISTINCT t.name FROM tags t
                       JOIN entry_tags et ON et.tag_id = t.id
                       JOIN memory_journal mj ON mj.id = et.entry_id
                       WHERE mj.workspace_id = ? AND mj.deleted_at IS NULL`
                  )
                  .all(scopeId)
            : db
                  .prepare<unknown[], { name: string }>(
                      `SELECT DISTINCT t.name FROM tags t
                       INNER JOIN entry_tags et ON et.tag_id = t.id
                       INNER JOIN memory_journal mj ON mj.id = et.entry_id
                       WHERE mj.deleted_at IS NULL`
                  )
                  .all()
        for (const tag of tags) {
            vocab.add(tag.name.toLowerCase())
        }
    } catch (error: unknown) {
        rethrowUnlessMissingTable(error)
    }

    // Get all distinct entry types
    try {
        const types = scoped
            ? db
                  .prepare<unknown[], { entry_type: string }>(
                      'SELECT DISTINCT entry_type FROM memory_journal WHERE entry_type IS NOT NULL AND workspace_id = ? AND deleted_at IS NULL'
                  )
                  .all(scopeId)
            : db
                  .prepare<unknown[], { entry_type: string }>(
                      'SELECT DISTINCT entry_type FROM memory_journal WHERE entry_type IS NOT NULL AND deleted_at IS NULL'
                  )
                  .all()
        for (const type of types) {
            vocab.add(type.entry_type.toLowerCase())
        }
    } catch (error: unknown) {
        rethrowUnlessMissingTable(error)
    }

    const result = Array.from(vocab)
    storeCachedVocabulary(db, scopeId, now, result)
    return result
}

/** Tolerate only a not-yet-created table (fresh database); surface every other failure. */
function rethrowUnlessMissingTable(error: unknown): void {
    if (!isMissingTableError(error)) {
        throw error
    }
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

        const dist = levenshteinDistance(t, word, maxDistance)
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

    const tokens = query.split(WHITESPACE_SPLIT_RE)
    let queryCorrected = false
    const allSuggestions = new Set<string>()
    const newTokens: string[] = []

    for (const token of tokens) {
        // Ignore tokens that contain special characters or are quoted
        if (NON_TOKEN_CHAR_RE.test(token) || token.startsWith('"')) {
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
