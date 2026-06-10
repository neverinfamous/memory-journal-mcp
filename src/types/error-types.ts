/**
 * memory-journal-mcp — Error Type Definitions
 *
 * Standardized error types for the harmonized error handling system
 * across all MCP servers (db-mcp, postgres-mcp, mysql-mcp, memory-journal-mcp).
 */

// =============================================================================
// Error Category
// =============================================================================

/**
 * Categorization of error types for structured error responses.
 * Enables agents to make programmatic decisions based on error category.
 */
export type ErrorCategory =
    | 'validation'
    | 'connection'
    | 'query'
    | 'permission'
    | 'configuration'
    | 'resource'
    | 'authentication'
    | 'authorization'
    | 'internal'
    | 'conflict'

// =============================================================================
// Error Response
// =============================================================================

/**
 * Structured error response returned by tools.
 * Provides agents with actionable context for error handling.
 */
export interface ErrorResponse {
    /** Always false for error responses */
    success: false

    /** Human-readable error message */
    error: string

    /** Module-prefixed error code (e.g., 'AUTH_TOKEN_EXPIRED') */
    code: string

    /** Error category for programmatic handling */
    category: ErrorCategory

    /** Actionable suggestion for resolving the error */
    suggestion?: string

    /** Whether the operation can be retried */
    recoverable: boolean

    /** Details of individual errors in a multi-step operation */
    aggregated_errors?: { message: string; [key: string]: unknown }[]

    /** Additional structured context */
    details?: Record<string, unknown>
}

// =============================================================================
// Error Context
// =============================================================================

/**
 * Context information for error reporting and diagnostics.
 */
export interface ErrorContext {
    /** The operation that failed */
    operation?: string

    /** Entity identifier involved */
    entityId?: string | number

    /** Additional context key-value pairs */
    [key: string]: unknown
}
