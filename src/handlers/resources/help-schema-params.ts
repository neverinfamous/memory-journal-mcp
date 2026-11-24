/**
 * Zod schema parameter introspection helpers for dynamic help resources.
 */

import { isRecord } from '../../utils/type-guards.js'

export interface ParameterInfo {
    name: string
    type: string
    required: boolean
    description?: string
}

/** Friendly display names for Zod primitive type names */
const ZOD_TYPE_DISPLAY: Record<string, string> = {
    ZodString: 'string',
    ZodStringFormat: 'string',
    ZodNumber: 'number',
    ZodBoolean: 'boolean',
    ZodArray: 'array',
    ZodObject: 'object',
    ZodEnum: 'enum',
    ZodNativeEnum: 'enum',
    ZodLiteral: 'literal',
    ZodUnion: 'union',
    ZodDiscriminatedUnion: 'union',
    ZodIntersection: 'intersection',
    ZodRecord: 'record',
    ZodTuple: 'tuple',
    ZodAny: 'any',
    ZodUnknown: 'unknown',
    ZodNull: 'null',
    ZodUndefined: 'undefined',
    ZodVoid: 'void',
}

/** Wrapper type names that make a field optional or supply a default */
const ZOD_OPTIONAL_WRAPPERS = new Set([
    'ZodOptional',
    'ZodDefault',
    'ZodPrefault',
    'optional',
    'default',
    'prefault',
])

/** Wrapper type names that transform/validate without altering the underlying type */
const ZOD_TRANSPARENT_WRAPPERS = new Set([
    'ZodNullable',
    'nullable',
    'pipe',
    'ZodPipeline',
    'effects',
    'ZodEffects',
    'readonly',
    'ZodReadonly',
    'catch',
    'ZodCatch',
])

function isThunk(fn: unknown): fn is () => unknown {
    return typeof fn === 'function'
}

function getZodDef(node: Record<string, unknown>): Record<string, unknown> | undefined {
    const direct = node['_def'] ?? node['def']
    if (isRecord(direct)) {
        return direct
    }
    const zodProp = node['_zod']
    if (isRecord(zodProp)) {
        const zDef = zodProp['def']
        if (isRecord(zDef)) {
            return zDef
        }
    }
    return undefined
}

function readDefTypeName(def: Record<string, unknown>): string | undefined {
    const raw = def['typeName'] ?? def['type']
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function isTransformNode(rec: Record<string, unknown>): boolean {
    const ownType = readDefTypeName(rec)
    if (ownType === 'transform' || ownType === 'ZodTransform') return true
    const rawDef = getZodDef(rec)
    if (rawDef !== undefined) {
        const innerType = readDefTypeName(rawDef)
        return innerType === 'transform' || innerType === 'ZodTransform'
    }
    return false
}

function unwrapDefChild(
    def: Record<string, unknown>,
    keys: readonly string[]
): { schema?: Record<string, unknown>; def?: Record<string, unknown> } | null {
    for (const key of keys) {
        const candidate = def[key]
        if (!isRecord(candidate)) {
            continue
        }
        if (isTransformNode(candidate)) {
            continue
        }
        const childDef = getZodDef(candidate)
        if (key === 'in' && 'out' in def && def['out'] !== undefined) {
            const inType = readDefTypeName(childDef ?? candidate)
            if (inType === 'unknown' || inType === 'ZodUnknown' || inType === 'any' || inType === 'ZodAny') {
                continue
            }
        }
        if (childDef !== undefined) {
            return { schema: candidate, def: childDef }
        }
        if (readDefTypeName(candidate) !== undefined || 'shape' in candidate) {
            return { def: candidate }
        }
    }
    return null
}

function resolveUnionDisplayName(
    currentDef: Record<string, unknown>,
    visitedLazy: WeakSet<object>
): string | undefined {
    if (!Array.isArray(currentDef['options'])) return undefined
    const memberTypes = Array.from(
        new Set(
            currentDef['options']
                .filter(
                    (opt): opt is Record<string, unknown> => typeof opt === 'object' && opt !== null
                )
                .map((opt) => {
                    const optDef = getZodDef(opt) ?? opt
                    return peelZodType(optDef, opt, visitedLazy).typeName
                })
                .filter((t) => t.length > 0 && t !== 'unknown')
        )
    )
    return memberTypes.length > 0 ? memberTypes.join(' | ') : undefined
}

function unwrapLazyDef(
    currentDef: Record<string, unknown>
): { schema: Record<string, unknown>; def: Record<string, unknown> } | null {
    const getter = currentDef['getter']
    const lazyNext: unknown = isThunk(getter) ? getter() : undefined
    if (!isRecord(lazyNext)) {
        return null
    }
    const nextDef = getZodDef(lazyNext)
    return nextDef !== undefined ? { schema: lazyNext, def: nextDef } : null
}

/**
 * Recursively peel ZodOptional / ZodDefault / ZodNonOptional / ZodLazy / ZodNullable / ZodPipe
 * wrappers from a Zod `_def` (or schema+def pair) to discover the innermost concrete type,
 * whether the field is optional to callers, and the first outer->inner description.
 */
export function peelZodType(
    def: Record<string, unknown>,
    outerSchema?: Record<string, unknown>,
    visitedLazy = new WeakSet()
): {
    typeName: string
    isOptional: boolean
    description: string | undefined
} {
    let optionalDecided: boolean | undefined
    let description: string | undefined
    let currentDef = def
    let currentSchema = outerSchema
    const addedLazyKeys: object[] = []

    try {
        for (let depth = 0; depth < 32; depth++) {
            if (description === undefined && typeof currentSchema?.['description'] === 'string') {
                description = currentSchema['description']
            }
            if (description === undefined && typeof currentDef['description'] === 'string') {
                description = currentDef['description']
            }

            const tn = readDefTypeName(currentDef)
            if (tn === undefined) break

            if (tn === 'nonoptional' || tn === 'ZodNonOptional') {
                optionalDecided ??= false
                const next = unwrapDefChild(currentDef, ['innerType'])
                if (!next?.def) break
                currentSchema = next.schema
                currentDef = next.def
            } else if (ZOD_OPTIONAL_WRAPPERS.has(tn)) {
                optionalDecided ??= true
                const next = unwrapDefChild(currentDef, ['innerType'])
                if (!next?.def) break
                currentSchema = next.schema
                currentDef = next.def
            } else if (tn === 'lazy' || tn === 'ZodLazy') {
                const lazyKey: object = currentSchema ?? currentDef
                if (visitedLazy.has(lazyKey)) break
                const next = unwrapLazyDef(currentDef)
                if (next === null) break
                visitedLazy.add(lazyKey)
                addedLazyKeys.push(lazyKey)
                currentSchema = next.schema
                currentDef = next.def
            } else if (ZOD_TRANSPARENT_WRAPPERS.has(tn)) {
                const next = unwrapDefChild(currentDef, ['in', 'out', 'schema', 'innerType'])
                if (!next?.def) break
                currentSchema = next.schema
                currentDef = next.def
            } else {
                const normalized = tn.replace('Zod', '').toLowerCase()
                let displayName = ZOD_TYPE_DISPLAY[tn] ?? normalized
                if (displayName === 'union') {
                    displayName = resolveUnionDisplayName(currentDef, visitedLazy) ?? displayName
                }
                return { typeName: displayName, isOptional: optionalDecided ?? false, description }
            }
        }
    } finally {
        for (const lazyKey of addedLazyKeys) {
            visitedLazy.delete(lazyKey)
        }
    }

    return { typeName: 'unknown', isOptional: optionalDecided ?? false, description }
}

function unwrapSchemaTarget(
    inputObj: Record<string, unknown>
):
    | { kind: 'intersection'; def: Record<string, unknown> }
    | { kind: 'object'; schema: Record<string, unknown> } {
    let schema = inputObj
    for (let loopDepth = 0; loopDepth < 16 && !('shape' in schema); loopDepth++) {
        const innerType = schema['innerType']
        if (isThunk(innerType)) {
            const next: unknown = innerType()
            if (!isRecord(next)) break
            schema = next
            continue
        }
        const defObj = getZodDef(schema)
        if (defObj !== undefined) {
            const defType = readDefTypeName(defObj)
            if (defType === 'ZodIntersection' || defType === 'intersection') {
                return { kind: 'intersection', def: defObj }
            }
            if (defType === 'ZodLazy' || defType === 'lazy') {
                const lazyTarget = unwrapLazyDef(defObj)
                if (lazyTarget !== null) {
                    schema = lazyTarget.schema
                    continue
                }
            }
            const next = unwrapDefChild(defObj, ['schema', 'in', 'out', 'innerType'])
            if (next?.schema !== undefined) {
                schema = next.schema
                continue
            }
        }
        const outProp = schema['out']
        if (isRecord(outProp) && 'shape' in outProp) {
            schema = outProp
            continue
        }
        const inProp = schema['in']
        if (isRecord(inProp)) {
            schema = inProp
            continue
        }
        break
    }
    return { kind: 'object', schema }
}

function extractIntersectionParameters(
    defObj: Record<string, unknown>,
    depth: number
): ParameterInfo[] {
    const merged: ParameterInfo[] = []
    const seen = new Set<string>()
    for (const side of [defObj['left'], defObj['right']]) {
        for (const param of extractParametersImpl(side, depth + 1)) {
            if (!seen.has(param.name)) {
                seen.add(param.name)
                merged.push(param)
            }
        }
    }
    return merged
}

function extractShapeParameters(shape: Record<string, unknown>): ParameterInfo[] {
    const params: ParameterInfo[] = []
    for (const [name, fieldSchema] of Object.entries(shape)) {
        if (!isRecord(fieldSchema)) {
            continue
        }
        const rawDef = getZodDef(fieldSchema)
        if (!rawDef) continue
        const { typeName, isOptional, description } = peelZodType(rawDef, fieldSchema)
        params.push({
            name,
            type: typeName,
            required: !isOptional,
            ...(description !== undefined ? { description } : {}),
        })
    }
    return params
}

function extractParametersImpl(inputSchema: unknown, depth: number): ParameterInfo[] {
    if (depth >= 16 || !isRecord(inputSchema)) {
        return []
    }
    const target = unwrapSchemaTarget(inputSchema)
    if (target.kind === 'intersection') {
        return extractIntersectionParameters(target.def, depth)
    }
    const rawShape: unknown = target.schema['shape']
    if (!isRecord(rawShape)) {
        return []
    }
    return extractShapeParameters(rawShape)
}

const EXTRACTED_PARAMETERS_CACHE = new WeakMap<object, ParameterInfo[]>()

/**
 * Extract parameter info from a Zod schema's shape (including ZodIntersection and ZodLazy).
 */
export function extractParameters(inputSchema: unknown): ParameterInfo[] {
    if (typeof inputSchema === 'object' && inputSchema !== null) {
        const cached = EXTRACTED_PARAMETERS_CACHE.get(inputSchema)
        if (cached !== undefined) return cached
        const computed = extractParametersImpl(inputSchema, 0)
        EXTRACTED_PARAMETERS_CACHE.set(inputSchema, computed)
        return computed
    }
    return extractParametersImpl(inputSchema, 0)
}
