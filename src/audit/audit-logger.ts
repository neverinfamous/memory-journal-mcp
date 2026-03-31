/**
 * Audit Logger
 *
 * Enterprise-grade JSONL audit trail for write and admin scope tool calls.
 * Per mcp-builder §2.2.4:
 *   - JSONL format: one JSON object per line
 *   - Rotation: max 10 MB per file, keep 5 historical archives (.1–.5)
 *   - Redaction: optional — omit tool args when AUDIT_REDACT is set
 *   - Scope: write + admin tools only (read-only tools contribute to metrics only)
 *
 * Rotation strategy: checked on every write. When the current file exceeds
 * MAX_FILE_BYTES, existing archives are shifted (.4→.5, .3→.4, …, current→.1)
 * and a fresh file is started. Rotation errors are swallowed — audit failures
 * must never crash the main process.
 */

import fs from 'node:fs'
import path from 'node:path'

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ARCHIVES = 5

// ============================================================================
// Types
// ============================================================================

export interface AuditEntry {
    /** ISO 8601 timestamp */
    timestamp: string
    /** Tool name that was called */
    toolName: string
    /** OAuth scope of the tool (write | admin) */
    scope: 'write' | 'admin'
    /** Wall-clock execution duration in ms */
    durationMs: number
    /** Estimated input tokens */
    inputTokens: number
    /** Estimated output tokens */
    outputTokens: number
    /** Whether the tool returned an error result */
    isError: boolean
    /** Tool arguments — omitted when redaction is enabled */
    args?: Record<string, unknown>
}

export interface AuditLoggerConfig {
    /** Absolute path to the audit JSONL log file */
    logPath: string
    /** When true, tool args are omitted from audit entries */
    redact: boolean
}

// ============================================================================
// Rotation Helper
// ============================================================================

/**
 * Rotate the log file if it exceeds MAX_FILE_BYTES.
 * Shifts existing archives: .5 deleted, .4→.5, …, current→.1
 * Errors are swallowed to avoid crashing the process.
 */
function rotateIfNeeded(logPath: string): void {
    try {
        const stat = fs.statSync(logPath)
        if (stat.size < MAX_FILE_BYTES) return
    } catch {
        return // File doesn't exist yet — no rotation needed
    }

    try {
        // Shift archives in reverse order
        for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
            const older = `${logPath}.${i}`
            const newer = `${logPath}.${i + 1}`
            if (fs.existsSync(older)) {
                fs.renameSync(older, newer)
            }
        }
        // Archive current → .1
        fs.renameSync(logPath, `${logPath}.1`)
    } catch {
        // Swallow rotation errors — non-critical
    }
}

// ============================================================================
// AuditLogger Class
// ============================================================================

export class AuditLogger {
    private readonly logPath: string
    private readonly redact: boolean
    private initialized = false

    constructor(config: AuditLoggerConfig) {
        this.logPath = config.logPath
        this.redact = config.redact
    }

    /**
     * Ensure the log directory exists. Called lazily on first write.
     * Errors are swallowed — logger must never crash the process.
     */
    private ensureDir(): void {
        if (this.initialized) return
        try {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true })
            this.initialized = true
        } catch {
            // Swallow dir creation errors
            this.initialized = true
        }
    }

    /**
     * Write an audit entry to the JSONL log.
     * Triggers rotation check before each write.
     * All errors are swallowed.
     */
    log(entry: AuditEntry): void {
        try {
            this.ensureDir()
            rotateIfNeeded(this.logPath)

            const record: Record<string, unknown> = {
                timestamp: entry.timestamp,
                toolName: entry.toolName,
                scope: entry.scope,
                durationMs: entry.durationMs,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
                isError: entry.isError,
            }

            if (!this.redact && entry.args !== undefined) {
                record['args'] = entry.args
            }

            fs.appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf8')
        } catch {
            // Swallow write errors — never crash the main process
        }
    }
}

// ============================================================================
// Null Logger (used when audit logging is disabled)
// ============================================================================

/** No-op logger returned when AUDIT_LOG_PATH is not configured */
export class NullAuditLogger {
    log(_entry: AuditEntry): void {
        // intentional no-op
    }
}

export type AuditLoggerInstance = AuditLogger | NullAuditLogger

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an AuditLogger if logPath is provided, otherwise a NullAuditLogger.
 */
export function createAuditLogger(
    logPath: string | undefined,
    redact: boolean
): AuditLoggerInstance {
    if (!logPath) return new NullAuditLogger()
    return new AuditLogger({ logPath, redact })
}
