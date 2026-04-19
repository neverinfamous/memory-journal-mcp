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

import { appendFile, mkdir, open, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AuditConfig, AuditEntry } from './types.js'
import { logger } from '../utils/logger.js'

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

/**
 * Maximum bytes to read from the end of the audit log for `recent()`.
 * 64 KB is enough for ~100+ typical JSONL audit entries (~500 bytes each).
 * Files smaller than this are read in full; larger files only read the tail.
 */
const TAIL_READ_BYTES = 65_536

/** Default number of archives to keep */
const MAX_ARCHIVES = 5

// ============================================================================
// AuditLogger Class
// ============================================================================

export class AuditLogger {
    readonly config: AuditConfig

    private buffer: string[] = []
    private flushTimer: ReturnType<typeof setInterval> | null = null
    private flushQueue: Promise<void> = Promise.resolve()
    private closed = false
    private dirEnsured = false
    private readonly stderrMode: boolean
    
    private _droppedCount = 0

    constructor(config: AuditConfig) {
        this.config = config
        this.stderrMode = config.logPath.toLowerCase() === STDERR_SENTINEL

        if (config.enabled) {
            // Use unref() so the timer doesn't keep the process alive
            this.flushTimer = setInterval(() => {
                void this.flush()
            }, FLUSH_INTERVAL_MS)
            this.flushTimer.unref()
        }
    }

    /**
     * Total number of events dropped due to memory limits or persistent I/O failure.
     */
    get droppedCount(): number {
        return this._droppedCount
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

        this.buffer.push(JSON.stringify(entry))

        // Hard cap to prevent unbounded heap growth if flush loop hangs
        if (this.buffer.length > 5000) {
            this.buffer.shift()
            if (this._droppedCount === 0) {
                logger.warning('Telemetry buffer overflow. Dropping oldest entries. Note: This log is a lossy operational telemetry mechanism.', { module: 'Audit' })
            }
            this._droppedCount++
        }

        // Eagerly flush when the buffer is full
        if (this.buffer.length >= BUFFER_HIGH_WATER) {
            void this.flush()
        }
    }

    /**
     * Log a denied access attempt.
     */
    logDenial(toolName: string, reason: string, context?: {
        user?: string | null
        scopes?: string[]
        category?: AuditEntry['category']
        scope?: string
        requestId?: string
        sessionId?: string
    }): void {
        this.log({
            timestamp: new Date().toISOString(),
            requestId: context?.requestId ?? `denied-${Date.now().toString()}`,
            sessionId: context?.sessionId ?? undefined,
            tool: toolName,
            category: context?.category ?? 'read',
            scope: context?.scope ?? '',
            user: context?.user ?? null,
            scopes: context?.scopes ?? [],
            durationMs: 0,
            success: false,
            error: `Access Denied: ${reason}`
        })
    }

    /**
     * Flush the buffer to disk.
     * Safe to call concurrently — serialises via `this.flushQueue` Promise chain.
     */
    async flush(): Promise<void> {
        if (this.buffer.length === 0) return

        this.flushQueue = this.flushQueue.then(async () => {
            if (this.buffer.length === 0) return

            // Rotate before writing if the log exceeds the configured size
            await this.rotateIfNeeded()

            // Swap the buffer so new entries can accumulate while we write
            const lines = this.buffer
            this.buffer = []

            try {
                if (this.stderrMode) {
                    // Stderr mode: write directly, no buffering to disk
                    process.stderr.write(lines.join('\n') + '\n')
                } else {
                    await this.ensureDirectory()
                    // One appendFile call with all buffered lines — each terminated by \n
                    await appendFile(this.config.logPath, lines.join('\n') + '\n', 'utf-8')
                }
            } catch (err) {
                // Never throw — telemetry must not break tool execution
                const message = err instanceof Error ? err.message : String(err)
                logger.error(`Write failed: ${message}`, { module: 'Audit' })
                // Re-queue the failed lines so they aren't lost
                this.buffer.unshift(...lines)
                // Prevent infinite memory leak under permanent IO failure
                if (this.buffer.length > 5000) {
                    logger.error(`Buffer overflow (${String(this.buffer.length)} entries), dropping oldest entries`, { module: 'Audit' })
                    const toDrop = this.buffer.length - 5000
                    this.buffer = this.buffer.slice(-5000)
                    this._droppedCount += toDrop
                }
            }
        }).catch(() => { /* ignore */ })

        await this.flushQueue
    }

    /**
     * Gracefully close the logger — flush remaining entries and stop the timer.
     */
    async close(): Promise<void> {
        this.closed = true

        if (this.flushTimer) {
            clearInterval(this.flushTimer)
            this.flushTimer = null
        }

        await this.flush()
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
        if (this.stderrMode) return []

        // Force flush buffered entries to ensure the read includes up-to-the-millisecond events
        await this.flush()

        try {
            // Open directly — avoids TOCTOU race between stat() and open()
            let fh: Awaited<ReturnType<typeof open>>
            try {
                fh = await open(this.config.logPath, 'r')
            } catch {
                // File does not exist yet
                return []
            }

            try {
                // stat after open — file is guaranteed to exist since we hold the FD
                const info = await fh.stat()
                const fileSize = info.size
                if (fileSize === 0) return []

                // Read only the tail of the file — avoids loading entire log into memory
                const readSize = Math.min(fileSize, TAIL_READ_BYTES)
                const startOffset = fileSize - readSize

                const buf = Buffer.alloc(readSize)
                await fh.read(buf, 0, readSize, startOffset)
                const chunk = buf.toString('utf-8')

                // Split into lines: if we started mid-file, discard the first
                // (likely partial) line
                const rawLines = chunk.split('\n').filter(Boolean)
                const lines = startOffset > 0 ? rawLines.slice(1) : rawLines
                const tail = lines.slice(-count)

                return tail.reduce<AuditEntry[]>((acc, line) => {
                    try {
                        acc.push(JSON.parse(line) as AuditEntry)
                    } catch {
                        // Gracefully ignore corrupted or partial log entries
                    }
                    return acc
                }, [])
            } finally {
                await fh.close()
            }
        } catch (err) {
            throw new Error(`Failed to read telemetry log: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
        }
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
            await mkdir(dirname(this.config.logPath), { recursive: true })
            this.dirEnsured = true
        } catch {
            // Directory may already exist — that's fine
            this.dirEnsured = true
        }
    }

    /**
     * Rotate the log file if it exceeds the configured size limit.
     * Keeps up to 5 rotated files (`.1` through `.5`); older data is discarded.
     * Rotation failure is non-fatal — audit must not block tool execution.
     */
    private async rotateIfNeeded(): Promise<void> {
        if (this.stderrMode || !this.config.maxSizeBytes) return
        try {
            const info = await stat(this.config.logPath).catch(() => null)
            if (!info || info.size < this.config.maxSizeBytes) return

            // Cascade rename from .4 to .5, .3 to .4, etc. to keep 5 backups
            for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
                const oldFile = `${this.config.logPath}.${String(i)}`
                const newFile = `${this.config.logPath}.${String(i + 1)}`
                await rename(oldFile, newFile).catch(() => null)
            }

            // Rename current directly to .1 to avoid a crash window where data is left in a .tmp file
            const rotatedPath = `${this.config.logPath}.1`
            await rename(this.config.logPath, rotatedPath)
        } catch (err) {
            // Rotation failure must not block logging
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`Rotate failed: ${message}`, { module: 'Audit' })
        }
    }
}
