/**
 * Centralized Error Helpers for Memory Journal MCP
 *
 * Provides consistent error formatting across all tool handlers.
 * All errors return structured responses instead of throwing
 * uncaught exceptions.
 */

import { ZodError } from 'zod'
import { MemoryJournalMcpError } from '../types/errors.js'
import { ErrorCategory, type ErrorResponse } from '../types/error-types.js'
import { matchSuggestion } from './errors/suggestions.js'

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
 * Format any caught error into an enriched ErrorResponse.
 *
 * Returns structured error information including code, category,
 * suggestion, and recoverable flag. Handles MemoryJournalMcpError
 * (full context), ZodError (validation), and raw errors (internal
 * with pattern-matched suggestions from ERROR_SUGGESTIONS).
 *
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
export function formatHandlerError(err: unknown): ErrorResponse {
    // MemoryJournalMcpError and subclasses (OAuthError, SecurityError, etc.)
    if (err instanceof MemoryJournalMcpError) {
        return err.toResponse()
    }

    // Zod validation errors
    if (err instanceof ZodError) {
        return {
            success: false,
            error: formatZodError(err),
            code: 'VALIDATION_ERROR',
            category: ErrorCategory.VALIDATION,
            suggestion: 'Check input parameters against the tool schema',
            recoverable: false,
        }
    }

    // Unknown / raw errors — enrich via ERROR_SUGGESTIONS pattern matching
    const message = err instanceof Error ? err.message : String(err)
    const matched = matchSuggestion(message)
    const sanitizedMessage = message.replace(/(?:[A-Za-z]:)?(?:[\\/][\w.-]+)+[\\/]?/g, '<sanitized_path>')
    
    return {
        success: false,
        error: 'An internal error occurred during tool execution. Please check the server logs for more details.',
        code: matched?.code ?? 'INTERNAL_ERROR',
        category: ErrorCategory.INTERNAL,
        recoverable: false,
        ...(matched?.suggestion ? { suggestion: matched.suggestion } : {}),
        ...(process.env['DEBUG'] === 'true' ? { details: { internal_message: sanitizedMessage } } : {}),
    }
}
