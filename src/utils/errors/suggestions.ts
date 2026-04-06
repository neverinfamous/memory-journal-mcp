/**
 * Error Suggestions — Fuzzy Pattern Matching for Error Messages
 *
 * Maps common error message patterns to actionable suggestions and
 * specific error codes. Used by:
 * 1. MemoryJournalMcpError constructor — auto-refines generic codes
 * 2. formatHandlerError() — enriches raw Error responses
 */

// =============================================================================
// Types
// =============================================================================

interface ErrorSuggestion {
    /** RegExp to test against error messages (case-insensitive) */
    pattern: RegExp
    /** Human-readable suggestion for resolving the error */
    suggestion: string
    /** Optional specific code to auto-refine generic codes into */
    code?: string
}

// =============================================================================
// Generic codes eligible for auto-refinement
// =============================================================================

/** Codes that can be refined to a more specific code when a pattern matches */
export const GENERIC_CODES = new Set(['QUERY_FAILED', 'INTERNAL_ERROR', 'UNKNOWN_ERROR'])

// =============================================================================
// Suggestion Table
// =============================================================================

export const ERROR_SUGGESTIONS: ErrorSuggestion[] = [
    // Resource not found patterns
    {
        pattern: /not found/i,
        suggestion: 'Verify the resource identifier and try again',
        code: 'RESOURCE_NOT_FOUND',
    },
    {
        pattern: /no such table/i,
        suggestion: 'The database table does not exist. Run database initialization.',
        code: 'TABLE_NOT_FOUND',
    },
    // Permission / access patterns
    {
        pattern: /permission denied|SQLITE_READONLY/i,
        suggestion: 'Check file permissions and database access rights',
        code: 'PERMISSION_DENIED',
    },
    // Connection / lock patterns
    {
        pattern: /database is locked/i,
        suggestion: 'The database is locked by another process. Retry after a short delay.',
        code: 'CONNECTION_FAILED',
    },
    // Constraint patterns
    {
        pattern: /SQLITE_CONSTRAINT|unique constraint/i,
        suggestion: 'A uniqueness or integrity constraint was violated. Check input values.',
        code: 'VALIDATION_FAILED',
    },
    // Disk / space patterns
    {
        pattern: /disk I\/O|SQLITE_FULL/i,
        suggestion: 'The disk may be full or the filesystem is read-only.',
    },
    // Malformed input patterns
    {
        pattern: /malformed|invalid json|unexpected token/i,
        suggestion: 'The input appears malformed. Check the format and try again.',
        code: 'VALIDATION_FAILED',
    },
    // Schema / types patterns
    {
        pattern: /invalid input syntax for type|requires a.*column/i,
        suggestion: 'The provided value is not valid for the assigned type.',
        code: 'VALIDATION_FAILED',
    },
    {
        pattern: /^Missing required parameters:/i,
        suggestion: 'Provide all required parameters in your request.',
        code: 'VALIDATION_FAILED',
    },
    // Codemode / Sandbox patterns
    {
        pattern: /execution timed out/i,
        suggestion: 'Reduce code complexity or increase timeout (max 30s). Break into smaller operations.',
        code: 'QUERY_FAILED',
    },
    {
        pattern: /code validation failed/i,
        suggestion: 'Check for blocked patterns. Use mj.* API instead.',
        code: 'VALIDATION_FAILED',
    },
    {
        pattern: /sandbox.*not initialized/i,
        suggestion: 'Internal sandbox error. Retry the operation.',
        code: 'INTERNAL_ERROR',
    },
]

// =============================================================================
// Matching
// =============================================================================

/**
 * Find the first matching suggestion for an error message.
 * Returns `undefined` if no pattern matches.
 */
export function matchSuggestion(
    message: string
): { suggestion: string; code?: string } | undefined {
    for (const entry of ERROR_SUGGESTIONS) {
        if (entry.pattern.test(message)) {
            return { suggestion: entry.suggestion, code: entry.code }
        }
    }
    return undefined
}
