/**
 * Zod/JSON Schema field introspection helpers for Code Mode pre-dispatch parameter normalization.
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'

interface ZodDefLike {
    typeName?: string
    type?: string
    schema?: unknown
    innerType?: unknown
    in?: unknown
    out?: unknown
    left?: unknown
    right?: unknown
    shape?: unknown
    options?: unknown[]
}

interface ZodLike {
    shape?: Record<string, unknown>
    _def?: ZodDefLike
    def?: ZodDefLike
    _zod?: { def?: ZodDefLike }
    in?: unknown
    out?: unknown
    options?: unknown[]
    innerType?: () => unknown
    unwrap?: () => unknown
}

const WRAPPER_DEF_TYPES = new Set([
    'ZodEffects',
    'ZodPipe',
    'pipe',
    'ZodPipeline',
    'ZodOptional',
    'optional',
    'ZodNonOptional',
    'nonoptional',
    'ZodNullable',
    'nullable',
    'ZodDefault',
    'default',
    'ZodPrefault',
    'prefault',
    'ZodCatch',
    'catch',
    'ZodReadonly',
    'readonly',
    'transform',
])

function checkDefAcceptsKey(
    s: ZodLike,
    def: ZodDefLike,
    key: string,
    visited: Set<unknown>
): boolean {
    if (isRecord(def.shape) && key in def.shape) return true
    const typeName = def.typeName ?? def.type
    if ((typeName === 'ZodObject' || typeName === 'object') && isRecord(s.shape)) {
        return key in s.shape
    }
    if (typeName === 'ZodIntersection' || typeName === 'intersection') {
        return (
            checkSchemaAcceptsKey(def.left, key, visited) ||
            checkSchemaAcceptsKey(def.right, key, visited)
        )
    }
    if (
        typeName === 'ZodUnion' ||
        typeName === 'ZodDiscriminatedUnion' ||
        typeName === 'union'
    ) {
        const opts = Array.isArray(def.options) ? def.options : Array.isArray(s.options) ? s.options : []
        return opts.some((opt) => checkSchemaAcceptsKey(opt, key, visited))
    }
    if (typeName !== undefined && WRAPPER_DEF_TYPES.has(typeName)) {
        const innerCandidates = [
            def.schema,
            def.innerType,
            def.out,
            def.in,
            s.out,
            s.in,
            typeof s.innerType === 'function' ? s.innerType() : undefined,
            typeof s.unwrap === 'function' ? s.unwrap() : undefined,
        ]
        if (innerCandidates.some((child) => checkSchemaAcceptsKey(child, key, visited))) {
            return true
        }
    }
    return (
        checkSchemaAcceptsKey(def.out, key, visited) ||
        checkSchemaAcceptsKey(def.in, key, visited) ||
        checkSchemaAcceptsKey(def.schema, key, visited)
    )
}

export function checkSchemaAcceptsKey(
    schema: unknown,
    key: string,
    visited = new Set<unknown>()
): boolean {
    if (!isRecord(schema) || visited.has(schema)) return false
    visited.add(schema)
    if ('properties' in schema && isRecord(schema['properties']) && key in schema['properties']) {
        return true
    }
    for (const comboKey of ['anyOf', 'oneOf', 'allOf'] as const) {
        const branches = schema[comboKey]
        if (Array.isArray(branches) && branches.some((b) => checkSchemaAcceptsKey(b, key, visited))) {
            return true
        }
    }

    const s = schema as ZodLike
    if (isRecord(s.shape) && key in s.shape) return true

    const def = s._zod?.def ?? s.def ?? s._def
    if (def !== undefined && def !== null && checkDefAcceptsKey(s, def, key, visited)) {
        return true
    }
    if (Array.isArray(s.options) && s.options.some((opt) => checkSchemaAcceptsKey(opt, key, visited))) {
        return true
    }
    return checkSchemaAcceptsKey(s.out, key, visited) || checkSchemaAcceptsKey(s.in, key, visited)
}
