/**
 * Recursive camelCase -> snake_case parameter normalization for Code Mode dispatch,
 * extracted from `dispatch-scope.ts` (Appendix A).
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const CANONICAL_SNAKE_SCOPE_KEYS = new Set([
    'workspaceId',
    'projectNumber',
    'projectId',
    'targetWorkspaceId',
    'repoName',
    'entryId',
    'entryIds',
    'fromEntryId',
    'toEntryId',
])

const UPPERCASE_RE = /[A-Z]/
const OPAQUE_VALUE_KEYS = new Set(['context', 'prompt', 'auto_context', 'autoContext'])

function hasDefinedKey(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.some((key) => Object.hasOwn(obj, key) && obj[key] !== undefined)
}

/**
 * Recursively converts camelCase keys to snake_case.
 * [INVARIANT] `id -> entry_id` / `ids -> entry_ids` aliasing applies only to top-level keys
 * and never when the target schema itself accepts `id`/`ids`, so nested
 * payloads (anchors, relationships, auto_context) keep their own `id` fields intact.
 */
export function deepCamelToSnake(
    obj: unknown,
    depth = 0,
    acceptsKey?: (key: string) => boolean
): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) return obj.map((item) => deepCamelToSnake(item, depth + 1))
    if (!isRecord(obj)) return obj

    const newObj: Record<string, unknown> = {}
    const canAlias = (alias: string): boolean => depth === 0 && !(acceptsKey?.(alias) ?? false)

    for (const [k, v] of Object.entries(obj)) {
        if (FORBIDDEN_KEYS.has(k)) continue
        if (OPAQUE_VALUE_KEYS.has(k)) {
            const opaqueKey = UPPERCASE_RE.test(k)
                ? k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                : k
            const shouldWrite =
                k === opaqueKey
                    ? v !== undefined || !Object.hasOwn(newObj, opaqueKey)
                    : !Object.hasOwn(obj, opaqueKey) || obj[opaqueKey] === undefined
            if (!FORBIDDEN_KEYS.has(opaqueKey) && shouldWrite) {
                newObj[opaqueKey] = v
            }
            continue
        }
        if (depth === 0 && !CANONICAL_SNAKE_SCOPE_KEYS.has(k) && (acceptsKey?.(k) ?? false)) {
            if (v === undefined && Object.hasOwn(newObj, k) && newObj[k] !== undefined) continue
            newObj[k] = deepCamelToSnake(v, depth + 1)
            continue
        }
        const snakeKey = UPPERCASE_RE.test(k)
            ? k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
            : k
        if (FORBIDDEN_KEYS.has(snakeKey)) continue
        if (snakeKey === 'id' && !hasDefinedKey(obj, ['entry_id', 'entryId']) && canAlias('id')) {
            if (v === undefined && Object.hasOwn(newObj, 'entry_id') && newObj['entry_id'] !== undefined) {
                continue
            }
            newObj['entry_id'] = deepCamelToSnake(v, depth + 1)
            continue
        }
        if (snakeKey === 'ids' && !hasDefinedKey(obj, ['entry_ids', 'entryIds']) && canAlias('ids')) {
            if (v === undefined && Object.hasOwn(newObj, 'entry_ids') && newObj['entry_ids'] !== undefined) {
                continue
            }
            const vSnake = deepCamelToSnake(v, depth + 1)
            newObj['entry_ids'] = Array.isArray(vSnake) ? vSnake : [vSnake]
            continue
        }
        if (k !== snakeKey && Object.hasOwn(obj, snakeKey) && obj[snakeKey] !== undefined) {
            continue
        }
        if (v === undefined && Object.hasOwn(newObj, snakeKey) && newObj[snakeKey] !== undefined) {
            continue
        }
        newObj[snakeKey] = deepCamelToSnake(v, depth + 1)
    }
    return newObj
}
