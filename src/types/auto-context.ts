/**
 * Memory Journal MCP Server - AutoContext boundary validation
 */

import { z } from 'zod'
import { logger } from '../utils/logger.js'

/**
 * Hush Protocol Flag Context Schema
 */
export const FlagContextSchema = z.object({
    flag_type: z.string(),
    target_user: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
    resolved: z.boolean(),
    resolved_at: z.string().nullable().optional(),
    resolution: z.string().nullable().optional(),
    author: z.string().optional(),
})

export type FlagContext = z.infer<typeof FlagContextSchema>

/**
 * Versioned Envelope Schema for explicit typing
 */
export const VersionedEnvelopeSchema = z.object({
    version: z.string(),
    data: z.unknown(),
})

export type VersionedEnvelope = z.infer<typeof VersionedEnvelopeSchema>

/**
 * Union schema for all valid AutoContext payloads
 */
export const AutoContextSchema = z.union([
    FlagContextSchema,
    VersionedEnvelopeSchema
])

/**
 * Helper to safely parse and validate autoContext JSON.
 * Returns the parsed object, or null if invalid/omitted.
 */
export function parseAutoContext(autoContext: string | null | undefined): Record<string, unknown> | null {
    if (!autoContext) return null

    try {
        const parsed = JSON.parse(autoContext) as unknown
        if (typeof parsed !== 'object' || parsed === null) {
            return null
        }

        const result = AutoContextSchema.safeParse(parsed)
        if (result.success) {
            return result.data
        }

        logger.debug('AutoContext schema miss', {
            module: 'Validator',
            issues: result.error.issues,
        })

        return parsed as Record<string, unknown>
    } catch (error: unknown) {
        logger.warning('Failed to parse auto_context JSON', {
            module: 'Validator',
            error: error instanceof Error ? error.message : 'Unknown error',
        })
        return null
    }
}

/**
 * Safe extractor specifically for Flag entries.
 */
export function parseFlagContext(autoContext: string | null | undefined): FlagContext | null {
    const parsed = parseAutoContext(autoContext)
    if (parsed === null) return null

    const result = FlagContextSchema.safeParse(parsed)
    return result.success ? result.data : null
}
