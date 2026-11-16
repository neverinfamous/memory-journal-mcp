/**
 * Zod schema parameter introspection helpers for dynamic help resources.
 */

export interface ParameterInfo {
    name: string
    type: string
    required: boolean
    description?: string
}

/** Friendly display names for Zod primitive type names */
const ZOD_TYPE_DISPLAY: Record<string, string> = {
    ZodString: 'string',
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

function readDefTypeName(def: Record<string, unknown>): string | undefined {
    const raw = def['typeName'] ?? def['type']
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function isTransformNode(rec: Record<string, unknown>): boolean {
    const ownType = readDefTypeName(rec)
    if (ownType === 'transform' || ownType === 'ZodTransform') return true
    const rawDef = rec['_def']
    if (rawDef !== null && rawDef !== undefined && typeof rawDef === 'object') {
        const innerType = readDefTypeName(rawDef as Record<string, unknown>)
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
        if (candidate === null || candidate === undefined || typeof candidate !== 'object') {
            continue
        }
        const rec = candidate as Record<string, unknown>
        if (isTransformNode(rec)) {
            continue
        }
        if (rec['_def'] !== null && rec['_def'] !== undefined && typeof rec['_def'] === 'object') {
            return { schema: rec, def: rec['_def'] as Record<string, unknown> }
        }
        if (readDefTypeName(rec) !== undefined || 'shape' in rec) {
            return { def: rec }
        }
    }
    return null
}

/**
 * Recursively peel ZodOptional / ZodDefault / ZodNullable / ZodPipe wrappers from
 * a Zod `_def` (or schema+def pair) to discover the innermost concrete type,
 * whether the field is optional to callers, and the first outer->inner description.
 */
export function peelZodType(
    def: Record<string, unknown>,
    outerSchema?: Record<string, unknown>
): {
    typeName: string
    isOptional: boolean
    description: string | undefined
} {
    let isOptional = false
    let description: string | undefined
    let currentDef = def
    let currentSchema = outerSchema

    for (let depth = 0; depth < 32; depth++) {
        if (description === undefined && typeof currentSchema?.['description'] === 'string') {
            description = currentSchema['description']
        }
        if (description === undefined && typeof currentDef['description'] === 'string') {
            description = currentDef['description']
        }

        const tn = readDefTypeName(currentDef)
        if (tn === undefined) break

        if (ZOD_OPTIONAL_WRAPPERS.has(tn)) {
            isOptional = true
            const next = unwrapDefChild(currentDef, ['innerType'])
            if (!next?.def) break
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
            if (displayName === 'union' && Array.isArray(currentDef['options'])) {
                const memberTypes = Array.from(
                    new Set(
                        currentDef['options']
                            .filter(
                                (opt): opt is Record<string, unknown> =>
                                    typeof opt === 'object' && opt !== null
                            )
                            .map((opt) => {
                                const optDef =
                                    typeof opt['_def'] === 'object' && opt['_def'] !== null
                                        ? (opt['_def'] as Record<string, unknown>)
                                        : opt
                                return peelZodType(optDef, opt).typeName
                            })
                            .filter((t) => t.length > 0 && t !== 'unknown')
                    )
                )
                if (memberTypes.length > 0) {
                    displayName = memberTypes.join(' | ')
                }
            }
            return { typeName: displayName, isOptional, description }
        }
    }

    return { typeName: 'unknown', isOptional, description }
}

/**
 * Extract parameter info from a Zod schema's shape.
 * Works with z.object() schemas that have a `.shape` property.
 */
export function extractParameters(inputSchema: unknown): ParameterInfo[] {
    if (inputSchema === undefined || inputSchema === null || typeof inputSchema !== 'object') {
        return []
    }

    let schema = inputSchema as Record<string, unknown>

    // Unwrap outer ZodEffects / ZodPipe wrappers iteratively until `.shape` is exposed
    for (let depth = 0; depth < 16 && !('shape' in schema); depth++) {
        if (typeof schema['innerType'] === 'function') {
            const innerTypeFn = schema['innerType'] as () => unknown
            const next = innerTypeFn()
            if (next === null || next === undefined || typeof next !== 'object') break
            schema = next as Record<string, unknown>
            continue
        }
        const rawDef = schema['_def']
        if (rawDef !== undefined && rawDef !== null && typeof rawDef === 'object') {
            const defObj = rawDef as Record<string, unknown>
            const next = unwrapDefChild(defObj, ['schema', 'in', 'out', 'innerType'])
            if (next?.schema !== undefined) {
                schema = next.schema
                continue
            }
        }
        if (
            schema['out'] !== undefined &&
            schema['out'] !== null &&
            typeof schema['out'] === 'object' &&
            'shape' in schema['out']
        ) {
            schema = schema['out']
            continue
        }
        if (
            schema['in'] !== undefined &&
            schema['in'] !== null &&
            typeof schema['in'] === 'object'
        ) {
            schema = schema['in'] as Record<string, unknown>
            continue
        }
        break
    }

    const rawShape: unknown = schema['shape']
    if (rawShape === undefined || rawShape === null || typeof rawShape !== 'object') {
        return []
    }

    const shape = rawShape as Record<string, unknown>
    const params: ParameterInfo[] = []

    for (const [name, fieldSchema] of Object.entries(shape)) {
        if (fieldSchema === undefined || fieldSchema === null || typeof fieldSchema !== 'object') {
            continue
        }
        const field = fieldSchema as Record<string, unknown>
        const rawDef = field['_def'] as Record<string, unknown> | undefined
        if (!rawDef) continue

        const { typeName, isOptional, description } = peelZodType(rawDef, field)

        params.push({
            name,
            type: typeName,
            required: !isOptional,
            ...(description !== undefined ? { description } : {}),
        })
    }

    return params
}
