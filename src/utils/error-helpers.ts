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
import { SENSITIVE_KEY_RE, sanitizeErrorForLogging } from './security-utils.js'
import { isCrossRealmDate, isCrossRealmError, tryResolveToJson } from './sanitize-value-helpers.js'
import { createNullProtoRecord, isRecord } from './type-guards.js'

const MAX_ERROR_DETAILS_SCRUB_DEPTH = 6
export const HOST_FILESYSTEM_PATH_RE =
    /(?<![a-zA-Z]:\/\/)(?:[A-Za-z]:[\\/][\w./\\-]+|\\\\[\w.-]+\\[\w./\\-]+|(?<![\w:/])\/(?:Users|home|var|tmp|private|etc|opt|mnt|root|app|data|srv)\/[\w./-]+)/g

function scrubObjectRecord(
    value: object,
    depth: number,
    seen: WeakSet<object>
): Record<string, unknown> {
    if (depth === 0 && !isCrossRealmError(value)) {
        const jsonRes = tryResolveToJson(value)
        if (jsonRes.resolved) {
            const inner = scrubDetailsValue(jsonRes.value, depth + 1, seen)
            if (isRecord(inner)) {
                return inner
            }
            const wrapped = createNullProtoRecord()
            wrapped['value'] = inner
            return wrapped
        }
    }
    const out = createNullProtoRecord()
    if (isCrossRealmError(value)) {
        out['name'] = sanitizeErrorForLogging(value.name)
        out['message'] = sanitizeErrorMessageForResponse(value.message)
    }
    if (isRecord(value)) {
        for (const [k, v] of Object.entries(value)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k === 'toJSON' || typeof v === 'function') {
                continue
            }
            const safeKey = sanitizeErrorForLogging(k)
            out[safeKey] =
                SENSITIVE_KEY_RE.test(k) || SENSITIVE_KEY_RE.test(safeKey)
                    ? '[REDACTED]'
                    : scrubDetailsValue(v, depth + 1, seen)
        }
    }
    return out
}

function scrubDetailsValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') {
        return sanitizeErrorForLogging(value).replace(HOST_FILESYSTEM_PATH_RE, '<sanitized_path>')
    }
    if (typeof value === 'function') return '[Function]'
    if (typeof value === 'bigint') return value.toString()
    if (value === null || typeof value !== 'object') return value
    if (isCrossRealmDate(value)) {
        return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
    }
    if (value instanceof URL) {
        return sanitizeErrorForLogging(value.href)
    }
    if (seen.has(value)) return '[Circular]'
    if (depth >= MAX_ERROR_DETAILS_SCRUB_DEPTH) return '[Truncated]'
    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return value.map((item) => scrubDetailsValue(item, depth + 1, seen))
        }
        if (!isCrossRealmError(value)) {
            const jsonRes = tryResolveToJson(value)
            if (jsonRes.resolved) return scrubDetailsValue(jsonRes.value, depth + 1, seen)
        }
        return scrubObjectRecord(value, depth, seen)
    } finally {
        seen.delete(value)
    }
}

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

export function sanitizeErrorMessageForResponse(message: string): string {
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
    const isErr = isCrossRealmError(err)
    const message = isErr ? err.message : (extractedMessage ?? String(err))
    const matched = matchSuggestion(message)
    const sanitizedMessage = sanitizeErrorMessageForResponse(message)

    const isAutonomousHealing = message.includes('🛠️ AUTONOMOUS HEALING:')
    const isRuntimeError = isErr || extractedMessage !== undefined
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
        response.error = sanitizeErrorForLogging(response.error).replace(
            HOST_FILESYSTEM_PATH_RE,
            '<sanitized_path>'
        )
        if (Array.isArray(response.aggregated_errors)) {
            response.aggregated_errors = response.aggregated_errors.map((entry) => {
                const scrubbed = scrubObjectRecord(entry, 0, new WeakSet([entry]))
                return {
                    ...scrubbed,
                    message: sanitizeErrorMessageForResponse(entry.message),
                }
            })
        }
        if (response.details !== undefined) {
            response.details = scrubObjectRecord(
                response.details,
                0,
                new WeakSet([response.details])
            )
        }
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
            error: sanitizeErrorMessageForResponse(err.message),
            code: 'AGGREGATE_ERROR',
            category: 'internal',
            recoverable: false,
            aggregated_errors: err.errors.map((e: unknown) => ({
                message: sanitizeErrorMessageForResponse(
                    isCrossRealmError(e) ? e.message : String(e)
                ),
                ...(isCrossRealmError(e) && e.name ? { name: sanitizeErrorForLogging(e.name) } : {}),
            })),
        }
    }

    // Zod validation errors
    if (err instanceof ZodError) {
        const formatted = sanitizeErrorForLogging(formatZodError(err)).replace(
            HOST_FILESYSTEM_PATH_RE,
            '<sanitized_path>'
        )
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
