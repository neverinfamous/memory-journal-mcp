import { z } from 'zod'

function formatLiteralValue(val: unknown): string {
    return typeof val === 'string' ? `'${val}'` : String(val)
}

function isSchemaOptional(schema: unknown, seen = new WeakSet()): boolean {
    if (
        schema instanceof z.ZodOptional ||
        schema instanceof z.ZodDefault ||
        schema instanceof z.ZodPrefault
    ) {
        return true
    }
    if (schema instanceof z.ZodNonOptional) {
        return false
    }
    if (schema instanceof z.ZodLazy) {
        if (seen.has(schema)) return false
        seen.add(schema)
        try {
            return isSchemaOptional(schema.unwrap(), seen)
        } finally {
            seen.delete(schema)
        }
    }
    if (
        schema instanceof z.ZodNullable ||
        schema instanceof z.ZodReadonly ||
        schema instanceof z.ZodCatch
    ) {
        return isSchemaOptional(schema.unwrap(), seen)
    }
    if (schema instanceof z.ZodPipe) {
        const inner =
            schema.in instanceof z.ZodTransform ||
            schema.in instanceof z.ZodUnknown ||
            schema.in instanceof z.ZodAny
                ? schema.out
                : schema.in
        return isSchemaOptional(inner, seen)
    }
    return false
}

function resolveScalarZodType(schema: unknown): string | undefined {
    if (schema instanceof z.ZodString || schema instanceof z.ZodStringFormat) return 'string'
    if (schema instanceof z.ZodNumber) return 'number'
    if (schema instanceof z.ZodBoolean) return 'boolean'
    if (schema instanceof z.ZodNull) return 'null'
    if (schema instanceof z.ZodUndefined) return 'undefined'
    if (schema instanceof z.ZodBigInt) return 'bigint'
    if (schema instanceof z.ZodDate) return 'Date'
    if (schema instanceof z.ZodLiteral) {
        const vals = Array.from(schema.values)
        return vals.length > 0 ? vals.map(formatLiteralValue).join(' | ') : 'unknown'
    }
    if (schema instanceof z.ZodEnum) {
        return schema.options.map((o: unknown) => `'${String(o)}'`).join(' | ')
    }
    return undefined
}

/**
 * Converts a single Zod schema type into a TypeScript string representation.
 */
export function getZodTypeString(schema: unknown, seen = new WeakSet()): string {
    const scalar = resolveScalarZodType(schema)
    if (scalar !== undefined) return scalar

    if (schema instanceof z.ZodLazy) {
        if (seen.has(schema)) return 'unknown'
        seen.add(schema)
        try {
            return getZodTypeString(schema.unwrap(), seen)
        } finally {
            seen.delete(schema)
        }
    }

    if (schema instanceof z.ZodArray) {
        return `${getZodTypeString(schema.element, seen)}[]`
    }
    if (schema instanceof z.ZodRecord) {
        return `Record<${getZodTypeString(schema.def.keyType, seen)}, ${getZodTypeString(schema.def.valueType, seen)}>`
    }
    if (schema instanceof z.ZodTuple) {
        const itemTypes = schema.def.items.map((item: unknown) => getZodTypeString(item, seen))
        if (schema.def.rest !== undefined && schema.def.rest !== null) {
            itemTypes.push(`...${getZodTypeString(schema.def.rest, seen)}[]`)
        }
        return `[${itemTypes.join(', ')}]`
    }
    if (schema instanceof z.ZodIntersection) {
        return `${getZodTypeString(schema.def.left, seen)} & ${getZodTypeString(schema.def.right, seen)}`
    }
    if (
        schema instanceof z.ZodOptional ||
        schema instanceof z.ZodNonOptional ||
        schema instanceof z.ZodDefault ||
        schema instanceof z.ZodPrefault ||
        schema instanceof z.ZodReadonly ||
        schema instanceof z.ZodCatch
    ) {
        return getZodTypeString(schema.unwrap(), seen)
    }
    if (schema instanceof z.ZodNullable) {
        return `${getZodTypeString(schema.unwrap(), seen)} | null`
    }
    if (schema instanceof z.ZodPipe) {
        const inner =
            schema.in instanceof z.ZodTransform ||
            schema.in instanceof z.ZodUnknown ||
            schema.in instanceof z.ZodAny
                ? schema.out
                : schema.in
        return getZodTypeString(inner, seen)
    }
    if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
        return schema.options.map((o: unknown) => getZodTypeString(o, seen)).join(' | ')
    }
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, unknown>
        const props = Object.entries(shape).map(([k, v]) => {
            const isOptional = isSchemaOptional(v, new WeakSet())
            return `${k}${isOptional ? '?' : ''}: ${getZodTypeString(v, seen)}`
        })
        return `{ ${props.join(', ')} }`
    }

    return 'unknown'
}
