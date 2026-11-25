import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { logger } from '../../../utils/logger.js'

const relaxedInputSchemaCache = new WeakMap<object, unknown>()
const relaxedOutputSchemaCache = new WeakMap<object, StandardSchemaWithJSON | null>()

export function isStandardSchemaWithJson(value: unknown): value is StandardSchemaWithJSON {
    return (
        typeof value === 'object' &&
        value !== null &&
        ('~standard' in value || 'partial' in value || 'loose' in value || 'passthrough' in value)
    )
}

type ZeroArgMethod = () => unknown

function hasZeroArgMethod<K extends string>(
    obj: object,
    method: K
): obj is Record<K, ZeroArgMethod> {
    return method in obj && typeof Reflect.get(obj, method) === 'function'
}

function relaxInputSchemaRecursive(schema: unknown, depth: number): unknown {
    if (depth > 16 || typeof schema !== 'object' || schema === null) {
        return schema
    }
    if (schema instanceof z.ZodObject) {
        return schema.partial().loose()
    }
    if (schema instanceof z.ZodPipe) {
        const relaxedIn = relaxInputSchemaRecursive(schema.in, depth + 1)
        const relaxedOut = relaxInputSchemaRecursive(schema.out, depth + 1)
        if (
            (relaxedIn !== schema.in || relaxedOut !== schema.out) &&
            relaxedIn instanceof z.ZodType &&
            relaxedOut instanceof z.ZodType
        ) {
            return z.pipe(relaxedIn, relaxedOut)
        }
        return schema
    }
    if (hasZeroArgMethod(schema, 'partial')) {
        const relaxed = schema.partial()
        if (typeof relaxed === 'object' && relaxed !== null) {
            if (hasZeroArgMethod(relaxed, 'loose')) {
                return relaxed.loose()
            }
            if (hasZeroArgMethod(relaxed, 'passthrough')) {
                return relaxed.passthrough()
            }
        }
    }
    return schema
}

/** Relax an MCP input schema (memoized per schema instance). */
export function relaxInputSchemaForMcp(schema: unknown): unknown {
    if (typeof schema !== 'object' || schema === null) return schema
    const cached = relaxedInputSchemaCache.get(schema)
    if (cached !== undefined) return cached
    const relaxed = relaxInputSchemaRecursive(schema, 0)
    relaxedInputSchemaCache.set(schema, relaxed)
    return relaxed
}

function tryRelaxOutputSchema(outSchema: unknown): StandardSchemaWithJSON | undefined {
    if (outSchema instanceof z.ZodObject) {
        const looseSchema: unknown = outSchema.loose()
        return isStandardSchemaWithJson(looseSchema) ? looseSchema : undefined
    }
    if (typeof outSchema !== 'object' || outSchema === null) {
        return undefined
    }
    if (hasZeroArgMethod(outSchema, 'loose')) {
        const res = outSchema.loose()
        return isStandardSchemaWithJson(res) ? res : undefined
    }
    if (hasZeroArgMethod(outSchema, 'passthrough')) {
        const res = outSchema.passthrough()
        return isStandardSchemaWithJson(res) ? res : undefined
    }
    return undefined
}

/** Relax an MCP output schema (memoized per schema instance). */
export function relaxOutputSchemaForMcp(
    outSchema: unknown,
    toolName: string
): StandardSchemaWithJSON | undefined {
    if (typeof outSchema !== 'object' || outSchema === null) return undefined
    const cached = relaxedOutputSchemaCache.get(outSchema)
    if (cached !== undefined) return cached ?? undefined
    const fallbackOutputSchema = isStandardSchemaWithJson(outSchema) ? outSchema : undefined
    try {
        const relaxed = tryRelaxOutputSchema(outSchema)
        if (relaxed !== undefined) {
            relaxedOutputSchemaCache.set(outSchema, relaxed)
            return relaxed
        }
    } catch (error) {
        logger.warning('Failed to relax output schema; using fallback schema', {
            module: 'McpServer',
            tool: toolName,
            error: error instanceof Error ? error.message : String(error),
        })
    }
    relaxedOutputSchemaCache.set(outSchema, fallbackOutputSchema ?? null)
    return fallbackOutputSchema
}
