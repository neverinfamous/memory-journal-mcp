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
export enum ErrorCategory {
    /** Input validation failures (bad params, schema violations) */
    VALIDATION = 'validation',

    /** Database/service connection failures */
    CONNECTION = 'connection',

    /** Query/operation execution failures */
    QUERY = 'query',

    /** Permission denied (insufficient privileges) */
    PERMISSION = 'permission',

    /** Server/service configuration errors */
    CONFIGURATION = 'configuration',

    /** Resource not found or unavailable */
    RESOURCE = 'resource',

    /** Authentication failures (invalid/expired credentials) */
    AUTHENTICATION = 'authentication',

    /** Authorization failures (valid credentials, insufficient access) */
    AUTHORIZATION = 'authorization',

    /** Internal/unexpected server errors */
    INTERNAL = 'internal',
}

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
