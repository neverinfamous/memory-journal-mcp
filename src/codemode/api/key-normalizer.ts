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
import { hasMethodToken, methodTokens } from '../method-tokens.js'

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
    const isLinkMethod = methodName !== undefined && hasMethodToken(methodName, 'link')
    const githubTokens = new Set(['github', 'issue', 'issues', 'pr', 'prs', 'milestone', 'milestones'])
    const isGithubTool =
        methodName !== undefined && methodTokens(methodName).some((token) => githubTokens.has(token))

    const ctx: KeyContext = { obj, result: {}, methodName, methodLower, isLinkMethod, isGithubTool }
    const result = ctx.result
    for (const [key, value] of Object.entries(obj)) {
        let snakeKey = resolveBaseSnakeKey(key, ctx)

        snakeKey = resolveAliasedKey(snakeKey, value, ctx)
        snakeKey = resolveContentLikeKey(snakeKey, ctx)

        const coerced = coerceNumericValue(snakeKey, value)
        if (coerced !== undefined) {
            result[snakeKey] = coerced.value
            continue
        }

        result[snakeKey] = value
    }

    postProcessNormalizedKeys(result)
    return result
}

interface KeyContext {
    obj: Record<string, unknown>
    result: Record<string, unknown>
    methodName: string | undefined
    methodLower: string | undefined
    isLinkMethod: boolean
    isGithubTool: boolean
}

/** camelCase → snake_case plus context-aware renames (id, link params, type, filename, target_user). */
function resolveBaseSnakeKey(key: string, ctx: KeyContext): string {
    const { obj, result, methodLower, isLinkMethod } = ctx
    let snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

    if (snakeKey === 'id' && !('entry_id' in obj) && !('entryId' in obj)) {
        snakeKey = 'entry_id'
    } else if (isLinkMethod) {
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
    return snakeKey
}

/** Applies PARAM_ALIASES unless a method/context-specific rule suppresses or redirects the alias. */
function resolveAliasedKey(startKey: string, value: unknown, ctx: KeyContext): string {
    const { obj, result, methodName, methodLower, isGithubTool } = ctx
    let snakeKey = startKey
    {
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
        } else if (
            useAlias &&
            snakeKey === 'keep' &&
            !(methodName !== undefined && hasMethodToken(methodName, 'cleanup') && hasMethodToken(methodName, 'backups'))
        ) {
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
                !(
                    isGithubTool ||
                    hasMethodToken(methodLower, 'create') ||
                    hasMethodToken(methodLower, 'update') ||
                    hasMethodToken(methodLower, 'entry')
                )
            ) {
                useAlias = false
            }
        }

        if (useAlias && typeof alias === 'string') snakeKey = alias
    }
    return snakeKey
}

/** Redirects content-like keys (message/name/description/...) to the right field per tool family. */
function resolveContentLikeKey(startKey: string, ctx: KeyContext): string {
    const { obj, result, methodName, methodLower, isGithubTool } = ctx
    let snakeKey = startKey
    if (CONTENT_LIKE_KEYS.has(snakeKey)) {
        if (isGithubTool) {
            if (snakeKey === 'name') {
                if (!('title' in obj) && !('title' in result)) snakeKey = 'title'
            } else if (snakeKey === 'description' && methodLower?.includes('milestone')) {
                snakeKey = 'description'
            } else if (
                methodName !== undefined &&
                hasMethodToken(methodName, 'close') &&
                (snakeKey === 'message' || snakeKey === 'msg' || snakeKey === 'content')
            ) {
                if (!('comment' in obj) && !('comment' in result)) snakeKey = 'comment'
            } else if (!('body' in obj) && !('body' in result) && snakeKey !== 'comment') {
                snakeKey = 'body'
            }
        } else if (
            methodName !== undefined &&
            (hasMethodToken(methodName, 'create') || hasMethodToken(methodName, 'update')) &&
            !hasMethodToken(methodName, 'link')
        ) {
            if (!('content' in obj) && !('content' in result)) {
                snakeKey = 'content'
            } else if (snakeKey === 'name' || snakeKey === 'heading' || snakeKey === 'subject') {
                snakeKey = 'title'
            }
        }
    }
    return snakeKey
}

/** Coerces numeric-looking id strings and entry-type aliases; undefined means "no coercion applied". */
function coerceNumericValue(snakeKey: string, value: unknown): { value: unknown } | undefined {
    if ((snakeKey.endsWith('_id') || snakeKey === 'id' || snakeKey === 'project_number') && typeof value === 'string') {
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
    if (typeof result['project_number'] !== 'number') return
    const pn = result['project_number']
    for (const key of ['entries', 'updates', 'entry_ids']) {
        const list = result[key]
        if (!Array.isArray(list)) continue
        for (const item of list) {
            if (isRecord(item) && item['project_number'] === undefined) item['project_number'] = pn
        }
    }
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
