/**
 * Shared Preprocessor to Heal Common LLM Hallucinations in Payloads Before Zod Validation
 */

import {
    healTitleAndAutoContext,
    healRelationshipFields,
    healAnchorsField,
    healSortByField,
    healSessionSummaryPayload,
    isUpdatePayload,
} from './hallucination-healer-fields.js'
import {
    normalizeProjectFields,
    inferWorkspaceAndProject,
    healValidationAndScoreFields,
} from './hallucination-healer-scope.js'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    coerceSignificanceAlias,
    KEY_ALIAS_MAP,
    CONTENT_ALIASES,
} from './constants-and-primitives.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import {
    normalizeTagsField,
    mapKnownEntryTypeAlias,
    unpackFilterContainers,
    coerceEntryIdField,
    parseHealedEntryIdString,
    healSearchPayload,
} from './hallucination-healer-search.js'
import { logger } from '../../../utils/logger.js'
import { setNormalizerDebugLogger } from '../../../codemode/normalizers/shared-utils.js'

setNormalizerDebugLogger((message, context) => {
    logger.debug(message, context)
})

export { healSearchPayload }

function appendHealedTag(obj: Record<string, unknown>, tag: string): void {
    const rawTags = obj['tags']
    if (Array.isArray(rawTags)) {
        const existingTags: unknown[] = rawTags
        if (!existingTags.includes(tag)) obj['tags'] = [...existingTags, tag]
        return
    }
    // [INVARIANT] M7: never synthesize `tags: [...]` onto update payloads when `tags` was omitted,
    // or updateEntry will overwrite and wipe existing entry tags.
    if (!isUpdatePayload(obj) && (obj['tags'] === undefined || obj['tags'] === null)) {
        obj['tags'] = [tag]
    }
}

function toStr(v: unknown, pretty = false): string {
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v !== null && v !== undefined) {
        try {
            return pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v)
        } catch {
            return ''
        }
    }
    return ''
}

const CONTEXT_WRAPPER_KEYS = new Set(['content', 'text', 'raw', 'body'])

function extractUnwrappedContextWrapper(val: unknown): string | undefined {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return undefined
    const rec = val as Record<string, unknown>
    const rawContent = rec['content']
    if (typeof rawContent !== 'string' || rawContent.trim() === '') return undefined
    const keys = Object.keys(rec)
    return keys.length > 0 && keys.every((k) => CONTEXT_WRAPPER_KEYS.has(k)) ? rawContent : undefined
}

function healMetadataAndContextFields(obj: Record<string, unknown>): boolean {
    let modified = false

    for (const extraKey of ['date', 'created_at', 'updated_at', 'type', 'status']) {
        if (extraKey in obj && extraKey !== 'entry_type') {
            if (extraKey === 'type' && obj['entry_type'] === undefined && obj['type'] !== undefined) {
                obj['entry_type'] = obj['type']
            }
            Reflect.deleteProperty(obj, extraKey)
            modified = true
        }
    }

    for (const [field, label] of [
        ['context', 'Context'], ['focus', 'Focus'], ['resolution', 'Resolution'],
    ] as const) {
        if (!(field in obj)) continue
        if (field === 'context') {
            const unwrapped = extractUnwrappedContextWrapper(obj[field])
            if (unwrapped !== undefined) {
                const existingContent = toStr(obj['content'])
                if (existingContent.trim() === '' && !isUpdatePayload(obj)) {
                    obj['content'] = unwrapped
                } else if (
                    existingContent.trim() !== '' &&
                    existingContent.trim() !== unwrapped.trim()
                ) {
                    obj['content'] = `${existingContent}\n\n${unwrapped}`
                }
                Reflect.deleteProperty(obj, field)
                modified = true
                continue
            }
        }
        const val =
            field === 'context' && typeof obj[field] === 'object' && obj[field] !== null
                ? toStr(obj[field], true)
                : toStr(obj[field])
        const existingContent = toStr(obj['content'])
        // [INVARIANT] H8: never synthesize a full-overwrite body on update payloads.
        if (val !== '' && (existingContent !== '' || !isUpdatePayload(obj))) {
            obj['content'] =
                existingContent !== '' ? `${existingContent}\n\n**${label}:** ${val}` : val
        }
        Reflect.deleteProperty(obj, field)
        modified = true
    }

    if ('artifacts' in obj) {
        if (Array.isArray(obj['artifacts']) && obj['artifacts'].length > 0) {
            const artStr = obj['artifacts']
                .map((a) => toStr(a))
                .join(', ')
            const existingContent = toStr(obj['content'])
            if (existingContent !== '' || !isUpdatePayload(obj)) {
                obj['content'] =
                    existingContent !== '' ? `${existingContent}\n\n**Artifacts:** ${artStr}` : artStr
            }
        }
        Reflect.deleteProperty(obj, 'artifacts')
        modified = true
    }

    if ('category' in obj) {
        if (typeof obj['category'] === 'string' && obj['category'].trim() !== '') {
            appendHealedTag(obj, obj['category'].trim())
        }
        Reflect.deleteProperty(obj, 'category')
        modified = true
    }

    return modified
}

const ENTRY_TYPE_SET = new Set<string>(ENTRY_TYPES)
const SIGNIFICANCE_TYPE_SET = new Set<string>(SIGNIFICANCE_TYPES)

function healTagsAndEntryType(obj: Record<string, unknown>): boolean {
    let modified = normalizeTagsField(obj)

    if ('entry_type' in obj && typeof obj['entry_type'] === 'string') {
        const etLower = obj['entry_type'].toLowerCase()
        const mapped = mapKnownEntryTypeAlias(etLower)
        if (mapped !== undefined) {
            obj['entry_type'] = mapped.entryType
            if (mapped.tag !== undefined) appendHealedTag(obj, mapped.tag)
            if (
                mapped.significanceType !== undefined &&
                (obj['significance_type'] === undefined ||
                    obj['significance_type'] === null ||
                    obj['significance_type'] === '')
            ) {
                obj['significance_type'] = mapped.significanceType
            }
            modified = true
        } else if (!ENTRY_TYPE_SET.has(obj['entry_type'])) {
            const cleanedTag = etLower.replace(/^[^a-z0-9]+/, '').replace(/_/g, '-')
            if (cleanedTag.length > 0) appendHealedTag(obj, cleanedTag)
            obj['entry_type'] = 'other'
            modified = true
        }
    }

    if ('significance_type' in obj) {
        if (obj['significance_type'] === null && !isUpdatePayload(obj)) {
            Reflect.deleteProperty(obj, 'significance_type')
            modified = true
        }
        const originalSigType = obj['significance_type']
        coerceSignificanceAlias(obj)

        if (typeof obj['significance_type'] === 'string') {
            if (!SIGNIFICANCE_TYPE_SET.has(obj['significance_type'])) {
                const badSig = obj['significance_type'].toLowerCase().trim()
                appendHealedTag(obj, `significance:${badSig}`)
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
            if (obj[k] === undefined && v !== undefined) obj[k] = v
        }
        modified = true
    }

    if (unpackFilterContainers(obj)) modified = true

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
            if (obj['entry_id'] === undefined) {
                const parsed = parsePositiveProjectNumber(typeof entryVal === 'string' ? entryVal.trim() : entryVal)
                if (parsed !== undefined) {
                    obj['entry_id'] = parsed
                    modified = true
                    Reflect.deleteProperty(obj, 'entry')
                }
            } else {
                Reflect.deleteProperty(obj, 'entry')
            }
        }
    }

    if (coerceEntryIdField(obj)) modified = true
    if ('entry_ids' in obj && Array.isArray(obj['entry_ids'])) {
        let idsChanged = false
        const healedIds = obj['entry_ids'].map((id: unknown) => {
            if (typeof id === 'string') {
                const parsed = parseHealedEntryIdString(id)
                if (parsed !== undefined) {
                    idsChanged = true
                    return parsed
                }
            }
            return id
        })
        if (idsChanged) {
            obj['entry_ids'] = healedIds
            modified = true
        }
    }

    return modified
}

function synthesizeFallbackAnchorContent(obj: Record<string, unknown>): boolean {
    if (isUpdatePayload(obj) || 'query' in obj) return false
    const currentContent = toStr(obj['content']).trim()
    if (currentContent !== '') return false
    if (!Array.isArray(obj['anchors']) || obj['anchors'].length === 0) return false

    const paths = obj['anchors']
        .map((a) => {
            if (typeof a === 'string') return a.trim()
            if (typeof a === 'object' && a !== null && 'anchor_path' in a) {
                const p = (a as Record<string, unknown>)['anchor_path']
                return typeof p === 'string' ? p.trim() : ''
            }
            return ''
        })
        .filter((p) => p !== '')
    if (paths.length === 0) return false

    const entryType =
        typeof obj['entry_type'] === 'string' && obj['entry_type'].trim() !== ''
            ? obj['entry_type'].trim()
            : 'technical_note'
    const tagList = Array.isArray(obj['tags'])
        ? obj['tags'].filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        : []
    const heading =
        tagList.length > 0 ? `# ${entryType} (${tagList.join(', ')})` : `# ${entryType}`
    const bullets = paths.map((p) => `- \`${p}\``).join('\n')
    obj['content'] = `${heading}\n\n## Anchored Files\n${bullets}`
    return true
}

function remapAgentKeyAliases(obj: Record<string, unknown>): boolean {
    let modified = false
    for (const [badKey, goodKey] of Object.entries(KEY_ALIAS_MAP)) {
        if (badKey in obj) {
            const isScopeAlias =
                badKey === 'project_id' || badKey === 'projectId' || badKey === 'projectNumber'
            if (
                isScopeAlias &&
                goodKey in obj &&
                obj[goodKey] !== undefined &&
                obj[goodKey] !== obj[badKey]
            ) {
                continue
            }
            if (obj[goodKey] === undefined && obj[badKey] !== undefined) obj[goodKey] = obj[badKey]
            Reflect.deleteProperty(obj, badKey)
            modified = true
        }
    }
    return modified
}

/**
 * Shared preprocessor to heal common LLM hallucinations in payloads before Zod validation.
 */
export function healAgentHallucinations(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val

    const obj = { ...(val as Record<string, unknown>) }
    let modified = false

    if (remapAgentKeyAliases(obj)) modified = true
    if (healNestedContainersAndEntryIds(obj)) {
        modified = true
        // Re-run alias normalization after unwrapping `entry` / `filters` containers.
        remapAgentKeyAliases(obj)
    }
    if (healValidationAndScoreFields(obj)) modified = true

    for (const key of CONTENT_ALIASES) {
        if (key in obj && obj['content'] === undefined) {
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
    if (synthesizeFallbackAnchorContent(obj)) modified = true
    if (healSessionSummaryPayload(obj)) modified = true
    if (healWorkspaceAndProjectContext(obj)) modified = true

    return modified ? obj : val
}
