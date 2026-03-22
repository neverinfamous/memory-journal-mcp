/**
 * memory-journal-mcp — Base Error Classes
 *
 * Enriched error hierarchy with category, suggestion, recoverable,
 * and toResponse() for structured error handling.
 */

import { ErrorCategory, type ErrorResponse } from './error-types.js'
import { matchSuggestion, GENERIC_CODES } from '../utils/errors/suggestions.js'

// =============================================================================
// Base Error Options
// =============================================================================

interface ErrorOptions {
    /** Actionable suggestion for resolving the error */
    suggestion?: string

    /** Whether the operation can be retried */
    recoverable?: boolean

    /** Additional structured context */
    details?: Record<string, unknown>

    /** Original cause error */
    cause?: Error
}

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all memory-journal-mcp errors.
 * Provides structured error responses with category, suggestion,
 * and recoverable fields for agent-friendly error handling.
 *
 * Auto-refinement: when constructed with a generic code (e.g., QUERY_FAILED)
 * and the message matches a known pattern from ERROR_SUGGESTIONS, the code
 * is refined to a more specific value (e.g., TABLE_NOT_FOUND).
 */
export class MemoryJournalMcpError extends Error {
    /** Module-prefixed error code */
    readonly code: string

    /** Error category for programmatic handling */
    readonly category: ErrorCategory

    /** Actionable suggestion for resolving the error */
    readonly suggestion?: string

    /** Whether the operation can be retried */
    readonly recoverable: boolean

    /** Additional structured context */
    readonly details?: Record<string, unknown>

    constructor(message: string, code: string, category: ErrorCategory, options?: ErrorOptions) {
        super(message, options?.cause ? { cause: options.cause } : undefined)
        this.name = 'MemoryJournalMcpError'
        this.category = category
        this.recoverable = options?.recoverable ?? false
        this.details = options?.details

        // Auto-refinement: refine generic codes to specific ones via pattern matching
        const matched = matchSuggestion(message)
        if (GENERIC_CODES.has(code) && matched?.code) {
            this.code = matched.code
        } else {
            this.code = code
        }

        // Apply suggestion: explicit > matched > none
        this.suggestion = options?.suggestion ?? matched?.suggestion
    }

    /**
     * Convert to a structured ErrorResponse for tool responses.
     */
    toResponse(): ErrorResponse {
        return {
            success: false,
            error: this.message,
            code: this.code,
            category: this.category,
            suggestion: this.suggestion,
            recoverable: this.recoverable,
            ...(this.details ? { details: this.details } : {}),
        }
    }
}

// =============================================================================
// Database Errors
// =============================================================================

/**
 * Database connection or initialization error
 */
export class ConnectionError extends MemoryJournalMcpError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'CONNECTION_FAILED', ErrorCategory.CONNECTION, {
            suggestion: 'Check database path and file permissions',
            recoverable: true,
            details,
        })
        this.name = 'ConnectionError'
    }
}

/**
 * Query execution error
 */
export class QueryError extends MemoryJournalMcpError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'QUERY_FAILED', ErrorCategory.QUERY, {
            suggestion: 'Check query parameters and database state',
            recoverable: false,
            details,
        })
        this.name = 'QueryError'
    }
}

// =============================================================================
// Validation Errors
// =============================================================================

/**
 * Input validation error (bad parameters, schema violations)
 */
export class ValidationError extends MemoryJournalMcpError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'VALIDATION_FAILED', ErrorCategory.VALIDATION, {
            suggestion: 'Check input parameters against the tool schema',
            recoverable: false,
            details,
        })
        this.name = 'ValidationError'
    }
}

// =============================================================================
// Resource Errors
// =============================================================================

/**
 * Resource not found error
 */
export class ResourceNotFoundError extends MemoryJournalMcpError {
    constructor(resourceType: string, identifier: string) {
        super(
            `${resourceType} not found: ${identifier}`,
            'RESOURCE_NOT_FOUND',
            ErrorCategory.RESOURCE,
            {
                suggestion: `Verify the ${resourceType.toLowerCase()} identifier and try again`,
                recoverable: false,
                details: { resourceType, identifier },
            }
        )
        this.name = 'ResourceNotFoundError'
    }
}

// =============================================================================
// Configuration Errors
// =============================================================================

/**
 * Server or service configuration error
 */
export class ConfigurationError extends MemoryJournalMcpError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'CONFIGURATION_ERROR', ErrorCategory.CONFIGURATION, {
            suggestion: 'Check server configuration and environment variables',
            recoverable: false,
            details,
        })
        this.name = 'ConfigurationError'
    }
}

// =============================================================================
// Permission Errors
// =============================================================================

/**
 * File or database permission error
 */
export class PermissionError extends MemoryJournalMcpError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'PERMISSION_DENIED', ErrorCategory.PERMISSION, {
            suggestion: 'Check file permissions and database access rights',
            recoverable: false,
            details,
        })
        this.name = 'PermissionError'
    }
}
