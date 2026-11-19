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
    if (isRecord(def.shape) && Object.hasOwn(def.shape, key)) return true
    const typeName = def.typeName ?? def.type
    if ((typeName === 'ZodObject' || typeName === 'object') && isRecord(s.shape)) {
        return Object.hasOwn(s.shape, key)
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
    if (typeName === 'ZodLazy' || typeName === 'lazy') {
        const getter = (def as { getter?: () => unknown }).getter
        const next =
            typeof getter === 'function'
                ? getter()
                : typeof s.unwrap === 'function'
                  ? s.unwrap()
                  : undefined
        return next !== undefined ? checkSchemaAcceptsKey(next, key, visited) : false
    }
    if (typeName === 'ZodPipe' || typeName === 'pipe' || typeName === 'ZodPipeline') {
        const inSchema = def.in ?? s.in
        const inDef = isRecord(inSchema)
            ? ((inSchema as ZodLike)._zod?.def ?? (inSchema as ZodLike).def ?? (inSchema as ZodLike)._def)
            : undefined
        const inType = inDef?.typeName ?? inDef?.type
        if (inType !== 'ZodTransform' && inType !== 'transform') {
            if (checkSchemaAcceptsKey(inSchema, key, visited)) return true
        }
        return checkSchemaAcceptsKey(def.out ?? s.out, key, visited)
    }
    if (typeName !== undefined && WRAPPER_DEF_TYPES.has(typeName)) {
        const innerCandidates = [
            def.in,
            s.in,
            def.schema,
            def.innerType,
            def.out,
            s.out,
            typeof s.innerType === 'function' ? s.innerType() : undefined,
            typeof s.unwrap === 'function' ? s.unwrap() : undefined,
        ]
        if (innerCandidates.some((child) => checkSchemaAcceptsKey(child, key, visited))) {
            return true
        }
    }
    return (
        checkSchemaAcceptsKey(def.in, key, visited) ||
        checkSchemaAcceptsKey(def.out, key, visited) ||
        checkSchemaAcceptsKey(def.schema, key, visited)
    )
}

const MAX_CACHED_SCHEMA_KEYS = 512
const SCHEMA_KEY_CACHE = new WeakMap<object, Set<string>>()

function computeSchemaAcceptsKey(
    schema: unknown,
    key: string,
    visited: Set<unknown>
): boolean {
    if (!isRecord(schema) || visited.has(schema)) return false
    visited.add(schema)
    try {
        if (
            Object.hasOwn(schema, 'properties') &&
            isRecord(schema['properties']) &&
            Object.hasOwn(schema['properties'], key)
        ) {
            return true
        }
        for (const comboKey of ['anyOf', 'oneOf', 'allOf'] as const) {
            const branches = schema[comboKey]
            if (Array.isArray(branches) && branches.some((b) => computeSchemaAcceptsKey(b, key, visited))) {
                return true
            }
        }

        const s = schema as ZodLike
        if (isRecord(s.shape) && Object.hasOwn(s.shape, key)) return true

        const def = s._zod?.def ?? s.def ?? s._def
        if (def !== undefined && def !== null && checkDefAcceptsKey(s, def, key, visited)) {
            return true
        }
        if (Array.isArray(s.options) && s.options.some((opt) => computeSchemaAcceptsKey(opt, key, visited))) {
            return true
        }
        return (
            computeSchemaAcceptsKey(s.in, key, visited) ||
            computeSchemaAcceptsKey(s.out, key, visited)
        )
    } finally {
        visited.delete(schema)
    }
}

export function checkSchemaAcceptsKey(
    schema: unknown,
    key: string,
    visited?: Set<unknown>
): boolean {
    if (visited !== undefined) {
        return computeSchemaAcceptsKey(schema, key, visited)
    }
    if (!isRecord(schema)) return false
    let cache = SCHEMA_KEY_CACHE.get(schema)
    if (cache?.has(key) === true) return true
    const accepted = computeSchemaAcceptsKey(schema, key, new Set<unknown>())
    if (accepted) {
        if (cache === undefined) {
            cache = new Set<string>()
            SCHEMA_KEY_CACHE.set(schema, cache)
        }
        if (cache.size < MAX_CACHED_SCHEMA_KEYS) {
            cache.add(key)
        }
    }
    return accepted
}
