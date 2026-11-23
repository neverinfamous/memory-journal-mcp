/**
 * Title and auto_context healers used by the shared hallucination healer.
 */

import {
    healAutoContext,
    healSessionSummaryContent,
    logNormalizerDebug,
} from '../../../codemode/normalizers/shared-utils.js'
import {
    RELATIONSHIP_TARGET_KEYS,
    RELATIONSHIP_TYPE_KEYS,
    pickRecordField,
    safeString,
} from './entry-constants.js'

/** Fold title/heading/subject/name aliases into the content as a markdown heading. */
function healTitleField(obj: Record<string, unknown>): boolean {
    if (!('title' in obj || 'heading' in obj || 'subject' in obj || 'name' in obj)) {
        return false
    }
    const rawTitle = obj['title'] ?? obj['heading'] ?? obj['subject'] ?? obj['name']
    const titleStr =
        rawTitle !== undefined && rawTitle !== null ? safeString(rawTitle).trim() : ''
    if (titleStr !== '') {
        const cleanTitle = titleStr.replace(/^#+\s*/, '')
        const currentContent = safeString(obj['content']).trim()
        const hasNoContent =
            !('content' in obj) ||
            obj['content'] === undefined ||
            obj['content'] === null ||
            currentContent === ''
        if (hasNoContent) {
            // [INVARIANT] H8: update payloads (entry_id/id) fully overwrite content, so a
            // bare title must never synthesize a replacement body.
            if (!('query' in obj) && !isUpdatePayload(obj)) obj['content'] = `# ${cleanTitle}`
        } else if (!currentContent.startsWith(`# ${cleanTitle}`)) {
            obj['content'] = `# ${cleanTitle}\n\n${currentContent}`
        }
    }
    delete obj['title']
    delete obj['heading']
    delete obj['subject']
    delete obj['name']
    return true
}

function repairSingleQuotedJson(raw: string): string | undefined {
    try {
        JSON.parse(raw)
        return undefined
    } catch {
        // Proceed to single-quote repair below.
    }
    try {
        const fixed = raw.replace(/'/g, '"')
        const parsed = JSON.parse(fixed) as Record<string, unknown>
        return JSON.stringify(parsed)
    } catch (err) {
        logNormalizerDebug('Could not repair single-quoted auto_context JSON', {
            module: 'HallucinationHealer',
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}

/** Normalise object-valued, key-aliased, or single-quoted `auto_context` into a JSON string (or drop empties). */
function healAutoContextField(obj: Record<string, unknown>): boolean {
    if (!('auto_context' in obj)) return false
    let modified = false

    if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null && !Array.isArray(obj['auto_context'])) {
        obj['auto_context'] = { ...(obj['auto_context'] as Record<string, unknown>) }
        healAutoContext(obj)
        try {
            obj['auto_context'] = JSON.stringify(obj['auto_context'])
            modified = true
        } catch (err) {
            logNormalizerDebug('Could not stringify auto_context object', {
                module: 'HallucinationHealer',
                error: err instanceof Error ? err.message : String(err),
            })
        }
    } else if (typeof obj['auto_context'] === 'string') {
        const beforeStr = obj['auto_context']
        healAutoContext(obj)
        if (obj['auto_context'] !== beforeStr) modified = true
    }
    if (typeof obj['auto_context'] !== 'string') return modified

    const rawStr = obj['auto_context']
    const ac = rawStr.trim().toLowerCase()
    if (ac === 'none' || ac === '{}' || ac === '{"commits":[]}') {
        delete obj['auto_context']
        return true
    }
    if (ac.startsWith('{') && ac.includes("'")) {
        const repaired = repairSingleQuotedJson(rawStr)
        if (repaired !== undefined) {
            obj['auto_context'] = repaired
            modified = true
        }
    }

    return modified
}

/** Promote `session-summary` entry_type and normalize its 4-header structure for direct MCP calls. */
export function healSessionSummaryPayload(obj: Record<string, unknown>): boolean {
    if ('query' in obj || !Array.isArray(obj['tags']) || !obj['tags'].includes('session-summary')) {
        return false
    }
    if (
        obj['tags'].includes('semantic-summary') ||
        obj['tags'].includes('cms-02-nrem-consolidation')
    ) {
        obj['tags'] = obj['tags'].filter((t: unknown) => t !== 'session-summary')
        return true
    }
    let modified = false
    const isUpdate = isUpdatePayload(obj)
    if (!isUpdate && obj['entry_type'] === undefined) {
        obj['entry_type'] = 'retrospective'
        modified = true
    }
    if (typeof obj['content'] === 'string' && /^#+\s+/m.test(obj['content'])) {
        const hasAccomplishedLikeHeader =
            /^#+\s+(?:Accomplished|Accomplishments|Completed|Done|What I did|What we did)\b/im.test(
                obj['content']
            )
        if (!isUpdate || hasAccomplishedLikeHeader) {
            const healed = healSessionSummaryContent(obj['content'], {
                normalizeSynonyms: true,
                usePeriodOnNone: true,
            })
            if (healed !== obj['content']) {
                obj['content'] = healed
                modified = true
            }
        }
    }
    return modified
}

export function healTitleAndAutoContext(obj: Record<string, unknown>): boolean {
    const titleModified = healTitleField(obj)
    const autoContextModified = healAutoContextField(obj)
    return titleModified || autoContextModified
}

const RELATION_KEY_MAP: Record<string, string> = {
    evolves_from: 'evolves_from',
    evolvesFrom: 'evolves_from',
    references: 'references',
    implements: 'implements',
    clarifies: 'clarifies',
    response_to: 'response_to',
    responseTo: 'response_to',
    blocked_by: 'blocked_by',
    blockedBy: 'blocked_by',
    resolved: 'resolved',
    resolves: 'resolves',
    caused: 'caused',
    relates_to: 'relates_to',
    relatesTo: 'relates_to',
    related_to: 'relates_to',
    relatedTo: 'relates_to',
    depends_on: 'depends_on',
    dependsOn: 'depends_on',
}

/** Update payloads identify an existing entry; their `content` replaces the stored body. */
export function isUpdatePayload(obj: Record<string, unknown>): boolean {
    return 'entry_id' in obj || 'entryId' in obj || 'id' in obj
}

function appendLabeledContent(obj: Record<string, unknown>, label: string, value: string): void {
    const trimmed = value.trim()
    if (trimmed === '') return
    const currentContent = safeString(obj['content']).trim()
    if (currentContent === '' && isUpdatePayload(obj)) return
    obj['content'] = currentContent !== '' ? `${currentContent}\n\n**${label}:** ${trimmed}` : trimmed
}

function readRelationshipItem(
    item: unknown,
    canonicalType: string
): { targetId?: number; relType: string } {
    if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) {
        return { targetId: item, relType: canonicalType }
    }
    if (typeof item === 'string') {
        const trimmed = item.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) {
                return { targetId: parsed, relType: canonicalType }
            }
        }
    }
    if (typeof item !== 'object' || item === null) return { relType: canonicalType }
    const itemObj = item as Record<string, unknown>
    const rawId = pickRecordField(itemObj, RELATIONSHIP_TARGET_KEYS)
    let targetId: number | undefined
    if (typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0) targetId = rawId
    else if (typeof rawId === 'string') {
        const trimmed = rawId.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) targetId = parsed
        }
    }
    const explicitType = pickRecordField(itemObj, RELATIONSHIP_TYPE_KEYS)
    const relType =
        typeof explicitType === 'string' && explicitType.trim() !== ''
            ? explicitType.trim()
            : canonicalType
    return targetId !== undefined ? { targetId, relType } : { relType }
}

function pushUniqueRelationship(
    obj: Record<string, unknown>,
    targetId: number,
    relType: string
): void {
    if (!Array.isArray(obj['relationships'])) obj['relationships'] = []
    const relList = obj['relationships'] as Record<string, unknown>[]
    const alreadyExists = relList.some(
        (r) =>
            typeof r === 'object' &&
            r !== null &&
            RELATIONSHIP_TARGET_KEYS.some((k) => r[k] === targetId) &&
            RELATIONSHIP_TYPE_KEYS.some((k) => r[k] === relType)
    )
    if (!alreadyExists) relList.push({ targetId, relationType: relType })
}

/** Fold top-level relationship parameters (evolves_from, references, implements, etc.) into the relationships array. */
export function healRelationshipFields(obj: Record<string, unknown>): boolean {
    let modified = false

    if (obj['relationship'] !== undefined && obj['relationships'] === undefined) {
        obj['relationships'] = Array.isArray(obj['relationship']) ? obj['relationship'] : [obj['relationship']]
        Reflect.deleteProperty(obj, 'relationship')
        modified = true
    }

    for (const [key, canonicalType] of Object.entries(RELATION_KEY_MAP)) {
        if (!(key in obj)) continue
        const val = obj[key]
        Reflect.deleteProperty(obj, key)
        modified = true

        if (key === 'references' && typeof val === 'string' && !/^\d+$/.test(val.trim())) {
            appendLabeledContent(obj, 'References', val)
            continue
        }

        const items = Array.isArray(val) ? val : [val]
        for (const item of items) {
            const parsed = readRelationshipItem(item, canonicalType)
            if (parsed.targetId !== undefined) {
                pushUniqueRelationship(obj, parsed.targetId, parsed.relType)
            } else if (typeof item === 'string') {
                appendLabeledContent(obj, key, item)
            }
        }
    }

    return modified
}

export { coerceAnchorStatusAlias, healAnchorsField } from './hallucination-healer-anchors.js'

const SORT_BY_ALIAS_MAP: Record<string, 'timestamp' | 'importance'> = {
    timestamp: 'timestamp',
    date: 'timestamp',
    created_at: 'timestamp',
    created: 'timestamp',
    updated_at: 'timestamp',
    updated: 'timestamp',
    time: 'timestamp',
    recent: 'timestamp',
    newest: 'timestamp',
    latest: 'timestamp',
    chronological: 'timestamp',
    id: 'timestamp',
    importance: 'importance',
    score: 'importance',
    relevance: 'importance',
    rank: 'importance',
    impact: 'importance',
    impact_score: 'importance',
    trust: 'importance',
    trust_score: 'importance',
    priority: 'importance',
    significance: 'importance',
}

export function normalizeEntrySortByValue(raw: unknown): 'timestamp' | 'importance' | undefined {
    if (typeof raw !== 'string') return undefined
    const cleaned = raw.trim().toLowerCase().replace(/_(?:asc|desc)$/i, '')
    return Object.hasOwn(SORT_BY_ALIAS_MAP, cleaned) ? SORT_BY_ALIAS_MAP[cleaned] : undefined
}

/** Normalise common `sort_by` aliases (`date`, `created_at`, `score`, `relevance`) to `'timestamp' | 'importance'`. */
export function healSortByField(obj: Record<string, unknown>): boolean {
    if (!('sort_by' in obj) || typeof obj['sort_by'] !== 'string') return false
    const mapped = normalizeEntrySortByValue(obj['sort_by'])
    if (mapped !== undefined && mapped !== obj['sort_by']) {
        obj['sort_by'] = mapped
        return true
    }
    return false
}

/** Normalise `is_archived`, `isArchived`, `archived`, and `includeArchived` into `include_archived` on read/search payloads. */
export function healIncludeArchivedField(obj: Record<string, unknown>): boolean {
    let modified = false
    for (const aliasKey of ['is_archived', 'isArchived', 'archived', 'includeArchived'] as const) {
        if (aliasKey in obj) {
            if (obj['include_archived'] === undefined && typeof obj[aliasKey] === 'boolean') {
                obj['include_archived'] = obj[aliasKey]
            }
            Reflect.deleteProperty(obj, aliasKey)
            modified = true
        }
    }
    return modified
}
