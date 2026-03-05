/**
 * Centralized Error Helpers for Memory Journal MCP
 *
 * Provides consistent error formatting across all tool handlers.
 * Follows the deterministic error handling standard from mysql-mcp:
 * all errors return { success: false, error: "Human-readable message" }
 * instead of throwing uncaught exceptions.
 */

import { ZodError } from 'zod'

/**
 * Extract human-readable messages from a ZodError instead of raw JSON array.
 * Maps each Zod issue to its path + message for clear validation feedback.
 */
export function formatZodError(error: ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
            return `${path}${issue.message}`
        })
        .join('; ')
}

/**
 * Format any caught error into a structured handler error response.
 *
 * Handles ZodError (validation) and general errors (runtime).
 * Use as the single catch block for all tool handlers:
 *
 * ```typescript
 * handler: async (params) => {
 *   try {
 *     const parsed = Schema.parse(params);
 *     // ... domain logic ...
 *     return { success: true, ... };
 *   } catch (err) {
 *     return formatHandlerError(err);
 *   }
 * }
 * ```
 */
export function formatHandlerError(err: unknown): {
    success: false
    error: string
} {
    if (err instanceof ZodError) {
        return { success: false, error: formatZodError(err) }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
}
