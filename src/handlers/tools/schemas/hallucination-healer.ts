/**
 * Shared Preprocessor to Heal Common LLM Hallucinations in Payloads Before Zod Validation
 */

import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import {
    healTitleAndAutoContext,
    healRelationshipFields,
    healAnchorsField,
    healSortByField,
    isUpdatePayload,
} from './hallucination-healer-fields.js'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    coerceSignificanceAlias,
    KEY_ALIAS_MAP,
    CONTENT_ALIASES,
    PASSED_VALIDATION_ALIASES,
    FAILED_VALIDATION_ALIASES,
    NONE_VALIDATION_ALIASES,
    SESSION_SUMMARY_TAG_ALIASES,
    TECHNICAL_NOTE_ALIASES,
    BUG_FIX_ALIASES,
} from './constants-and-primitives.js'

function toStr(v: unknown): string {
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v !== null && v !== undefined) {
        try {
            return JSON.stringify(v)
        } catch {
            return ''
        }
    }
    return ''
}

function healMetadataAndContextFields(obj: Record<string, unknown>): boolean {
    let modified = false

    for (const extraKey of ['date', 'created_at', 'updated_at', 'type', 'status']) {
        if (extraKey in obj && extraKey !== 'entry_type') {
            if (extraKey === 'type' && !('entry_type' in obj)) obj['entry_type'] = obj['type']
            Reflect.deleteProperty(obj, extraKey)
            modified = true
        }
    }

    for (const [field, label] of [
        ['context', 'Context'], ['focus', 'Focus'], ['resolution', 'Resolution'],
    ] as const) {
        if (field in obj) {
            const val =
                field === 'context' && typeof obj[field] === 'object' && obj[field] !== null
                    ? JSON.stringify(obj[field], null, 2)
                    : toStr(obj[field])
            if (val !== '') {
                const existingContent = toStr(obj['content'])
                // [INVARIANT] H8: never synthesize a full-overwrite body on update payloads.
                if (existingContent !== '' || !isUpdatePayload(obj)) {
                    obj['content'] =
                        existingContent !== '' ? `${existingContent}\n\n**${label}:** ${val}` : val
                }
            }
            Reflect.deleteProperty(obj, field)
            modified = true
        }
    }

    if ('artifacts' in obj) {
        if (Array.isArray(obj['artifacts']) && obj['artifacts'].length > 0) {
            const artStr = obj['artifacts']
                .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
                .join(', ')
            const existingContent = toStr(obj['content'])
            obj['content'] =
                existingContent !== '' ? `${existingContent}\n\n**Artifacts:** ${artStr}` : artStr
        }
        Reflect.deleteProperty(obj, 'artifacts')
        modified = true
    }

    if ('category' in obj) {
        if (typeof obj['category'] === 'string' && obj['category'].trim() !== '') {
            const cat = obj['category'].trim()
            obj['tags'] ??= []
            if (Array.isArray(obj['tags']) && !obj['tags'].includes(cat)) obj['tags'].push(cat)
        }
        Reflect.deleteProperty(obj, 'category')
        modified = true
    }

    return modified
}

function healTagsAndEntryType(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('tag' in obj && !('tags' in obj)) {
        obj['tags'] = obj['tag']
        delete obj['tag']
        modified = true
    }

    if ('tags' in obj && typeof obj['tags'] === 'string') {
        obj['tags'] = obj['tags'].split(',').map((t: string) => t.trim()).filter(Boolean)
        modified = true
    }

    if ('tags' in obj && Array.isArray(obj['tags'])) {
        const healedTags = obj['tags'].map((t: unknown) => {
            if (typeof t === 'string') {
                const lower = t.toLowerCase().trim()
                if (SESSION_SUMMARY_TAG_ALIASES.has(lower)) return 'session-summary'
                if (lower === 'commit narrative' || lower === 'commit_narrative')
                    return 'commit-narrative'
            }
            return t
        })
        if (JSON.stringify(obj['tags']) !== JSON.stringify(healedTags)) {
            obj['tags'] = healedTags
            modified = true
        }
    }

    if ('entry_type' in obj && typeof obj['entry_type'] === 'string') {
        const etLower = obj['entry_type'].toLowerCase()
        if (etLower === 'session-summary' || SESSION_SUMMARY_TAG_ALIASES.has(etLower)) {
            obj['entry_type'] = 'retrospective'
            obj['tags'] ??= []
            if (Array.isArray(obj['tags']) && !obj['tags'].includes('session-summary')) {
                obj['tags'].push('session-summary')
            }
            modified = true
        } else if (etLower === 'progress' || etLower === 'status' || etLower === 'development') {
            obj['entry_type'] = 'development_note'
            modified = true
        } else if (TECHNICAL_NOTE_ALIASES.has(etLower)) {
            obj['entry_type'] = 'technical_note'
            obj['tags'] ??= []
            if (Array.isArray(obj['tags']) && !obj['tags'].includes(etLower)) {
                obj['tags'].push(etLower)
            }
            modified = true
        } else if (BUG_FIX_ALIASES.has(etLower)) {
            obj['entry_type'] = 'bug_fix'
            modified = true
        } else if (etLower === 'feature') {
            obj['entry_type'] = 'feature_implementation'
            modified = true
        } else if (etLower === 'meeting') {
            obj['entry_type'] = 'meeting_notes'
            modified = true
        } else if (!ENTRY_TYPES.some((t) => t === obj['entry_type'])) {
            obj['tags'] ??= []
            const cleanedTag = etLower.replace(/^[^a-z0-9]+/, '').replace(/_/g, '-')
            if (Array.isArray(obj['tags']) && cleanedTag.length > 0 && !obj['tags'].includes(cleanedTag)) {
                obj['tags'].push(cleanedTag)
            }
            obj['entry_type'] = 'other'
            modified = true
        }
    }

    if ('significance_type' in obj) {
        const originalSigType = obj['significance_type']
        coerceSignificanceAlias(obj)

        if (typeof obj['significance_type'] === 'string') {
            if (!SIGNIFICANCE_TYPES.some((t) => t === obj['significance_type'])) {
                const badSig = obj['significance_type'].toLowerCase().trim()
                obj['tags'] ??= []
                if (Array.isArray(obj['tags'])) obj['tags'].push(`significance:${badSig}`)
                delete obj['significance_type']
            }
        }

        if (originalSigType !== obj['significance_type']) modified = true
    }

    return modified
}

function healWorkspaceAndProjectContext(obj: Record<string, unknown>): boolean {
    const normalized = normalizeProjectFields(obj)

    // Only infer workspace/project from environment/cwd for entry creation payloads;
    // exclude ID-based mutations/reads and search queries from automatic CWD/keyword injection.
    const isSearchOrIdTarget =
        'entry_id' in obj ||
        'entryId' in obj ||
        'query' in obj ||
        'start_date' in obj ||
        'end_date' in obj ||
        obj['workspace_id'] === '*' ||
        obj['workspaceId'] === '*'
    const isEntryMutation =
        !isSearchOrIdTarget &&
        ('content' in obj || 'entry_type' in obj || 'title' in obj || 'entry' in obj)
    if (!isEntryMutation) {
        return normalized
    }

    const inferred = inferWorkspaceAndProject(obj)
    return normalized || inferred
}

/** Normalise `project_name` / string `project_number` aliases into numeric or workspace fields. */
function normalizeProjectFields(obj: Record<string, unknown>): boolean {
    let modified = false

    if (obj['workspace_id'] === undefined && typeof obj['workspaceId'] === 'string') {
        obj['workspace_id'] = obj['workspaceId']
        delete obj['workspaceId']
        modified = true
    } else if (obj['workspace_id'] === undefined && typeof obj['workspace'] === 'string') {
        obj['workspace_id'] = obj['workspace']
        delete obj['workspace']
        modified = true
    }

    const existingWs =
        typeof obj['workspace_id'] === 'string' && obj['workspace_id'].trim() !== ''
            ? obj['workspace_id'].trim()
            : undefined
    const rawProjName = obj['project_name'] ?? obj['projectName']
    if (rawProjName !== undefined) {
        const strVal =
            typeof rawProjName === 'string' || typeof rawProjName === 'number'
                ? String(rawProjName).trim()
                : ''
        const num = Number(strVal)
        let conflicting = false
        if (!Number.isNaN(num) && strVal !== '') {
            if (typeof obj['project_number'] === 'number' && obj['project_number'] !== num) {
                conflicting = true
            } else if (!('project_number' in obj) || obj['project_number'] === undefined) {
                obj['project_number'] = num
            }
        } else if (strVal !== '') {
            const byName = resolveProjectContext({ workspace_id: strVal })
            if (
                existingWs !== undefined &&
                existingWs.toLowerCase() !== byName.workspaceId.toLowerCase()
            ) {
                conflicting = true
            } else if (
                typeof obj['project_number'] === 'number' &&
                byName.projectNumber !== undefined &&
                obj['project_number'] !== byName.projectNumber
            ) {
                conflicting = true
            } else if (existingWs === undefined) {
                obj['workspace_id'] = strVal
            }
        }
        if (!conflicting) {
            delete obj['project_name']
            delete obj['projectName']
        }
        modified = true
    }

    if ('project_number' in obj && typeof obj['project_number'] === 'string') {
        const cleaned = obj['project_number'].trim()
        let num = Number(cleaned)
        if (Number.isNaN(num) && /^p-?\d+$/i.test(cleaned)) {
            num = Number(cleaned.replace(/^p-?/i, ''))
        }
        if (!Number.isNaN(num) && cleaned !== '') {
            obj['project_number'] = num
            modified = true
        } else if (
            cleaned !== '' &&
            (obj['workspace_id'] === undefined ||
                obj['workspace_id'] === null ||
                obj['workspace_id'] === '')
        ) {
            obj['workspace_id'] = cleaned
            delete obj['project_number']
            modified = true
        }
    }

    return modified
}

/** Fill in `workspace_id` / `project_number` from the registry, cwd or environment when missing. */
function inferWorkspaceAndProject(obj: Record<string, unknown>): boolean {
    let modified = false
    const wsId = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'] : undefined
    const projNum =
        typeof obj['project_number'] === 'number' && !Number.isNaN(obj['project_number'])
            ? obj['project_number']
            : undefined

    if (wsId === undefined || wsId === '' || wsId === 'default' || projNum === undefined) {
        // [INVARIANT] C3: no content/tag keyword guessing here — scope is bound by explicit
        // args or session/registry context only, so entry text cannot hijack the workspace.
        const resolved = resolveProjectContext({
            workspace_id: wsId,
            project_number: projNum,
        })
        if (
            resolved.workspaceId !== undefined &&
            resolved.workspaceId !== 'default' &&
            wsId === undefined
        ) {
            obj['workspace_id'] = resolved.workspaceId
            modified = true
        } else if (
            process.env['MCP_WORKSPACE_ID'] !== undefined &&
            process.env['MCP_WORKSPACE_ID'].trim() !== '' &&
            wsId === undefined
        ) {
            obj['workspace_id'] = process.env['MCP_WORKSPACE_ID'].trim()
            modified = true
        } else if (wsId === undefined && !('entry_id' in obj)) {
            obj['workspace_id'] = resolved.workspaceId ?? 'default'
            modified = true
        }
        if (
            obj['project_number'] === undefined &&
            resolved.projectNumber !== undefined &&
            wsId !== 'default'
        ) {
            obj['project_number'] = resolved.projectNumber
            modified = true
        }
    }

    return modified
}

function healValidationAndScoreFields(obj: Record<string, unknown>): boolean {
    let modified = false

    for (const numField of ['trust_score', 'impact_score'] as const) {
        if (numField in obj && typeof obj[numField] === 'string') {
            const n = Number(obj[numField])
            if (!Number.isNaN(n)) {
                obj[numField] = n
                modified = true
            }
        }
    }

    if (
        'validation_status' in obj &&
        obj['validation_status'] !== undefined &&
        obj['validation_status'] !== null
    ) {
        const rawVs = obj['validation_status']
        const vsStr =
            typeof rawVs === 'string'
                ? rawVs.trim().toLowerCase()
                : typeof rawVs === 'number' || typeof rawVs === 'boolean'
                  ? String(rawVs)
                  : ''
        if (rawVs === true || PASSED_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'passed'
            modified = true
        } else if (rawVs === false || FAILED_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'failed'
            modified = true
        } else if (NONE_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'none'
        } else if (typeof rawVs === 'string' && !['passed', 'none', 'failed'].includes(vsStr)) {
            obj['validation_status'] = 'none'
            modified = true
        }
    }

    return modified
}

function healNestedContainersAndEntryIds(obj: Record<string, unknown>): boolean {
    let modified = false

    if (
        'entry' in obj &&
        typeof obj['entry'] === 'object' &&
        obj['entry'] !== null &&
        !Array.isArray(obj['entry'])
    ) {
        const nested = obj['entry'] as Record<string, unknown>
        Reflect.deleteProperty(obj, 'entry')
        for (const [k, v] of Object.entries(nested)) {
            if (!(k in obj) && v !== undefined) obj[k] = v
        }
        modified = true
    }

    for (const containerKey of ['filters', 'filter']) {
        if (containerKey in obj) {
            const val = obj[containerKey]
            Reflect.deleteProperty(obj, containerKey)
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                    if (!(k in obj) && v !== undefined) obj[k] = v
                }
            }
            modified = true
        }
    }

    if ('entry' in obj) {
        const entryVal = obj['entry']
        if (
            typeof entryVal === 'number' ||
            (typeof entryVal === 'string' &&
                /^\d+$/.test(entryVal.trim()) &&
                !('tags' in obj) &&
                !('entry_type' in obj) &&
                !('title' in obj))
        ) {
            if (!('entry_id' in obj)) {
                obj['entry_id'] = typeof entryVal === 'number' ? entryVal : Number(entryVal.trim())
                modified = true
            }
            Reflect.deleteProperty(obj, 'entry')
        }
    }

    if ('entry_id' in obj && typeof obj['entry_id'] === 'string') {
        const cleaned = obj['entry_id'].replace(/^[^0-9]+/, '')
        const num = Number(cleaned)
        if (!Number.isNaN(num) && cleaned.trim() !== '') {
            obj['entry_id'] = num
            modified = true
        }
    }
    if ('entry_ids' in obj && Array.isArray(obj['entry_ids'])) {
        const healedIds = obj['entry_ids'].map((id: unknown) => {
            if (typeof id === 'string') {
                const cleaned = id.replace(/^[^0-9]+/, '')
                const num = Number(cleaned)
                return !Number.isNaN(num) && cleaned.trim() !== '' ? num : id
            }
            return id
        })
        if (JSON.stringify(obj['entry_ids']) !== JSON.stringify(healedIds)) {
            obj['entry_ids'] = healedIds
            modified = true
        }
    }

    return modified
}

/**
 * Shared preprocessor to heal common LLM hallucinations in payloads before Zod validation.
 */
export function healAgentHallucinations(val: unknown): unknown {
    if (typeof val !== 'object' || val === null) return val

    const obj = { ...(val as Record<string, unknown>) }
    let modified = false

    for (const [badKey, goodKey] of Object.entries(KEY_ALIAS_MAP)) {
        if (badKey in obj) {
            if (!(goodKey in obj) && obj[badKey] !== undefined) obj[goodKey] = obj[badKey]
            Reflect.deleteProperty(obj, badKey)
            modified = true
        }
    }

    if (healValidationAndScoreFields(obj)) modified = true
    if (healNestedContainersAndEntryIds(obj)) modified = true

    for (const key of CONTENT_ALIASES) {
        if (key in obj && !('content' in obj)) {
            obj['content'] = obj[key]
            Reflect.deleteProperty(obj, key)
            modified = true
            break
        } else if (key in obj) {
            Reflect.deleteProperty(obj, key)
            modified = true
        }
    }

    if (healTitleAndAutoContext(obj)) modified = true
    if (healRelationshipFields(obj)) modified = true
    if (healAnchorsField(obj)) modified = true
    if (healSortByField(obj)) modified = true
    if (healMetadataAndContextFields(obj)) modified = true
    if (healTagsAndEntryType(obj)) modified = true
    if (healWorkspaceAndProjectContext(obj)) modified = true

    return modified ? obj : val
}
