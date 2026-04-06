/**
 * memory-journal-mcp — Audit Log Types
 *
 * Types and configuration for the JSONL audit trail.
 * Records write/admin tool invocations with optional OAuth identity,
 * timing, and outcome for forensic-grade visibility.
 */

/** Category of the audited operation */
export type AuditCategory = 'read' | 'write' | 'admin'

/**
 * Single audit log entry — serialised as one line of JSONL.
 */
export interface AuditEntry {
    /** ISO 8601 timestamp */
    timestamp: string

    /** Correlates with RequestContext.requestId (or generated UUID) */
    requestId: string

    /** MCP tool name (e.g. "create_entry") */
    tool: string

    /** Operation category */
    category: AuditCategory

    /** OAuth scope required for this tool */
    scope: string

    /** OAuth subject claim — null when OAuth is not configured */
    user: string | null

    /** All scopes present on the calling token */
    scopes: string[]

    /** Execution duration in milliseconds */
    durationMs: number

    /** Whether the tool executed successfully */
    success: boolean

    /** Error message when success is false */
    error?: string | undefined

    /** Tool input arguments (omitted in redact mode) */
    args?: Record<string, unknown> | undefined

    /** Estimated token count of the tool response (~4 bytes per token) */
    tokenEstimate?: number | undefined
}

/** Audit log configuration */
export interface AuditConfig {
    /** Master switch — false means no interceptor is created */
    enabled: boolean

    /** Absolute path to the JSONL output file, or "stderr" for container mode */
    logPath: string

    /** When true, tool arguments are omitted from entries */
    redact: boolean

    /** When true, read-scoped tools are also logged (default: false) */
    auditReads: boolean

    /** Maximum log file size in bytes before rotation (default: 10MB). 0 = no rotation. */
    maxSizeBytes: number
}

// =============================================================================
// Default configuration constants
// =============================================================================

/** Default maximum JSONL audit log size before rotation (10 MB). */
export const DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES = 10 * 1024 * 1024
