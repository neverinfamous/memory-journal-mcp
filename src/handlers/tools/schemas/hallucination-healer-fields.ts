/**
 * Title and auto_context healers used by the shared hallucination healer.
 */

import { logger } from '../../../utils/logger.js'
import { safeString } from './constants-and-primitives.js'

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
        logger.debug('Could not repair single-quoted auto_context JSON', {
            module: 'HallucinationHealer',
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}

/** Normalise object-valued or single-quoted `auto_context` into a JSON string (or drop empties). */
function healAutoContextField(obj: Record<string, unknown>): boolean {
    if (!('auto_context' in obj)) return false
    let modified = false

    if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null) {
        try {
            obj['auto_context'] = JSON.stringify(obj['auto_context'])
            modified = true
        } catch (err) {
            logger.debug('Could not stringify auto_context object', {
                module: 'HallucinationHealer',
                error: err instanceof Error ? err.message : String(err),
            })
        }
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
    if (typeof item === 'number' && !Number.isNaN(item)) {
        return { targetId: item, relType: canonicalType }
    }
    if (typeof item === 'string' && /^\d+$/.test(item.trim())) {
        return { targetId: Number(item.trim()), relType: canonicalType }
    }
    if (typeof item !== 'object' || item === null) return { relType: canonicalType }
    const itemObj = item as Record<string, unknown>
    const rawId =
        itemObj['targetId'] ??
        itemObj['target_id'] ??
        itemObj['to_entry_id'] ??
        itemObj['toEntryId'] ??
        itemObj['id']
    let targetId: number | undefined
    if (typeof rawId === 'number' && !Number.isNaN(rawId)) targetId = rawId
    else if (typeof rawId === 'string' && /^\d+$/.test(rawId.trim())) targetId = Number(rawId.trim())
    const explicitType =
        itemObj['relationType'] ??
        itemObj['relation_type'] ??
        itemObj['relationship_type'] ??
        itemObj['type']
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
            (r['targetId'] === targetId || r['target_id'] === targetId || r['to_entry_id'] === targetId) &&
            (r['relationType'] === relType || r['relation_type'] === relType)
    )
    if (!alreadyExists) relList.push({ targetId, relationType: relType })
}

/** Fold top-level relationship parameters (evolves_from, references, implements, etc.) into the relationships array. */
export function healRelationshipFields(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('relationship' in obj && !('relationships' in obj)) {
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

const ANCHOR_STATUS_ALIAS_MAP: Record<string, 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable'> = {
    pending: 'pending',
    valid: 'valid',
    active: 'valid',
    current: 'valid',
    ok: 'valid',
    verified: 'valid',
    clean: 'valid',
    fresh: 'valid',
    stale: 'stale',
    outdated: 'stale',
    modified: 'stale',
    dirty: 'stale',
    invalidated: 'invalidated',
    invalid: 'invalidated',
    deleted: 'invalidated',
    removed: 'invalidated',
    missing: 'invalidated',
    unresolvable: 'unresolvable',
    unresolved: 'unresolvable',
}

export function coerceAnchorStatusAlias(
    raw: unknown
): 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable' | undefined {
    if (typeof raw !== 'string') return undefined
    return ANCHOR_STATUS_ALIAS_MAP[raw.trim().toLowerCase()]
}

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
    return SORT_BY_ALIAS_MAP[cleaned]
}

/** Normalise string or aliased `anchors` payloads into `{ anchor_path, anchor_type, status }` items. */
export function healAnchorsField(obj: Record<string, unknown>): boolean {
    let modified = false

    for (const aliasKey of ['anchor', 'file_anchors', 'fileAnchors'] as const) {
        if (aliasKey in obj) {
            if (!('anchors' in obj) && obj[aliasKey] !== undefined) {
                obj['anchors'] = obj[aliasKey]
            }
            Reflect.deleteProperty(obj, aliasKey)
            modified = true
        }
    }

    if (!('anchors' in obj) || obj['anchors'] === undefined || obj['anchors'] === null) {
        return modified
    }

    if (typeof obj['anchors'] === 'string') {
        const trimmed = obj['anchors'].trim()
        if (trimmed === '') {
            delete obj['anchors']
            return true
        }
        obj['anchors'] = [trimmed]
        modified = true
    }

    if (!Array.isArray(obj['anchors'])) return modified

    const healedAnchors: unknown[] = []
    for (const item of obj['anchors']) {
        if (typeof item === 'string') {
            const trimmed = item.trim()
            if (trimmed === '') {
                modified = true
                continue
            }
            healedAnchors.push({
                anchor_path: trimmed,
                anchor_type: trimmed.includes('#') ? 'symbol' : 'file',
                status: 'pending',
            })
            modified = true
            continue
        }
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const itemObj = item as Record<string, unknown>
            const rawPath =
                itemObj['anchor_path'] ??
                itemObj['anchorPath'] ??
                itemObj['path'] ??
                itemObj['file'] ??
                itemObj['file_path'] ??
                itemObj['filepath']
            const rawType = itemObj['anchor_type'] ?? itemObj['anchorType'] ?? itemObj['type']
            const rawStatus = itemObj['status']
            const normalizedPath = typeof rawPath === 'string' ? rawPath.trim() : undefined
            const normalizedType =
                typeof rawType === 'string' && rawType.trim() !== ''
                    ? rawType.trim()
                    : normalizedPath?.includes('#') === true
                      ? 'symbol'
                      : 'file'
            const mappedStatus =
                rawStatus !== undefined ? (coerceAnchorStatusAlias(rawStatus) ?? 'pending') : undefined

            if (normalizedPath !== undefined && normalizedPath !== '') {
                const rebuilt: Record<string, unknown> = {
                    anchor_path: normalizedPath,
                    anchor_type: normalizedType,
                    ...(mappedStatus !== undefined ? { status: mappedStatus } : {}),
                }
                if (
                    itemObj['anchor_path'] !== rebuilt['anchor_path'] ||
                    itemObj['anchor_type'] !== rebuilt['anchor_type'] ||
                    itemObj['status'] !== rebuilt['status'] ||
                    Object.keys(itemObj).length !== Object.keys(rebuilt).length
                ) {
                    modified = true
                }
                healedAnchors.push(rebuilt)
                continue
            }
        }
        healedAnchors.push(item)
    }

    if (modified) {
        obj['anchors'] = healedAnchors
    }
    return modified
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
            if (!('include_archived' in obj) && typeof obj[aliasKey] === 'boolean') {
                obj['include_archived'] = obj[aliasKey]
            }
            Reflect.deleteProperty(obj, aliasKey)
            modified = true
        }
    }
    return modified
}
