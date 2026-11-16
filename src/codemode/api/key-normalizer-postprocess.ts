/**
 * Post-processing helpers extracted from `key-normalizer.ts`.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import {
    isRecord,
    TAG_ALIASES,
    ENTRY_TYPE_ALIASES,
    healSessionSummaryContent,
    healAutoContext,
} from '../normalizers/shared-utils.js'
import { healAnchorsField, healSortByField } from '../../handlers/tools/schemas/hallucination-healer-fields.js'
import {
    RELATIONSHIP_TARGET_KEYS,
    RELATIONSHIP_TYPE_KEYS,
    pickRecordField,
} from '../../handlers/tools/schemas/constants-and-primitives.js'

const STRING_ID_KEYS = new Set([
    'workspace_id',
    'target_workspace_id',
    'session_id',
    'item_id',
    'node_id',
    'client_id',
])

const GIT_COMMIT_METHODS = new Set([
    'get_commit_history',
    'getcommithistory',
    'search_commits',
    'searchcommits',
])

/** Coerce numeric string IDs/project numbers and normalize entry_type aliases. */
export function coerceNumericValue(
    snakeKey: string,
    value: unknown
): { value: unknown } | undefined {
    if (
        !STRING_ID_KEYS.has(snakeKey) &&
        (snakeKey.endsWith('_id') || snakeKey === 'id' || snakeKey === 'project_number') &&
        typeof value === 'string'
    ) {
        const num = Number(value)
        if (!Number.isNaN(num) && value.trim() !== '') {
            return { value: num }
        }
    }
    if ((snakeKey.endsWith('_ids') || snakeKey === 'ids') && Array.isArray(value)) {
        return {
            value: value.map((v: unknown) => {
                if (typeof v === 'string') {
                    const num = Number(v)
                    if (!Number.isNaN(num) && v.trim() !== '') return num
                }
                return v
            }),
        }
    }
    if (snakeKey === 'entry_type' && typeof value === 'string') {
        const mapped = ENTRY_TYPE_ALIASES[value.toLowerCase()]
        if (mapped !== undefined) {
            return { value: mapped }
        }
    }
    return undefined
}

function propagateBatchProjectNumber(result: Record<string, unknown>): void {
    const pn = typeof result['project_number'] === 'number' ? result['project_number'] : undefined
    const ws = typeof result['workspace_id'] === 'string' ? result['workspace_id'].trim() : undefined
    if (pn === undefined && ws === undefined) return
    for (const key of ['entries', 'updates', 'entry_ids']) {
        const list = result[key]
        if (!Array.isArray(list)) continue
        for (const item of list) {
            if (!isRecord(item)) continue
            const rawItemWs = item['workspace_id'] ?? item['workspaceId'] ?? item['workspace']
            const rawItemTargetWs = item['target_workspace_id'] ?? item['targetWorkspaceId']
            const itemWs = typeof rawItemWs === 'string' ? rawItemWs.trim() : undefined
            const itemTargetWs =
                typeof rawItemTargetWs === 'string' ? rawItemTargetWs.trim() : undefined
            const itemPn =
                item['project_number'] ??
                item['projectNumber'] ??
                item['project'] ??
                item['project_name'] ??
                item['projectName']
            // [C5] Never pair the batch root project_number with an item naming another workspace.
            const namesOtherWs =
                (itemWs !== undefined &&
                    itemWs !== '' &&
                    (ws === undefined || ws === '' || itemWs.toLowerCase() !== ws.toLowerCase())) ||
                (itemTargetWs !== undefined &&
                    itemTargetWs !== '' &&
                    (ws === undefined ||
                        ws === '' ||
                        itemTargetWs.toLowerCase() !== ws.toLowerCase()))
            if (pn !== undefined && itemPn === undefined && !namesOtherWs) {
                item['project_number'] = pn
            }
            if (
                ws !== undefined &&
                ws !== '' &&
                item['workspace_id'] === undefined &&
                item['workspaceId'] === undefined &&
                item['workspace'] === undefined
            ) {
                item['workspace_id'] = ws
            }
        }
    }
}

function normalizeRelationshipItemRecord(rel: unknown): unknown {
    if (!isRecord(rel)) return rel
    const healedRel: Record<string, unknown> = { ...rel }
    const rawTarget = pickRecordField(rel, RELATIONSHIP_TARGET_KEYS)
    if (rawTarget !== undefined && healedRel['targetId'] === undefined) {
        healedRel['targetId'] =
            typeof rawTarget === 'string' && /^\d+$/.test(rawTarget.trim())
                ? Number(rawTarget.trim())
                : rawTarget
    } else if (typeof healedRel['targetId'] === 'string' && /^\d+$/.test(healedRel['targetId'].trim())) {
        healedRel['targetId'] = Number(healedRel['targetId'].trim())
    }
    for (const k of RELATIONSHIP_TARGET_KEYS) {
        if (k !== 'targetId' && k in healedRel) Reflect.deleteProperty(healedRel, k)
    }
    const rawType = pickRecordField(rel, RELATIONSHIP_TYPE_KEYS)
    if (rawType !== undefined && healedRel['relationType'] === undefined) {
        healedRel['relationType'] = rawType
    }
    for (const k of RELATIONSHIP_TYPE_KEYS) {
        if (k !== 'relationType' && k in healedRel) Reflect.deleteProperty(healedRel, k)
    }
    return healedRel
}

/** Apply post-conversion normalization for anchors, tags, relationships, commits, and filters. */
export function postProcessNormalizedKeys(result: Record<string, unknown>, methodLower?: string): void {
    healAnchorsField(result)
    if (methodLower === undefined || !GIT_COMMIT_METHODS.has(methodLower)) {
        healSortByField(result)
    }
    if ('tag' in result && !('tags' in result)) {
        const tagVal = result['tag']
        result['tags'] = Array.isArray(tagVal) ? tagVal : [tagVal]
        delete result['tag']
    }

    if ('tags' in result && Array.isArray(result['tags'])) {
        result['tags'] = result['tags'].map((tag: unknown) =>
            typeof tag === 'string' ? (TAG_ALIASES[tag.trim().toLowerCase()] ?? tag) : tag
        )
    }
    if ('exclude_tags' in result && Array.isArray(result['exclude_tags'])) {
        result['exclude_tags'] = result['exclude_tags'].map((tag: unknown) =>
            typeof tag === 'string' ? (TAG_ALIASES[tag.trim().toLowerCase()] ?? tag) : tag
        )
    }

    if ('relationships' in result && Array.isArray(result['relationships'])) {
        result['relationships'] = result['relationships'].map(normalizeRelationshipItemRecord)
    }

    if ('commits' in result && Array.isArray(result['commits'])) {
        if (!('auto_context' in result) || typeof result['auto_context'] !== 'string') {
            result['auto_context'] = JSON.stringify({ commits: result['commits'] })
        }
        delete result['commits']
    }

    propagateBatchProjectNumber(result)

    if ('content' in result && typeof result['content'] === 'string') {
        const c = result['content']
        if (/#+\s+Accomplished/i.test(c) && /#+\s+Unfinished \/ Blocked/i.test(c)) {
            if (!('entry_type' in result)) result['entry_type'] = 'retrospective'
            let tags = result['tags']
            if (!Array.isArray(tags)) {
                tags = tags !== undefined && tags !== null ? [tags] : []
                result['tags'] = tags
            }
            if (Array.isArray(tags) && !tags.includes('session-summary')) tags.push('session-summary')
        }
    }

    if (
        'tags' in result &&
        Array.isArray(result['tags']) &&
        result['tags'].includes('session-summary') &&
        'content' in result &&
        typeof result['content'] === 'string'
    ) {
        result['content'] = healSessionSummaryContent(result['content'], {
            normalizeSynonyms: false,
            usePeriodOnNone: true,
        })
    }

    if (
        'tags' in result &&
        Array.isArray(result['tags']) &&
        result['tags'].includes('commit-narrative') &&
        !('auto_context' in result) &&
        'content' in result &&
        typeof result['content'] === 'string'
    ) {
        const match = /commit\s+([a-f0-9]{7,40})/i.exec(result['content'])
        if (match?.[1] !== undefined) result['auto_context'] = JSON.stringify({ commits: [match[1]] })
    }

    healAutoContext(result)

    if ('filter' in result && isRecord(result['filter'])) {
        const filterObj = result['filter']
        for (const [k, v] of Object.entries(filterObj)) {
            let snakeK = k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
            if (snakeK === 'id' && !('entry_id' in filterObj) && !('entryId' in filterObj)) {
                snakeK = 'entry_id'
            }
            if (snakeK === 'project' || snakeK === 'project_id' || snakeK === 'proj') {
                snakeK = 'project_number'
            }
            if (!(snakeK in result)) result[snakeK] = v
        }
        delete result['filter']
    }
}
