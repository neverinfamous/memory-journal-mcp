/**
 * memory-journal-mcp — Operational Telemetry Logger
 *
 * Async-buffered JSONL writer for operational telemetry. Appends one
 * JSON object per line to a configurable file path, or writes to
 * stderr for containerised deployments (`--audit-log stderr`).
 *
 * Architecture aligned with postgres-mcp's production-proven logger:
 *   - JSONL format: one JSON object per line
 *   - Async buffered: 50-entry high-water mark + 100ms auto-flush
 *   - Rotation: configurable max size, keep 5 historical archives (.1–.5)
 *   - Graceful close: flushes remaining entries and stops the timer
 *   - Streaming tail-read: recent() reads only last 64KB for O(1) memory
 *   - stderr mode: `--audit-log stderr` routes to process.stderr
 *
 * Non-throwing by design: telemetry failures log to stderr but never
 * propagate to tool callers.
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AuditConfig, AuditEntry, AuditSearchFilters } from './types.js'
import { logger } from '../utils/logger.js'
import { getRequestContext } from '../utils/request-context.js'
import { getErrnoCode } from '../utils/type-guards.js'
import { bigintReplacer } from '../observability/token-estimator.js'
import {
    appendRegularFileNoFollow,
    rotateAuditLogFiles,
    searchAuditFileBackward,
} from './audit-file-helpers.js'
import { compileAuditSearchFilters } from './audit-filter-helpers.js'

// ============================================================================
// Constants
// ============================================================================

/** Maximum entries to buffer before forcing a flush */
const BUFFER_HIGH_WATER = 50

/** Auto-flush interval in milliseconds */
const FLUSH_INTERVAL_MS = 100

/** Default number of recent entries returned by `recent()` */
const DEFAULT_RECENT_COUNT = 50

/** Special logPath value that routes audit output to stderr */
const STDERR_SENTINEL = 'stderr'

/** Default number of archives to keep */
const MAX_ARCHIVES = 5

// ============================================================================
// AuditLogger Class
// ============================================================================

const MAX_AUDIT_LINE_BYTES = 262_144

function capAuditString(value: string | undefined, maxLen: number): string | undefined {
    if (value === undefined) return undefined
    return value.length > maxLen ? value.slice(0, maxLen) : value
}

function capBoundedAuditEntry(entry: AuditEntry, lineBytes: number): AuditEntry {
    const boundedScopes = Array.isArray(entry.scopes)
        ? entry.scopes.slice(0, 32).map((sc) => sc.slice(0, 64))
        : []
    const boundedError =
        entry.error !== undefined && entry.error.length > 4096
            ? `${entry.error.slice(0, 4096)}...[truncated]`
            : entry.error
    return {
        timestamp: entry.timestamp.slice(0, 64),
        requestId: entry.requestId.slice(0, 128),
        ...(entry.sessionId !== undefined ? { sessionId: capAuditString(entry.sessionId, 256) } : {}),
        tool: entry.tool.slice(0, 256),
        category: entry.category,
        scope: entry.scope,
        user: entry.user !== null ? entry.user.slice(0, 256) : null,
        scopes: boundedScopes,
        durationMs: entry.durationMs,
        tokenEstimate: entry.tokenEstimate,
        ...(entry.workspaceId !== undefined ? { workspaceId: capAuditString(entry.workspaceId, 255) } : {}),
        ...(entry.projectNumber !== undefined ? { projectNumber: entry.projectNumber } : {}),
        success: entry.success,
        ...(boundedError !== undefined ? { error: boundedError } : {}),
        ...(entry.args !== undefined ? { args: { _truncated: true, originalBytes: lineBytes } } : {}),
    }
}

function serializeAuditEntryWithFallback(target: AuditEntry): string {
    try {
        const json = JSON.stringify(target)
        if (typeof json === 'string') return json
    } catch {
        // Fall through to bigint-coercing / stripped fallback below
    }
    try {
        return JSON.stringify(target, bigintReplacer)
    } catch {
        return JSON.stringify({
            timestamp: target.timestamp,
            requestId: target.requestId,
            ...(target.sessionId !== undefined ? { sessionId: target.sessionId } : {}),
            tool: target.tool,
            category: target.category,
            scope: target.scope,
            user: target.user,
            scopes: target.scopes,
            durationMs: target.durationMs,
            tokenEstimate: target.tokenEstimate,
            ...(target.workspaceId !== undefined ? { workspaceId: target.workspaceId } : {}),
            ...(target.projectNumber !== undefined ? { projectNumber: target.projectNumber } : {}),
            success: target.success,
            ...(target.error !== undefined ? { error: target.error.slice(0, 4096) } : {}),
            args: { _serializationError: 'Audit args could not be JSON serialized' },
        })
    }
}

function serializeBoundedAuditEntry(entry: AuditEntry): string {
    const serialized = serializeAuditEntryWithFallback(entry)
    if (serialized.length * 3 <= MAX_AUDIT_LINE_BYTES) return serialized
    const lineBytes = Buffer.byteLength(serialized, 'utf8')
    if (lineBytes <= MAX_AUDIT_LINE_BYTES) return serialized

    // Keep the serialized JSONL line well below the 1 MB backward-reader skip ceiling across ALL fields
    const bounded = serializeAuditEntryWithFallback(capBoundedAuditEntry(entry, lineBytes))
    if (Buffer.byteLength(bounded, 'utf8') <= MAX_AUDIT_LINE_BYTES) return bounded

    return JSON.stringify({
        timestamp: entry.timestamp.slice(0, 64),
        requestId: entry.requestId.slice(0, 128),
        tool: entry.tool.slice(0, 256),
        category: entry.category,
        scope: entry.scope,
        user: entry.user !== null ? entry.user.slice(0, 128) : null,
        scopes: [],
        durationMs: entry.durationMs,
        tokenEstimate: entry.tokenEstimate,
        success: entry.success,
        args: { _truncated: true, originalBytes: lineBytes },
    })
}

export class AuditLogger {
    readonly config: AuditConfig

    private buffer: string[] = []
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private flushQueue: Promise<void> = Promise.resolve()
    private closed = false
    private flushError: Error | null = null
    private dirEnsured = false
    private readonly stderrMode: boolean
    private approxSizeBytes: number | null = null

    private _droppedCount = 0

    constructor(config: AuditConfig) {
        this.config = config
        this.stderrMode = config.logPath.toLowerCase() === STDERR_SENTINEL
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== null || this.closed || !this.config.enabled) return
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            void this.flush()
        }, FLUSH_INTERVAL_MS)
        this.flushTimer.unref()
    }

    /**
     * Total number of events dropped due to memory limits or persistent I/O failure.
     */
    get droppedCount(): number {
        return this._droppedCount
    }

    /**
     * Whether audit logging is configured for write-only stderr output.
     */
    isStderrOnly(): boolean {
        return this.stderrMode
    }

    /**
     * Append an audit entry to the buffer.
     * Non-blocking — the entry is serialised and queued; the
     * actual file write happens on the next flush cycle.
     *
     * NOTE: This is a lossy operational telemetry mechanism, not a guaranteed immutable ledger.
     * Under extreme backpressure or persistent I/O failure, oldest entries will be dropped
     * to preserve memory and system stability.
     */
    log(entry: AuditEntry): void {
        if (this.closed || !this.config.enabled) return

        const serialized = serializeBoundedAuditEntry(entry)
        this.buffer.push(serialized)

        // Hard cap to prevent unbounded heap growth if flush loop hangs
        if (this.buffer.length > 5000) {
            this.buffer.shift()
            if (this._droppedCount === 0) {
                logger.warning(
                    'Telemetry buffer overflow. Dropping oldest entries. Note: This log is a lossy operational telemetry mechanism.',
                    { module: 'Audit' }
                )
            }
            this._droppedCount++
        }

        if (this.buffer.length >= BUFFER_HIGH_WATER) void this.flush()
        else this.scheduleFlush()
    }

    /** Log a denied access attempt. */
    logDenial(
        toolName: string,
        reason: string,
        context?: { user?: string | null; scopes?: string[]; category?: AuditEntry['category']; scope?: string; requestId?: string; sessionId?: string }
    ): void {
        this.log({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId ?? `denied-${Date.now().toString()}`,
            sessionId: context?.sessionId ?? getRequestContext()?.sessionId ?? undefined,
            tool: toolName,
            category: context?.category ?? 'read',
            scope: context?.scope ?? '',
            user: context?.user ?? null,
            scopes: context?.scopes ?? [],
            durationMs: 0,
            success: false,
            error: `Access Denied: ${reason}`,
        })
    }

    /**
     * Flush the buffer to disk.
     * Safe to call concurrently — serialises via `this.flushQueue` Promise chain.
     */
    async flush(): Promise<void> {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        if (this.buffer.length === 0) {
            await this.flushQueue
            return
        }

        this.flushQueue = this.flushQueue
            .then(async () => {
                if (this.buffer.length === 0) return

                // Rotate before writing if the log exceeds the configured size
                await this.rotateIfNeeded()

                // Swap the buffer so new entries can accumulate while we write
                const lines = this.buffer
                this.buffer = []

                try {
                    const payload = lines.join('\n') + '\n'
                    if (this.stderrMode) {
                        // Stderr mode: write directly, no buffering to disk
                        process.stderr.write(payload)
                    } else {
                        await this.ensureDirectory()
                        await appendRegularFileNoFollow(this.config.logPath, payload)
                        if (this.approxSizeBytes !== null) {
                            this.approxSizeBytes += Buffer.byteLength(payload, 'utf-8')
                        }
                    }
                    // A successful write supersedes any earlier (retried) failure
                    this.flushError = null
                } catch (err) {
                    // Never throw from flush() — telemetry must not break tool execution.
                    // The failure is recorded so close() can surface it.
                    const message = err instanceof Error ? err.message : String(err)
                    logger.error(`Write failed: ${message}`, { module: 'Audit' })
                    this.flushError = err instanceof Error ? err : new Error(String(err))
                    // Re-queue the failed lines so they aren't lost
                    this.buffer.unshift(...lines)
                    // Prevent infinite memory leak under permanent IO failure
                    if (this.buffer.length > 5000) {
                        logger.error(
                            `Buffer overflow (${String(this.buffer.length)} entries), dropping oldest entries`,
                            { module: 'Audit' }
                        )
                        const toDrop = this.buffer.length - 5000
                        this.buffer = this.buffer.slice(-5000)
                        this._droppedCount += toDrop
                    }
                }
            })
            .catch((err: unknown) => {
                this.flushError = err instanceof Error ? err : new Error(String(err))
            })

        await this.flushQueue
    }

    /**
     * Gracefully close the logger — flush remaining entries and stop the timer.
     */
    async close(): Promise<void> {
        this.closed = true

        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }

        await this.flush()
        if (this.flushError !== null) {
            const flushError = this.flushError
            this.flushError = null
            throw flushError
        }
    }

    /**
     * Read the most recent audit entries from the log file.
     * Uses a streaming tail-read: only the last TAIL_READ_BYTES (64 KB) are
     * read from disk, preventing O(n) memory spikes for large audit logs.
     * Used by the `memory://audit` resource.
     *
     * @param count Maximum number of entries to return (default 50)
     */
    async recent(count: number = DEFAULT_RECENT_COUNT): Promise<AuditEntry[]> {
        // Stderr mode has no file to read from
        if (this.stderrMode || count <= 0) return []

        // Force flush buffered entries to ensure the read includes up-to-the-millisecond events
        await this.flush()

        try {
            const results: AuditEntry[] = []
            const { skippedLines } = await searchAuditFileBackward(
                this.config.logPath,
                {},
                count,
                results
            )
            if (skippedLines > 0) {
                logger.debug(`Skipped ${String(skippedLines)} unparseable audit log line(s)`, {
                    module: 'Audit',
                    logPath: this.config.logPath,
                })
            }
            return results.reverse()
        } catch (err) {
            throw new Error(
                `Failed to read telemetry log: ${err instanceof Error ? err.message : String(err)}`,
                { cause: err }
            )
        }
    }

    /**
     * Search across the active log and all rotated archives.
     * Reads files backward from newest to oldest up to the configured limit.
     */
    async search(filters: AuditSearchFilters): Promise<AuditEntry[]> {
        if (this.stderrMode) return []

        await this.flush()

        const results: AuditEntry[] = []
        const limit = filters.limit ?? 100
        if (limit <= 0) return []

        const compiledFilters = compileAuditSearchFilters(filters)
        const files = [this.config.logPath]
        for (let i = 1; i <= MAX_ARCHIVES; i++) {
            files.push(`${this.config.logPath}.${String(i)}`)
        }

        const { skippedLines, limitReached } = await files.reduce<
            Promise<{ skippedLines: number; limitReached: boolean }>
        >(
            async (accPromise, file) => {
                const acc = await accPromise
                if (acc.limitReached) return acc
                const res = await searchAuditFileBackward(file, compiledFilters, limit, results)
                return {
                    skippedLines: acc.skippedLines + res.skippedLines,
                    limitReached: res.limitReached,
                }
            },
            Promise.resolve({ skippedLines: 0, limitReached: false })
        )
        if (limitReached) return results

        if (skippedLines > 0) {
            logger.debug(`Skipped ${String(skippedLines)} unparseable audit log line(s) during search`, { module: 'Audit' })
        }

        return results
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Ensure the parent directory of the log file exists.
     */
    private async ensureDirectory(): Promise<void> {
        if (this.dirEnsured) return
        try {
            await mkdir(dirname(this.config.logPath), { recursive: true, mode: 0o700 })
            this.dirEnsured = true
        } catch (err: unknown) {
            if (getErrnoCode(err) === 'EEXIST') {
                this.dirEnsured = true
                return
            }
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`Failed to create audit directory: ${message}`, { module: 'Audit' })
            throw err
        }
    }

    /**
     * Rotate the log file if it exceeds the configured size limit.
     * Keeps up to 5 rotated files (`.1` through `.5`); older data is discarded.
     * Rotation failure is non-fatal — audit must not block tool execution.
     */
    private async rotateIfNeeded(): Promise<void> {
        if (this.stderrMode || !this.config.maxSizeBytes) return
        if (this.approxSizeBytes !== null && this.approxSizeBytes < this.config.maxSizeBytes) {
            return
        }
        const nextSize = await rotateAuditLogFiles(
            this.config.logPath,
            this.config.maxSizeBytes,
            MAX_ARCHIVES
        )
        if (nextSize !== null) {
            this.approxSizeBytes = nextSize
        }
    }
}
