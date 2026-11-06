import { z } from 'zod'

/**
 * Converts a single Zod schema type into a TypeScript string representation.
 */
export function getZodTypeString(schema: unknown): string {
    if (schema instanceof z.ZodString) return 'string'
    if (schema instanceof z.ZodNumber) return 'number'
    if (schema instanceof z.ZodBoolean) return 'boolean'

    if (schema instanceof z.ZodArray) {
        return `${getZodTypeString(schema.element)}[]`
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
            const isOptional =
                v instanceof z.ZodOptional ||
                v instanceof z.ZodDefault ||
                v instanceof z.ZodNullable
            return `${k}${isOptional ? '?' : ''}: ${getZodTypeString(v)}`
        })
        return `{ ${props.join(', ')} }`
    }

    return 'unknown'
}
