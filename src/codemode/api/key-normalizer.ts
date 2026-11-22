/**
 * Key normalization and camelCase-to-snake_case conversion for Code Mode API.
 */

import {
    isRecord,
    PARAM_ALIASES,
} from '../normalizers/shared-utils.js'
import { hasMethodToken, methodTokens } from '../method-tokens.js'
import { coerceNumericValue, postProcessNormalizedKeys } from './key-normalizer-postprocess.js'

const CONTENT_LIKE_KEYS = new Set(['message', 'msg', 'name', 'heading', 'subject', 'description', 'content', 'comment'])
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const GITHUB_METHOD_TOKENS = new Set(['github', 'issue', 'issues', 'pr', 'prs', 'milestone', 'milestones'])

function healArchitectureAndDecisionType(
    rawObj: Record<string, unknown>,
    result: Record<string, unknown>
): void {
    if (!('entry_type' in result)) return
    const rawEntryType =
        rawObj['entry_type'] ?? rawObj['entryType'] ?? rawObj['type'] ?? rawObj['kind']
    const etLower = typeof rawEntryType === 'string' ? rawEntryType.trim().toLowerCase() : ''
    const isMutation =
        'content' in result || 'title' in result || 'content' in rawObj || 'title' in rawObj
    const hasExplicitSig =
        result['significance_type'] !== undefined ||
        rawObj['significance'] !== undefined ||
        rawObj['significanceType'] !== undefined ||
        rawObj['significance_type'] !== undefined
    if (
        etLower === 'architecture' ||
        etLower === 'architecture_decision' ||
        etLower === 'architecture-decision' ||
        etLower === 'architectural_decision' ||
        etLower === 'architectural-decision' ||
        etLower === 'adr'
    ) {
        result['entry_type'] = 'project_decision'
        if (isMutation && !hasExplicitSig) {
            result['significance_type'] = 'architecture'
        }
    } else if (etLower === 'decision' && isMutation && !hasExplicitSig) {
        result['significance_type'] = 'decision'
    }
}

/**
 * Convert camelCase object keys to snake_case and apply context-aware alias mapping.
 */
export function convertKeysToSnakeCase(obj: Record<string, unknown>, methodName?: string): Record<string, unknown> {
    const unwrapNestedRecord = (container: Record<string, unknown>, containerKey: 'entry' | 'filter'): Record<string, unknown> => {
        const nested = container[containerKey]
        if (!isRecord(nested)) return container
        const cloned = { ...container }
        Reflect.deleteProperty(cloned, containerKey)
        for (const [k, v] of Object.entries(nested)) {
            if (FORBIDDEN_KEYS.has(k)) continue
            if ((!Object.hasOwn(cloned, k) || cloned[k] === undefined) && v !== undefined) {
                cloned[k] = v
            }
        }
        return cloned
    }
    if (isRecord(obj['entry'])) obj = unwrapNestedRecord(obj, 'entry')
    if (isRecord(obj['filter'])) obj = unwrapNestedRecord(obj, 'filter')

    const methodLower = methodName?.toLowerCase()
    const isLinkMethod = methodName !== undefined && hasMethodToken(methodName, 'link')
    const isGithubTool =
        methodName !== undefined && methodTokens(methodName).some((token) => GITHUB_METHOD_TOKENS.has(token))

    const ctx: KeyContext = { obj, result: {}, methodName, methodLower, isLinkMethod, isGithubTool }
    const result = ctx.result
    for (const [key, value] of Object.entries(obj)) {
        if (FORBIDDEN_KEYS.has(key)) continue
        let snakeKey = resolveBaseSnakeKey(key, ctx)

        snakeKey = resolveAliasedKey(snakeKey, value, ctx)
        snakeKey = resolveContentLikeKey(snakeKey, ctx)
        if (FORBIDDEN_KEYS.has(snakeKey)) continue

        if (key !== snakeKey && Object.hasOwn(obj, snakeKey) && obj[snakeKey] !== undefined) {
            continue
        }
        if (value === undefined && Object.hasOwn(result, snakeKey) && result[snakeKey] !== undefined) {
            continue
        }

        const coerced = coerceNumericValue(snakeKey, value, methodLower)
        if (coerced !== undefined) {
            result[snakeKey] = coerced.value
            continue
        }

        result[snakeKey] = value
    }

    postProcessNormalizedKeys(result, methodLower)
    healArchitectureAndDecisionType(obj, result)
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

function hasDefinedKey(record: Record<string, unknown>, key: string): boolean {
    return Object.hasOwn(record, key) && record[key] !== undefined
}

const HAS_UPPER_RE = /[A-Z]/
const UPPER_LETTER_RE = /[A-Z]/g
const SNAKE_KEY_CACHE = new Map<string, string>()
const MAX_SNAKE_KEY_CACHE = 512

function toSnakeCaseKey(key: string): string {
    if (!HAS_UPPER_RE.test(key)) return key
    const cached = SNAKE_KEY_CACHE.get(key)
    if (cached !== undefined) return cached
    const converted = key.replace(UPPER_LETTER_RE, (letter) => `_${letter.toLowerCase()}`)
    if (SNAKE_KEY_CACHE.size < MAX_SNAKE_KEY_CACHE) {
        SNAKE_KEY_CACHE.set(key, converted)
    }
    return converted
}

function isExactMethod(methodLower: string | undefined, names: readonly string[]): boolean {
    return methodLower !== undefined && names.includes(methodLower)
}

const EXPORT_MARKDOWN_METHODS = ['export_markdown', 'exportmarkdown', 'team_export_markdown', 'teamexportmarkdown']
const IMPORT_EXTERNAL_METHODS = ['import_external', 'importexternal', 'team_import_external', 'teamimportexternal']
const IMPORT_MARKDOWN_METHODS = ['import_markdown', 'importmarkdown', 'team_import_markdown', 'teamimportmarkdown']

/** camelCase → snake_case plus context-aware renames (id, link params, type, filename, target_user). */
function resolveBaseSnakeKey(key: string, ctx: KeyContext): string {
    const { obj, result, methodLower, isLinkMethod } = ctx
    let snakeKey = toSnakeCaseKey(key)

    if (snakeKey === 'id' && !hasDefinedKey(obj, 'entry_id') && !hasDefinedKey(obj, 'entryId')) {
        snakeKey = 'entry_id'
    } else if (isLinkMethod) {
        if (
            (snakeKey === 'source' || snakeKey === 'source_id' || snakeKey === 'from_id') &&
            !hasDefinedKey(obj, 'from_entry_id') &&
            !hasDefinedKey(result, 'from_entry_id')
        ) {
            snakeKey = 'from_entry_id'
        } else if (
            (snakeKey === 'target' ||
                snakeKey === 'target_id' ||
                snakeKey === 'to_id' ||
                snakeKey === 'dest') &&
            !hasDefinedKey(obj, 'to_entry_id') &&
            !hasDefinedKey(result, 'to_entry_id')
        ) {
            snakeKey = 'to_entry_id'
        } else if (
            (snakeKey === 'type' || snakeKey === 'rel') &&
            !hasDefinedKey(obj, 'relationship_type') &&
            !hasDefinedKey(result, 'relationship_type')
        ) {
            snakeKey = 'relationship_type'
        } else if (
            (snakeKey === 'notes' || snakeKey === 'message' || snakeKey === 'text') &&
            !hasDefinedKey(obj, 'description') &&
            !hasDefinedKey(result, 'description')
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
        } else if (
            !hasDefinedKey(obj, 'entry_type') &&
            !hasDefinedKey(obj, 'flag_type') &&
            !hasDefinedKey(result, 'entry_type') &&
            !hasDefinedKey(result, 'flag_type')
        ) {
            snakeKey = 'entry_type'
        }
    } else if (
        snakeKey === 'filename' &&
        !hasDefinedKey(obj, 'source_dir') &&
        !hasDefinedKey(result, 'source_dir') &&
        (isExactMethod(methodLower, IMPORT_MARKDOWN_METHODS) ||
            isExactMethod(methodLower, IMPORT_EXTERNAL_METHODS))
    ) {
        if (hasDefinedKey(obj, 'project_number') || hasDefinedKey(obj, 'tags') || hasDefinedKey(obj, 'dry_run')) {
            snakeKey = 'source_dir'
        }
    } else if (
        snakeKey === 'target_user' &&
        !hasDefinedKey(obj, 'author') &&
        !hasDefinedKey(result, 'author')
    ) {
        if (hasDefinedKey(obj, 'role') || hasDefinedKey(result, 'role')) snakeKey = 'author'
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
    if (alias === undefined || hasDefinedKey(obj, alias) || hasDefinedKey(result, alias)) return startKey

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
    const isCreateEntry =
        methodName !== undefined &&
        hasMethodToken(methodName, 'create') &&
        (hasMethodToken(methodName, 'entry') || hasMethodToken(methodName, 'entries'))
    const isUpdateEntry =
        methodName !== undefined &&
        hasMethodToken(methodName, 'update') &&
        (hasMethodToken(methodName, 'entry') || hasMethodToken(methodName, 'entries'))
    if (startKey === 'title' && isUpdateEntry) {
        return startKey
    }
    const contentKeys = startKey === 'text' || startKey === 'body' || startKey === 'note' || startKey === 'title'
    if (contentKeys && methodName !== undefined && !(isGithubTool || isCreateEntry || isUpdateEntry)) {
        return startKey
    }
    return alias
}

/** Redirects content-like keys (message/name/description/...) to the right field per tool family. */
function resolveContentLikeKey(startKey: string, ctx: KeyContext): string {
    const { obj, result, methodName, isGithubTool } = ctx
    let snakeKey = startKey
    if (CONTENT_LIKE_KEYS.has(snakeKey)) {
        const isEntryOp =
            methodName !== undefined &&
            (hasMethodToken(methodName, 'entry') || hasMethodToken(methodName, 'entries')) &&
            !hasMethodToken(methodName, 'link')
        const isCreateEntry = isEntryOp && hasMethodToken(methodName, 'create')
        const isUpdateEntry = isEntryOp && hasMethodToken(methodName, 'update')
        if (isGithubTool) {
            if (snakeKey === 'name') {
                if (!hasDefinedKey(obj, 'title') && !hasDefinedKey(result, 'title')) snakeKey = 'title'
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
                if (!hasDefinedKey(obj, 'comment') && !hasDefinedKey(result, 'comment')) snakeKey = 'comment'
            } else if (!hasDefinedKey(obj, 'body') && !hasDefinedKey(result, 'body') && snakeKey !== 'comment') {
                snakeKey = 'body'
            }
        } else if (isUpdateEntry && (snakeKey === 'name' || snakeKey === 'heading' || snakeKey === 'subject')) {
            if (!hasDefinedKey(obj, 'title') && !hasDefinedKey(result, 'title')) snakeKey = 'title'
        } else if (isCreateEntry || isUpdateEntry) {
            // [H6] Only entry mutations redirect message/description/... into `content`; project,
            // milestone, member, or config mutations keep their own `name`/`description` keys.
            if (!hasDefinedKey(obj, 'content') && !hasDefinedKey(result, 'content')) {
                snakeKey = 'content'
            } else if (snakeKey === 'name' || snakeKey === 'heading' || snakeKey === 'subject') {
                snakeKey = 'title'
            }
        }
    }
    return snakeKey
}
