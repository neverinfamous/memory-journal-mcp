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
import { healAnchorsField, healSortByField } from '../../handlers/tools/schemas/hallucination-healer-fields.js'
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

    postProcessNormalizedKeys(result, methodLower)
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
        if (
            methodLower !== undefined &&
            (methodLower === 'export' ||
                methodLower === 'export_entries' ||
                methodLower === 'exportentries' ||
                methodLower === 'team_export_entries' ||
                methodLower === 'teamexportentries')
        ) {
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

function entryAliasReplacement(value: unknown, methodName: string | undefined): string | undefined {
    if (isRecord(value)) return undefined
    if (typeof value !== 'string') return undefined
    const numeric = /^\d+$/.test(value.trim())
    const contentMethod =
        methodName !== undefined &&
        (hasMethodToken(methodName, 'create') ||
            hasMethodToken(methodName, 'add') ||
            hasMethodToken(methodName, 'insert') ||
            (hasMethodToken(methodName, 'log') && !hasMethodToken(methodName, 'audit')))
    if (!numeric || contentMethod) return 'content'
    return undefined
}

function isExactMethod(methodLower: string | undefined, names: readonly string[]): boolean {
    return methodLower !== undefined && names.includes(methodLower)
}

const EXPORT_MARKDOWN_METHODS = ['export_markdown', 'exportmarkdown', 'team_export_markdown', 'teamexportmarkdown']
const IMPORT_EXTERNAL_METHODS = ['import_external', 'importexternal', 'team_import_external', 'teamimportexternal']
const IMPORT_MARKDOWN_METHODS = ['import_markdown', 'importmarkdown', 'team_import_markdown', 'teamimportmarkdown']

function pathAliasReplacement(methodLower: string | undefined): string | undefined {
    if (isExactMethod(methodLower, EXPORT_MARKDOWN_METHODS)) return 'output_dir'
    if (
        isExactMethod(methodLower, IMPORT_MARKDOWN_METHODS) ||
        isExactMethod(methodLower, IMPORT_EXTERNAL_METHODS)
    ) {
        return 'keep'
    }
    return undefined
}

/** Applies PARAM_ALIASES unless a method/context-specific rule suppresses or redirects the alias. */
function resolveAliasedKey(startKey: string, value: unknown, ctx: KeyContext): string {
    const { obj, result, methodName, methodLower, isGithubTool } = ctx
    const alias = PARAM_ALIASES[startKey]
    if (alias === undefined || alias in obj || alias in result) return startKey

    if (startKey === 'entry') {
        if (isRecord(value)) return startKey
        return entryAliasReplacement(value, methodName) ?? alias
    }
    if (startKey === 'user' && (methodLower === 'search_audit_log' || methodLower === 'searchauditlog')) {
        return startKey
    }
    if ((startKey === 'title' || startKey === 'body') && isGithubTool) return startKey
    if (
        startKey === 'keep' &&
        !(methodName !== undefined && hasMethodToken(methodName, 'cleanup') && hasMethodToken(methodName, 'backups'))
    ) {
        return startKey
    }
    if (startKey === 'source' && isExactMethod(methodLower, IMPORT_EXTERNAL_METHODS)) return 'source_format'
    if (startKey === 'source' && isExactMethod(methodLower, IMPORT_MARKDOWN_METHODS)) return startKey
    if (startKey === 'path') {
        const pathKey = pathAliasReplacement(methodLower)
        if (pathKey === 'keep') return alias
        if (pathKey !== undefined) return pathKey
        return startKey
    }
    const contentKeys = startKey === 'text' || startKey === 'body' || startKey === 'note' || startKey === 'title'
    if (
        contentKeys &&
        methodName !== undefined &&
        !(
            isGithubTool ||
            hasMethodToken(methodName, 'create') ||
            hasMethodToken(methodName, 'update') ||
            hasMethodToken(methodName, 'entry')
        )
    ) {
        return startKey
    }
    return alias
}

/** Redirects content-like keys (message/name/description/...) to the right field per tool family. */
function resolveContentLikeKey(startKey: string, ctx: KeyContext): string {
    const { obj, result, methodName, isGithubTool } = ctx
    let snakeKey = startKey
    if (CONTENT_LIKE_KEYS.has(snakeKey)) {
        if (isGithubTool) {
            if (snakeKey === 'name') {
                if (!('title' in obj) && !('title' in result)) snakeKey = 'title'
            } else if (
                snakeKey === 'description' &&
                methodName !== undefined &&
                (hasMethodToken(methodName, 'milestone') || hasMethodToken(methodName, 'milestones'))
            ) {
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
            (hasMethodToken(methodName, 'entry') || hasMethodToken(methodName, 'entries')) &&
            !hasMethodToken(methodName, 'link')
        ) {
            // [H6] Only entry mutations redirect name/message/... into `content`; project,
            // milestone, member, or config mutations keep their own `name`/`description` keys.
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
    if (
        snakeKey !== 'workspace_id' &&
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

const GIT_COMMIT_METHODS = new Set([
    'get_commit_history', 'getcommithistory', 'search_commits', 'searchcommits',
])

function postProcessNormalizedKeys(result: Record<string, unknown>, methodLower?: string): void {
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
