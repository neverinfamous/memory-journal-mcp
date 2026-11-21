/**
 * Search-payload healing helpers extracted from hallucination-healer.ts (Appendix A split).
 */

import { healSortByField, healIncludeArchivedField } from './hallucination-healer-fields.js'
import { normalizeProjectFields } from './hallucination-healer-scope.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import {
    SESSION_SUMMARY_TAG_ALIASES,
    TECHNICAL_NOTE_ALIASES,
    BUG_FIX_ALIASES,
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
    if ('tag' in obj && !('tags' in obj)) {
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
        Reflect.deleteProperty(obj, containerKey)
        modified = true
        if (typeof val !== 'object' || val === null || Array.isArray(val)) continue
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            if (!(k in obj) && v !== undefined) obj[k] = v
        }
    }
    return modified
}

export function coerceEntryIdField(obj: Record<string, unknown>): boolean {
    if ('entry_id' in obj && typeof obj['entry_id'] === 'string') {
        const raw = obj['entry_id'].trim()
        if (raw.startsWith('-')) return false
        const stripped = raw.replace(/^[^0-9]+/, '')
        const parsed = parsePositiveProjectNumber(stripped)
        if (parsed !== undefined && /^[1-9]\d*$/.test(stripped)) {
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

const SCOPE_CONFLICT_PRESERVED_KEYS = new Set([
    'project_id',
    'projectId',
    'projectNumber',
    'repo',
    'repository',
    'repo_name',
])

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

/** Read-safe preprocessor for search schemas: normalizes search filters without synthesizing `content` or write `tags`. */
export function healSearchPayload(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val

    const obj = { ...(val as Record<string, unknown>) }
    let modified = false

    for (const badKey of Object.keys(obj)) {
        if (!Object.hasOwn(SEARCH_KEY_ALIAS_MAP, badKey)) continue
        const goodKey = SEARCH_KEY_ALIAS_MAP[badKey]
        if (goodKey === undefined) continue
        const hasConflict =
            SCOPE_CONFLICT_PRESERVED_KEYS.has(badKey) &&
            goodKey in obj &&
            obj[goodKey] !== undefined &&
            obj[goodKey] !== obj[badKey]
        if (hasConflict) continue
        if (!(goodKey in obj) && obj[badKey] !== undefined) obj[goodKey] = obj[badKey]
        Reflect.deleteProperty(obj, badKey)
        modified = true
    }

    if (unpackFilterContainers(obj)) modified = true
    if (coerceEntryIdField(obj)) modified = true
    if (normalizeTagsField(obj)) modified = true
    if (healTagListField(obj, 'exclude_tags')) modified = true

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
