/**
 * Key normalization and camelCase-to-snake_case conversion for Code Mode API.
 */

import {
    isRecord,
    PARAM_ALIASES,
    ENTRY_TYPE_ALIASES,
    TAG_ALIASES,
    healSessionSummaryContent,
    healAutoContext,
} from '../normalizers/shared-utils.js'

const VALID_SIGNIFICANCE_TYPES = new Set([
    'milestone', 'breakthrough', 'decision', 'architecture',
    'lesson_learned', 'blocker_resolved', 'release', 'security',
])

const CONTENT_LIKE_KEYS = new Set(['message', 'msg', 'name', 'heading', 'subject', 'description', 'content', 'comment'])

/**
 * Convert camelCase object keys to snake_case and apply context-aware alias mapping.
 */
export function convertKeysToSnakeCase(obj: Record<string, unknown>, methodName?: string): Record<string, unknown> {
    if ('entry' in obj && isRecord(obj['entry'])) {
        const nested = obj['entry']
        const cloned = { ...obj }
        delete cloned['entry']
        for (const [k, v] of Object.entries(nested)) {
            if (!(k in cloned) && v !== undefined) cloned[k] = v
        }
        obj = cloned
    }

    const methodLower = methodName?.toLowerCase()
    const isGithubTool =
        methodLower !== undefined &&
        (methodLower.includes('github') ||
            methodLower.includes('issue') ||
            methodLower.includes('pr') ||
            methodLower.includes('milestone'))

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        let snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

        if (snakeKey === 'id' && !('entry_id' in obj) && !('entryId' in obj)) {
            snakeKey = 'entry_id'
        } else if (methodLower?.includes('link')) {
            if (
                (snakeKey === 'source' || snakeKey === 'source_id' || snakeKey === 'from_id') &&
                !('from_entry_id' in obj) &&
                !('from_entry_id' in result)
            ) {
                snakeKey = 'from_entry_id'
            } else if (
                (snakeKey === 'target' ||
                    snakeKey === 'target_id' ||
                    snakeKey === 'to_id' ||
                    snakeKey === 'dest') &&
                !('to_entry_id' in obj) &&
                !('to_entry_id' in result)
            ) {
                snakeKey = 'to_entry_id'
            } else if (
                (snakeKey === 'type' || snakeKey === 'rel') &&
                !('relationship_type' in obj) &&
                !('relationship_type' in result)
            ) {
                snakeKey = 'relationship_type'
            } else if (
                (snakeKey === 'notes' || snakeKey === 'message' || snakeKey === 'text') &&
                !('description' in obj) &&
                !('description' in result)
            ) {
                snakeKey = 'description'
            }
        } else if (snakeKey === 'type') {
            if (methodLower?.includes('export')) {
                snakeKey = 'format'
            } else if (!('entry_type' in obj) && !('flag_type' in obj) && !('entry_type' in result) && !('flag_type' in result)) {
                snakeKey = 'entry_type'
            }
        } else if (snakeKey === 'filename' && !('source_dir' in obj) && !('source_dir' in result)) {
            if ('project_number' in obj || 'tags' in obj || 'dry_run' in obj) snakeKey = 'source_dir'
        } else if (snakeKey === 'target_user' && !('author' in obj) && !('author' in result)) {
            if ('role' in obj || 'role' in result) snakeKey = 'author'
        }

        const alias = PARAM_ALIASES[snakeKey]
        let useAlias = alias !== undefined && !(alias in obj) && !(alias in result)

        if (useAlias && snakeKey === 'entry') {
            if (isRecord(value)) {
                useAlias = false
            } else if (typeof value === 'string' && (!/^\d+$/.test(value.trim()) || (methodName !== undefined && /create|add|log|insert/i.test(methodName)))) {
                useAlias = false
                snakeKey = 'content'
            }
        } else if (useAlias && (snakeKey === 'title' || snakeKey === 'body') && isGithubTool) {
            useAlias = false
        } else if (useAlias && snakeKey === 'keep' && methodLower !== undefined && !methodLower.includes('backup')) {
            useAlias = false
        } else if (useAlias && snakeKey === 'mode' && methodLower !== undefined && !methodLower.includes('config')) {
            useAlias = false
        } else if (useAlias && snakeKey === 'source' && methodLower?.includes('import')) {
            useAlias = false
            snakeKey = 'source_format'
        } else if (useAlias && snakeKey === 'path') {
            if (methodLower?.includes('export')) {
                useAlias = false
                snakeKey = 'output_dir'
            } else if (!methodLower?.includes('import')) {
                useAlias = false
            }
        } else if (useAlias && (snakeKey === 'text' || snakeKey === 'body' || snakeKey === 'note' || snakeKey === 'title')) {
            if (
                methodLower !== undefined &&
                !(isGithubTool || methodLower.includes('create') || methodLower.includes('update') || methodLower.includes('entry'))
            ) {
                useAlias = false
            }
        }

        if (useAlias && typeof alias === 'string') snakeKey = alias

        if (CONTENT_LIKE_KEYS.has(snakeKey)) {
            if (isGithubTool) {
                if (snakeKey === 'name') {
                    if (!('title' in obj) && !('title' in result)) snakeKey = 'title'
                } else if (snakeKey === 'description' && methodLower?.includes('milestone')) {
                    snakeKey = 'description'
                } else if (methodLower?.includes('close') && (snakeKey === 'message' || snakeKey === 'msg' || snakeKey === 'content')) {
                    if (!('comment' in obj) && !('comment' in result)) snakeKey = 'comment'
                } else if (!('body' in obj) && !('body' in result) && snakeKey !== 'comment') {
                    snakeKey = 'body'
                }
            } else if (
                methodName !== undefined &&
                (methodName.includes('create') || methodName.includes('update') || methodName.includes('Entry')) &&
                !methodLower?.includes('link')
            ) {
                if (!('content' in obj) && !('content' in result)) {
                    snakeKey = 'content'
                } else if (snakeKey === 'name' || snakeKey === 'heading' || snakeKey === 'subject') {
                    snakeKey = 'title'
                }
            }
        }

        if (snakeKey === 'role' && typeof value === 'string' && value.toLowerCase() === 'contributor') {
            result[snakeKey] = 'member'
            continue
        }
        if (snakeKey === 'significance_type' && typeof value === 'string' && !VALID_SIGNIFICANCE_TYPES.has(value.toLowerCase())) {
            continue
        }
        if ((snakeKey.endsWith('_id') || snakeKey === 'id' || snakeKey === 'project_number') && typeof value === 'string') {
            const num = Number(value)
            if (!Number.isNaN(num) && value.trim() !== '') {
                result[snakeKey] = num
                continue
            }
        }
        if ((snakeKey.endsWith('_ids') || snakeKey === 'ids') && Array.isArray(value)) {
            result[snakeKey] = value.map((v: unknown) => {
                if (typeof v === 'string') {
                    const num = Number(v)
                    if (!Number.isNaN(num) && v.trim() !== '') return num
                }
                return v
            })
            continue
        }
        if (snakeKey === 'entry_type' && typeof value === 'string') {
            const mapped = ENTRY_TYPE_ALIASES[value.toLowerCase()]
            if (mapped !== undefined) {
                result[snakeKey] = mapped
                continue
            }
        }

        result[snakeKey] = value
    }

    postProcessNormalizedKeys(result)
    return result
}

function postProcessNormalizedKeys(result: Record<string, unknown>): void {
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

    if ('relationships' in result && Array.isArray(result['relationships'])) {
        result['relationships'] = result['relationships'].map((rel: unknown) => {
            if (!isRecord(rel)) return rel
            const healedRel: Record<string, unknown> = { ...rel }
            if ('target_id' in rel) {
                healedRel['targetId'] = rel['target_id']
                delete healedRel['target_id']
            }
            if ('relation_type' in rel) {
                healedRel['relationType'] = rel['relation_type']
                delete healedRel['relation_type']
            }
            return healedRel
        })
    }

    if ('commits' in result && Array.isArray(result['commits'])) {
        if (!('auto_context' in result) || typeof result['auto_context'] !== 'string') {
            result['auto_context'] = JSON.stringify({ commits: result['commits'] })
        }
        delete result['commits']
    }

    if (typeof result['project_number'] === 'number') {
        const pn = result['project_number']
        for (const key of ['entries', 'updates', 'entry_ids']) {
            if (Array.isArray(result[key])) {
                for (const item of result[key]) {
                    if (isRecord(item) && item['project_number'] === undefined) item['project_number'] = pn
                }
            }
        }
    }

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
        result['content'] = healSessionSummaryContent(result['content'], { normalizeSynonyms: false, usePeriodOnNone: true })
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
            if (snakeK === 'id' && !('entry_id' in filterObj) && !('entryId' in filterObj)) snakeK = 'entry_id'
            if (snakeK === 'project' || snakeK === 'project_id' || snakeK === 'proj') snakeK = 'project_number'
            if (!(snakeK in result)) result[snakeK] = v
        }
        delete result['filter']
    }
}
