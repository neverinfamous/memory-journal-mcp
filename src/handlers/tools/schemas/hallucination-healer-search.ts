/**
 * Search-payload healing helpers extracted from hallucination-healer.ts (Appendix A split).
 */

import { healSortByField, healIncludeArchivedField } from './hallucination-healer-fields.js'
import { normalizeProjectFields } from './hallucination-healer-scope.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { isRecord } from '../../../utils/type-guards.js'
import {
    SESSION_SUMMARY_TAG_ALIASES,
    TECHNICAL_NOTE_ALIASES,
    BUG_FIX_ALIASES,
    isValidCalendarDate,
} from './constants-and-primitives.js'

export function healTagListField(obj: Record<string, unknown>, fieldKey: string): boolean {
    let modified = false
    if (fieldKey in obj && typeof obj[fieldKey] === 'string') {
        obj[fieldKey] = obj[fieldKey]
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean)
        modified = true
    }
    if (fieldKey in obj && Array.isArray(obj[fieldKey])) {
        let arrayChanged = false
        const healedTags = obj[fieldKey].map((t: unknown) => {
            if (typeof t === 'string') {
                const lower = t.toLowerCase().trim()
                if (SESSION_SUMMARY_TAG_ALIASES.has(lower)) {
                    if (t !== 'session-summary') arrayChanged = true
                    return 'session-summary'
                }
                if (lower === 'commit narrative' || lower === 'commit_narrative') {
                    arrayChanged = true
                    return 'commit-narrative'
                }
            }
            return t
        })
        if (arrayChanged) {
            obj[fieldKey] = healedTags
            modified = true
        }
    }
    return modified
}

export function normalizeTagsField(obj: Record<string, unknown>): boolean {
    let modified = false
    if (obj['tag'] !== undefined && obj['tags'] === undefined) {
        obj['tags'] = obj['tag']
        delete obj['tag']
        modified = true
    }
    if (healTagListField(obj, 'tags')) modified = true
    return modified
}

export function mapKnownEntryTypeAlias(
    etLower: string
): { entryType: string; tag?: string; significanceType?: string } | undefined {
    if (etLower === 'session-summary' || SESSION_SUMMARY_TAG_ALIASES.has(etLower)) {
        return { entryType: 'retrospective', tag: 'session-summary' }
    }
    if (
        etLower === 'architecture' ||
        etLower === 'architecture_decision' ||
        etLower === 'architecture-decision' ||
        etLower === 'architectural_decision' ||
        etLower === 'architectural-decision' ||
        etLower === 'adr'
    ) {
        return { entryType: 'project_decision', significanceType: 'architecture' }
    }
    if (etLower === 'decision') {
        return { entryType: 'project_decision', significanceType: 'decision' }
    }
    if (etLower === 'progress' || etLower === 'status' || etLower === 'development') {
        return { entryType: 'development_note' }
    }
    if (TECHNICAL_NOTE_ALIASES.has(etLower)) return { entryType: 'technical_note', tag: etLower }
    if (BUG_FIX_ALIASES.has(etLower)) return { entryType: 'bug_fix' }
    if (etLower === 'feature') return { entryType: 'feature_implementation' }
    if (etLower === 'meeting') return { entryType: 'meeting_notes' }
    return undefined
}

export function unpackFilterContainers(obj: Record<string, unknown>): boolean {
    let modified = false
    for (const containerKey of ['filters', 'filter']) {
        if (!(containerKey in obj)) continue
        const val = obj[containerKey]
        if (!isRecord(val)) continue
        let hasConflict = false
        for (const [k, v] of Object.entries(val)) {
            if (v === undefined) continue
            if (obj[k] === undefined) {
                obj[k] = v
                modified = true
            } else if (!Object.is(obj[k], v)) {
                hasConflict = true
            }
        }
        if (!hasConflict) {
            Reflect.deleteProperty(obj, containerKey)
            modified = true
        }
    }
    return modified
}

const ENTRY_ID_PREFIX_RE = /^(?:#|(?:entry|id)\s*(?:[:#_]\s*|-(?!-)|\s+))/i

/** Parse canonical positive-integer entry ID strings after stripping explicit `#` / `id:` / `entry-` prefixes (rejecting negatives). */
export function parseHealedEntryIdString(raw: string): number | undefined {
    const trimmed = raw.trim()
    if (trimmed.startsWith('-')) return undefined
    const stripped = trimmed.replace(ENTRY_ID_PREFIX_RE, '').trim()
    if (!/^[1-9]\d*$/.test(stripped)) return undefined
    return parsePositiveProjectNumber(stripped)
}

export function coerceEntryIdField(obj: Record<string, unknown>): boolean {
    if ('entry_id' in obj && typeof obj['entry_id'] === 'string') {
        const parsed = parseHealedEntryIdString(obj['entry_id'])
        if (parsed !== undefined) {
            obj['entry_id'] = parsed
            return true
        }
    }
    return false
}

const SEARCH_KEY_ALIAS_MAP: Record<string, string> = {
    id: 'entry_id',
    entryId: 'entry_id',
    project_id: 'project_number',
    projectId: 'project_number',
    projectNumber: 'project_number',
    repo: 'workspace_id',
    repository: 'workspace_id',
    repo_name: 'workspace_id',
    isPersonal: 'is_personal',
    personal: 'is_personal',
    entryType: 'entry_type',
    type: 'entry_type',
    startDate: 'start_date',
    endDate: 'end_date',
    sortBy: 'sort_by',
    includeTeam: 'include_team',
    includeArchived: 'include_archived',
    includeFacets: 'include_facets',
    includeHighlights: 'include_highlights',
    ftsWeight: 'fts_weight',
    semanticWeight: 'semantic_weight',
    fuzzyMatch: 'fuzzy_match',
    autoCorrect: 'auto_correct',
    exactMatch: 'exact_match',
    similarityThreshold: 'similarity_threshold',
    hintOnEmpty: 'hint_on_empty',
    workflowRunId: 'workflow_run_id',
    prNumber: 'pr_number',
    prStatus: 'pr_status',
    issueNumber: 'issue_number',
    excludeTags: 'exclude_tags',
    excludeTag: 'exclude_tags',
    exclude_tag: 'exclude_tags',
    excludedTags: 'exclude_tags',
    excluded_tags: 'exclude_tags',
}

function searchAliasValuesEquivalent(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => searchAliasValuesEquivalent(v, b[i]))
    }
    return false
}

function healSearchSortBy(obj: Record<string, unknown>): boolean {
    if ('sort_by' in obj && typeof obj['sort_by'] === 'string') {
        const cleaned = obj['sort_by'].trim().toLowerCase()
        if (
            cleaned === 'blended' ||
            cleaned === 'blend' ||
            cleaned === 'balanced' ||
            cleaned === 'weighted' ||
            cleaned === 'combined'
        ) {
            if (obj['sort_by'] !== 'blended') {
                obj['sort_by'] = 'blended'
                return true
            }
            return false
        }
    }
    return healSortByField(obj)
}

const ISO_DATETIME_PREFIX_RE =
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i

function normalizeIsoDateField(obj: Record<string, unknown>, key: 'start_date' | 'end_date'): boolean {
    const raw = obj[key]
    if (typeof raw !== 'string') return false
    const trimmed = raw.trim()
    const match = ISO_DATETIME_PREFIX_RE.exec(trimmed)
    if (match?.[1] === undefined) return false
    if (!isValidCalendarDate(match[1]) || !Number.isFinite(Date.parse(trimmed))) return false
    obj[key] = match[1]
    return true
}

/** Read-safe preprocessor for search schemas: normalizes search filters without synthesizing `content` or write `tags`. */
export function healSearchPayload(val: unknown): unknown {
    if (!isRecord(val)) return val

    const obj: Record<string, unknown> = { ...val }
    let modified = false

    if (unpackFilterContainers(obj)) modified = true

    for (const badKey of Object.keys(obj)) {
        if (!Object.hasOwn(SEARCH_KEY_ALIAS_MAP, badKey)) continue
        const goodKey = SEARCH_KEY_ALIAS_MAP[badKey]
        if (goodKey === undefined) continue
        if (
            goodKey in obj &&
            obj[goodKey] !== undefined &&
            obj[badKey] !== undefined &&
            !searchAliasValuesEquivalent(obj[goodKey], obj[badKey])
        ) {
            continue
        }
        if (obj[goodKey] === undefined && obj[badKey] !== undefined) obj[goodKey] = obj[badKey]
        Reflect.deleteProperty(obj, badKey)
        modified = true
    }
    if (coerceEntryIdField(obj)) modified = true
    if (normalizeTagsField(obj)) modified = true
    if (healTagListField(obj, 'exclude_tags')) modified = true
    if (normalizeIsoDateField(obj, 'start_date')) modified = true
    if (normalizeIsoDateField(obj, 'end_date')) modified = true

    if ('entry_type' in obj && typeof obj['entry_type'] === 'string') {
        const mapped = mapKnownEntryTypeAlias(obj['entry_type'].toLowerCase())
        if (mapped !== undefined && obj['entry_type'] !== mapped.entryType) {
            obj['entry_type'] = mapped.entryType
            modified = true
        }
    }

    if (healSearchSortBy(obj)) modified = true
    if ('sort_order' in obj || 'sortOrder' in obj) {
        Reflect.deleteProperty(obj, 'sort_order')
        Reflect.deleteProperty(obj, 'sortOrder')
        modified = true
    }
    if (normalizeProjectFields(obj)) modified = true
    if (healIncludeArchivedField(obj)) modified = true

    return modified ? obj : val
}
