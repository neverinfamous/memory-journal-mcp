/**
 * Centralized Error Helpers for Memory Journal MCP
 *
 * Provides consistent error formatting across all tool handlers.
 * All errors return structured responses instead of throwing
 * uncaught exceptions.
 */

import { ZodError } from 'zod'
import { MemoryJournalMcpError } from '../types/errors.js'
import type { ErrorResponse } from '../types/error-types.js'
import { matchSuggestion } from './errors/suggestions.js'
import { sanitizeErrorForLogging } from './security-utils.js'

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

function sanitizeErrorMessageForResponse(message: string): string {
    return sanitizeErrorForLogging(message).replace(
        /(?:[A-Za-z]:)?(?:[\\/][\w.-]+)+[\\/]?/g,
        '<sanitized_path>'
    )
}

function formatUnknownHandlerError(err: unknown): ErrorResponse {
    let extractedMessage: string | undefined
    if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof err.message === 'string'
    ) {
        extractedMessage = err.message
    }
    const message = err instanceof Error ? err.message : (extractedMessage ?? String(err))
    const matched = matchSuggestion(message)
    const sanitizedMessage = sanitizeErrorMessageForResponse(message)

    const isAutonomousHealing = message.includes('🛠️ AUTONOMOUS HEALING:')
    const isRuntimeError = err instanceof Error || extractedMessage !== undefined
    const displayError =
        isAutonomousHealing || isRuntimeError || matched !== undefined
            ? sanitizedMessage
            : 'An internal error occurred during tool execution. Please check the server logs for more details.'

    return {
        success: false,
        error: displayError,
        code:
            matched?.code ??
            (isAutonomousHealing || isRuntimeError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
        category: isAutonomousHealing || isRuntimeError ? 'validation' : 'internal',
        recoverable: isAutonomousHealing || isRuntimeError || matched !== undefined,
        ...(matched?.suggestion ? { suggestion: matched.suggestion } : {}),
        ...(process.env['DEBUG'] === 'true'
            ? { details: { internal_message: sanitizedMessage } }
            : {}),
    }
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
        const response = err.toResponse()
        response.error = sanitizeErrorForLogging(response.error)
        if (!err.hasExplicitSuggestion) {
            const matched = matchSuggestion(err.message)
            if (matched?.suggestion !== undefined) {
                response.suggestion = matched.suggestion
            }
        }
        return response
    }

    // Native AggregateError handling
    if (typeof AggregateError !== 'undefined' && err instanceof AggregateError) {
        return {
            success: false,
            error: sanitizeErrorForLogging(err.message),
            code: 'AGGREGATE_ERROR',
            category: 'internal',
            recoverable: false,
            aggregated_errors: err.errors.map((e: unknown) => ({
                message: sanitizeErrorForLogging(e instanceof Error ? e.message : String(e)),
                ...(e instanceof Error && e.name ? { name: e.name } : {}),
            })),
        }
    }

    // Zod validation errors
    if (err instanceof ZodError) {
        const formatted = sanitizeErrorForLogging(formatZodError(err))
        const matched = matchSuggestion(formatted)
        return {
            success: false,
            error: formatted,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            suggestion: matched?.suggestion ?? 'Check input parameters against the tool schema',
            recoverable: false,
        }
    }

    return formatUnknownHandlerError(err)
}
