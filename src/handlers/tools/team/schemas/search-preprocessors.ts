/**
 * Preprocessors and alias normalizers for Team Search and Link Zod schemas.
 * Extracted from core-search-schemas.ts and analytics-vector-schemas.ts to keep
 * schema modules well under the 500-line ceiling.
 */

import { healSortByField, healIncludeArchivedField } from '../../schemas/hallucination-healer-fields.js'
import { healSearchPayload } from '../../schemas.js'

const TEAM_SEARCH_QUERY_ALIASES = ['q', 'text', 'message', 'description', 'content'] as const
const TEAM_SEMANTIC_QUERY_ALIASES = ['q', 'text', 'message', 'description'] as const

/** Preprocessor for team_get_recent: normalizes `sort_by` and `include_archived` aliases. */
export function preprocessTeamSortByOnly(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const obj: Record<string, unknown> = Object.fromEntries(Object.entries(val))
    let modified = false
    if (healSortByField(obj)) modified = true
    if (healIncludeArchivedField(obj)) modified = true
    return modified ? obj : val
}

/** Preprocessor for team_search: delegates search filter healing and folds query aliases without 'keep'/'path'/'mode'. */
export function preprocessTeamSearchQuery(val: unknown): unknown {
    const healed = healSearchPayload(val)
    if (typeof healed !== 'object' || healed === null || Array.isArray(healed)) return healed
    const obj: Record<string, unknown> = Object.fromEntries(Object.entries(healed))
    let modified = false
    for (const key of TEAM_SEARCH_QUERY_ALIASES) {
        if (key in obj && !('query' in obj)) {
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
    if ('start' in obj && !('start_date' in obj)) {
        obj['start_date'] = obj['start']
        Reflect.deleteProperty(obj, 'start')
        modified = true
    }
    if ('end' in obj && !('end_date' in obj)) {
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
        if (key in obj && !('query' in obj)) {
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

/** Preprocessor for TeamLinkEntriesSchemaMcp: normalizes endpoint, relationship, and description aliases. */
export function preprocessTeamLinkEntries(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const raw: Record<string, unknown> = Object.fromEntries(Object.entries(val))
    const rawRel = raw['type'] ?? raw['rel'] ?? raw['relationship_type'] ?? 'references'
    const normalized: Record<string, unknown> = {}
    const fromId = raw['from_entry_id'] ?? raw['from_id'] ?? raw['from'] ?? raw['source_id']
    const toId = raw['to_entry_id'] ?? raw['to_id'] ?? raw['to'] ?? raw['target_id']
    const description = raw['description'] ?? raw['message'] ?? raw['text']
    if (fromId !== undefined) normalized['from_entry_id'] = fromId
    if (toId !== undefined) normalized['to_entry_id'] = toId
    normalized['relationship_type'] = normalizeTeamLinkRelationshipType(rawRel)
    if (description !== undefined) normalized['description'] = description
    if (raw['project_number'] !== undefined) normalized['project_number'] = raw['project_number']
    if (raw['workspace_id'] !== undefined) normalized['workspace_id'] = raw['workspace_id']
    return normalized
}
