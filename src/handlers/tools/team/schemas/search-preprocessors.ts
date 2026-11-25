/**
 * Preprocessors and alias normalizers for Team Search and Link Zod schemas.
 * Extracted from core-search-schemas.ts and analytics-vector-schemas.ts to keep
 * schema modules well under the 500-line ceiling.
 */

import { healSortByField, healIncludeArchivedField } from '../../schemas/hallucination-healer-fields.js'
import { healSearchPayload } from '../../schemas.js'
import { parseCanonicalPositiveInt } from '../../../../utils/safe-positive-int.js'
import { isRecord } from '../../../../utils/type-guards.js'

const TEAM_SEARCH_QUERY_ALIASES = ['q', 'text', 'message', 'description', 'content'] as const
const TEAM_SEMANTIC_QUERY_ALIASES = ['q', 'text', 'message', 'description'] as const

/** Preprocessor for team_get_recent: normalizes `sort_by` and `include_archived` aliases. */
export function preprocessTeamSortByOnly(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const obj: Record<string, unknown> = Object.fromEntries(Object.entries(val))
    let modified = false
    if (healSortByField(obj)) modified = true
    if (healIncludeArchivedField(obj)) modified = true
    if (typeof obj['cursor'] === 'string') {
        const trimmed = obj['cursor'].trim()
        if (/^(?:0|[1-9]\d*)$/.test(trimmed)) {
            const parsed = Number(trimmed)
            if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) {
                if (obj['offset'] === undefined) obj['offset'] = parsed
                delete obj['cursor']
                modified = true
            }
        }
    }
    return modified ? obj : val
}

/** Preprocessor for team_search: delegates search filter healing and folds query aliases without 'keep'/'path'/'mode'. */
export function preprocessTeamSearchQuery(val: unknown): unknown {
    const healed = healSearchPayload(val)
    if (typeof healed !== 'object' || healed === null || Array.isArray(healed)) return healed
    const obj: Record<string, unknown> = Object.fromEntries(Object.entries(healed))
    let modified = false
    for (const key of TEAM_SEARCH_QUERY_ALIASES) {
        if (obj[key] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj[key]
            Reflect.deleteProperty(obj, key)
            modified = true
            break
        }
    }
    return modified ? obj : healed
}

/** Preprocessor for team_search_by_date_range: delegates search filter healing and maps start/end aliases. */
export function preprocessDateRange(val: unknown): unknown {
    const healed = healSearchPayload(val)
    if (typeof healed !== 'object' || healed === null || Array.isArray(healed)) return healed
    const obj: Record<string, unknown> = Object.fromEntries(Object.entries(healed))
    let modified = false
    if (obj['start'] !== undefined && obj['start_date'] === undefined) {
        obj['start_date'] = obj['start']
        Reflect.deleteProperty(obj, 'start')
        modified = true
    }
    if (obj['end'] !== undefined && obj['end_date'] === undefined) {
        obj['end_date'] = obj['end']
        Reflect.deleteProperty(obj, 'end')
        modified = true
    }
    return modified ? obj : healed
}

/** Preprocessor for team_semantic_search: delegates search filter healing and folds query aliases. */
export function preprocessSemanticSearchQuery(val: unknown): unknown {
    const healed = healSearchPayload(val)
    if (typeof healed !== 'object' || healed === null || Array.isArray(healed)) return healed
    const obj: Record<string, unknown> = Object.fromEntries(Object.entries(healed))
    let modified = false
    for (const key of TEAM_SEMANTIC_QUERY_ALIASES) {
        if (obj[key] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj[key]
            Reflect.deleteProperty(obj, key)
            modified = true
            break
        }
    }
    return modified ? obj : healed
}

/** Map legacy relationship aliases used in team_link_entries to canonical relationship types. */
export function normalizeTeamLinkRelationshipType(val: unknown): unknown {
    if (val === 'resolves') return 'resolved'
    if (val === 'relates_to') return 'references'
    if (val === 'depends_on') return 'blocked_by'
    return val
}

function coerceLinkEndpointId(val: unknown): unknown {
    if (typeof val === 'string') {
        const trimmed = val.trim()
        return parseCanonicalPositiveInt(trimmed) ?? val
    }
    return val
}

function normalizeAliasGroup(
    normalized: Record<string, unknown>,
    canonicalKey: string,
    aliasKeys: readonly string[],
    transformVal: (val: unknown) => unknown
): void {
    const allKeys = [canonicalKey, ...aliasKeys]
    const definedPairs = allKeys
        .filter((k) => normalized[k] !== undefined)
        .map((k) => ({ key: k, val: transformVal(normalized[k]) }))
    if (definedPairs.length === 0) return

    const first = definedPairs[0]
    if (first === undefined) return
    const hasConflict = definedPairs.some((pair) => !Object.is(pair.val, first.val))
    if (hasConflict) return

    for (const alias of aliasKeys) {
        Reflect.deleteProperty(normalized, alias)
    }
    normalized[canonicalKey] = first.val
}

/** Preprocessor for TeamLinkEntriesSchema & TeamLinkEntriesSchemaMcp: normalizes aliases while preserving conflicting or unknown keys for .strict(). */
export function preprocessTeamLinkEntries(val: unknown): unknown {
    if (!isRecord(val)) return val
    const normalized: Record<string, unknown> = { ...val }
    normalizeAliasGroup(normalized, 'from_entry_id', ['from_id', 'from', 'source_id'], coerceLinkEndpointId)
    normalizeAliasGroup(normalized, 'to_entry_id', ['to_id', 'to', 'target_id'], coerceLinkEndpointId)
    normalizeAliasGroup(normalized, 'relationship_type', ['type', 'rel'], normalizeTeamLinkRelationshipType)
    normalizeAliasGroup(normalized, 'description', ['message', 'text'], (v) => v)
    return normalized
}

/** Preprocessor for TeamVisualizeRelationshipsSchema: coerces and clamps `limit` (1-500) while preserving unknown keys for `.strict()`. */
export function preprocessTeamVisualizeRelationships(val: unknown): unknown {
    if (!isRecord(val)) return val
    const obj = val
    const rawLimit = obj['limit']
    if (rawLimit === undefined) return val

    if (typeof rawLimit === 'string') {
        const parsed = parseCanonicalPositiveInt(rawLimit.trim())
        if (parsed === undefined) return val
        return { ...obj, limit: Math.min(parsed, 500) }
    }
    if (typeof rawLimit === 'number' && Number.isSafeInteger(rawLimit) && rawLimit >= 1) {
        return rawLimit > 500 ? { ...obj, limit: 500 } : val
    }
    return val
}
