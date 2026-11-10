/**
 * Title and auto_context healers used by the shared hallucination healer.
 */

import { logger } from '../../../utils/logger.js'
import { safeString } from './constants-and-primitives.js'

/** Fold title/heading/subject/name aliases into the content as a markdown heading. */
function healTitleField(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('title' in obj || 'heading' in obj || 'subject' in obj || 'name' in obj) {
        const rawTitle = obj['title'] ?? obj['heading'] ?? obj['subject'] ?? obj['name']
        if (rawTitle !== undefined && rawTitle !== null) {
            const titleStr = safeString(rawTitle).trim()
            if (titleStr !== '') {
                const cleanTitle = titleStr.replace(/^#+\s*/, '')
                const currentContent = safeString(obj['content']).trim()
                if (
                    !('content' in obj) ||
                    obj['content'] === undefined ||
                    obj['content'] === null ||
                    currentContent === ''
                ) {
                    if (!('query' in obj)) obj['content'] = `# ${cleanTitle}`
                } else if (!currentContent.startsWith(`# ${cleanTitle}`)) {
                    obj['content'] = `# ${cleanTitle}\n\n${currentContent}`
                }
            }
        }
        delete obj['title']
        delete obj['heading']
        delete obj['subject']
        delete obj['name']
        modified = true
    }

    return modified
}

/** Normalise object-valued or single-quoted `auto_context` into a JSON string (or drop empties). */
function healAutoContextField(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('auto_context' in obj) {
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
        if (typeof obj['auto_context'] === 'string') {
            const ac = obj['auto_context'].trim().toLowerCase()
            if (ac === 'none' || ac === '{}' || ac === '{"commits":[]}') {
                delete obj['auto_context']
                modified = true
            } else if (ac.startsWith('{') && ac.includes("'")) {
                try {
                    JSON.parse(obj['auto_context'])
                } catch {
                    try {
                        const fixed = obj['auto_context'].replace(/'/g, '"')
                        const parsed = JSON.parse(fixed) as Record<string, unknown>
                        obj['auto_context'] = JSON.stringify(parsed)
                        modified = true
                    } catch (err) {
                        logger.debug('Could not repair single-quoted auto_context JSON', {
                            module: 'HallucinationHealer',
                            error: err instanceof Error ? err.message : String(err),
                        })
                    }
                }
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
            const trimmed = val.trim()
            if (trimmed !== '') {
                const currentContent = safeString(obj['content']).trim()
                obj['content'] =
                    currentContent !== '' ? `${currentContent}\n\n**References:** ${trimmed}` : trimmed
            }
            continue
        }

        const items = Array.isArray(val) ? val : [val]
        for (const item of items) {
            let targetId: number | undefined
            let relType = canonicalType

            if (typeof item === 'number' && !Number.isNaN(item)) {
                targetId = item
            } else if (typeof item === 'string' && /^\d+$/.test(item.trim())) {
                targetId = Number(item.trim())
            } else if (typeof item === 'object' && item !== null) {
                const itemObj = item as Record<string, unknown>
                const rawId =
                    itemObj['targetId'] ??
                    itemObj['target_id'] ??
                    itemObj['to_entry_id'] ??
                    itemObj['toEntryId'] ??
                    itemObj['id']
                if (typeof rawId === 'number' && !Number.isNaN(rawId)) {
                    targetId = rawId
                } else if (typeof rawId === 'string' && /^\d+$/.test(rawId.trim())) {
                    targetId = Number(rawId.trim())
                }
                const explicitType =
                    itemObj['relationType'] ??
                    itemObj['relation_type'] ??
                    itemObj['relationship_type'] ??
                    itemObj['type']
                if (typeof explicitType === 'string' && explicitType.trim() !== '') {
                    relType = explicitType.trim()
                }
            }

            if (targetId !== undefined) {
                if (!Array.isArray(obj['relationships'])) {
                    obj['relationships'] = []
                }
                const relList = obj['relationships'] as Record<string, unknown>[]
                const alreadyExists = relList.some(
                    (r) =>
                        typeof r === 'object' &&
                        r !== null &&
                        (r['targetId'] === targetId ||
                            r['target_id'] === targetId ||
                            r['to_entry_id'] === targetId) &&
                        (r['relationType'] === relType || r['relation_type'] === relType)
                )
                if (!alreadyExists) {
                    relList.push({ targetId, relationType: relType })
                }
            } else if (typeof item === 'string' && item.trim() !== '') {
                const trimmed = item.trim()
                const currentContent = safeString(obj['content']).trim()
                obj['content'] =
                    currentContent !== '' ? `${currentContent}\n\n**${key}:** ${trimmed}` : trimmed
            }
        }
    }

    return modified
}
