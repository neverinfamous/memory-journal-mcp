/**
 * Shared Error Response Fields for Output Schemas
 *
 * Defines the ErrorFieldsMixin Zod schema fragment that gets extended into
 * every output schema. This ensures formatHandlerError() responses pass
 * output schema validation (MCP SDK enforces additionalProperties: false).
 */

import { z } from 'zod'

/**
 * Standard error response fields returned by formatHandlerError().
 * Extend this into every output schema:
 *   export const MyOutputSchema = z.object({ ... }).extend(ErrorFieldsMixin.shape);
 */
export const ErrorFieldsMixin = z.object({
    error: z
        .string()
        .optional()
        .describe('Human-readable error message'),
    code: z
        .string()
        .optional()
        .describe('Error code (e.g. VALIDATION_ERROR, INTERNAL_ERROR)'),
    category: z
        .string()
        .optional()
        .describe('Error category (validation, query, connection, internal)'),
    recoverable: z
        .boolean()
        .optional()
        .describe('Whether the error is recoverable'),
    suggestion: z
        .string()
        .optional()
        .describe('Suggested fix for the error'),
    details: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Additional error context'),
})
