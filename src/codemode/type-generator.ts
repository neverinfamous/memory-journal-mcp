import { z } from 'zod'

function formatLiteralValue(val: unknown): string {
    return typeof val === 'string' ? `'${val}'` : String(val)
}

function isSchemaOptional(schema: unknown): boolean {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
        return true
    }
    if (
        schema instanceof z.ZodNullable ||
        schema instanceof z.ZodReadonly ||
        schema instanceof z.ZodCatch
    ) {
        return isSchemaOptional(schema.unwrap())
    }
    if (schema instanceof z.ZodPipe) {
        return isSchemaOptional(schema.out instanceof z.ZodTransform ? schema.in : schema.out)
    }
    return false
}

/**
 * Converts a single Zod schema type into a TypeScript string representation.
 */
export function getZodTypeString(schema: unknown): string {
    if (schema instanceof z.ZodString) return 'string'
    if (schema instanceof z.ZodNumber) return 'number'
    if (schema instanceof z.ZodBoolean) return 'boolean'

    if (schema instanceof z.ZodLiteral) {
        const vals = Array.from(schema.values)
        return vals.length > 0 ? vals.map(formatLiteralValue).join(' | ') : 'unknown'
    }

    if (schema instanceof z.ZodArray) {
        return `${getZodTypeString(schema.element)}[]`
    }

    if (schema instanceof z.ZodRecord) {
        return `Record<${getZodTypeString(schema.def.keyType)}, ${getZodTypeString(schema.def.valueType)}>`
    }

    if (schema instanceof z.ZodTuple) {
        const itemTypes = schema.def.items.map((item: unknown) => getZodTypeString(item))
        if (schema.def.rest !== undefined && schema.def.rest !== null) {
            itemTypes.push(`...${getZodTypeString(schema.def.rest)}[]`)
        }
        return `[${itemTypes.join(', ')}]`
    }

    if (schema instanceof z.ZodIntersection) {
        return `${getZodTypeString(schema.def.left)} & ${getZodTypeString(schema.def.right)}`
    }

    if (schema instanceof z.ZodOptional) {
        return getZodTypeString(schema.unwrap())
    }

    if (schema instanceof z.ZodNullable) {
        return `${getZodTypeString(schema.unwrap())} | null`
    }

    if (schema instanceof z.ZodDefault) {
        return getZodTypeString(schema.unwrap())
    }

    if (schema instanceof z.ZodPipe) {
        if (schema.out instanceof z.ZodTransform) {
            return getZodTypeString(schema.in)
        }
        return getZodTypeString(schema.out)
    }

    if (schema instanceof z.ZodReadonly || schema instanceof z.ZodCatch) {
        return getZodTypeString(schema.unwrap())
    }

    if (schema instanceof z.ZodUnion) {
        return schema.options.map((o: unknown) => getZodTypeString(o)).join(' | ')
    }

    if (schema instanceof z.ZodEnum) {
        return schema.options.map((o: unknown) => `'${String(o)}'`).join(' | ')
    }

    if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, unknown>
        const props = Object.entries(shape).map(([k, v]) => {
            const isOptional = isSchemaOptional(v)
            return `${k}${isOptional ? '?' : ''}: ${getZodTypeString(v)}`
        })
        return `{ ${props.join(', ')} }`
    }

    return 'unknown'
}
