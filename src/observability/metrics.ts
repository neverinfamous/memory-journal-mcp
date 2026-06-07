/**
 * Metrics Accumulator
 *
 * In-memory, Map-based accumulator for tool call telemetry.
 * No external dependencies. Exposes a singleton `globalMetrics` instance
 * that the interceptor and resource handlers share.
 *
 * Per-tool data collected:
 *   - callCount      — total invocations
 *   - errorCount     — invocations that returned {success: false} or threw
 *   - totalDurationMs — sum of wall-clock durations
 *   - totalInputTokens — sum of estimated input token counts
 *   - totalOutputTokens — sum of estimated output token counts
 *   - lastCalledAt   — ISO timestamp of most recent call
 *   - latency percentiles (p50/p95/p99) via LatencyTracker
 */

import { promises as fs } from 'node:fs'
import { LatencyTracker } from './latency-tracker.js'
import type { LatencyPercentiles } from './latency-tracker.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface ToolMetrics {
    callCount: number
    errorCount: number
    totalDurationMs: number
    totalInputTokens: number
    totalOutputTokens: number
    lastCalledAt: string | null
}

export interface ResourceMetrics {
    readCount: number
    errorCount: number
    lastReadAt: string | null
}

export interface MetricsSummary {
    totalCalls: number
    totalErrors: number
    totalDurationMs: number
    totalInputTokens: number
    totalOutputTokens: number
    totalResourceReads: number
    upSince: string
    toolBreakdown: Record<string, ToolMetrics>
    resourceBreakdown: Record<string, ResourceMetrics>
}

export interface SystemMetrics {
    upSince: string
    uptimeSeconds: number
    processMemoryMb: number
    nodeVersion: string
    platform: string
}

// ============================================================================
// Accumulator
// ============================================================================

export class MetricsAccumulator {
    private readonly toolData = new Map<string, ToolMetrics>()
    private readonly resourceData = new Map<string, ResourceMetrics>()
    private readonly deprecationWarnings = new Set<string>()
    private readonly latencyTracker: LatencyTracker
    readonly upSince: string = new Date().toISOString()
    private readonly startTime: number = Date.now()

    constructor(maxLatencySamplesPerTool = 1000) {
        this.latencyTracker = new LatencyTracker(maxLatencySamplesPerTool)
    }

    /**
     * Record a deprecation warning to be surfaced in the briefing.
     */
    recordDeprecationWarning(warning: string): void {
        this.deprecationWarnings.add(warning)
    }

    /**
     * Retrieve active deprecation warnings.
     */
    getDeprecationWarnings(): string[] {
        return Array.from(this.deprecationWarnings)
    }

    /**
     * Record a single tool invocation result.
     */
    record(opts: {
        toolName: string
        durationMs: number
        inputTokens: number
        outputTokens: number
        isError: boolean
    }): void {
        const existing = this.toolData.get(opts.toolName)
        const m: ToolMetrics = existing ?? {
            callCount: 0,
            errorCount: 0,
            totalDurationMs: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            lastCalledAt: null,
        }

        m.callCount++
        m.totalDurationMs += opts.durationMs
        m.totalInputTokens += opts.inputTokens
        m.totalOutputTokens += opts.outputTokens
        if (opts.isError) m.errorCount++
        m.lastCalledAt = new Date().toISOString()

        this.toolData.set(opts.toolName, m)

        // Feed latency tracker for percentile computation
        this.latencyTracker.record(opts.toolName, opts.durationMs)
    }

    /**
     * Record a single resource read.
     */
    recordResourceRead(uri: string, isError = false): void {
        const existing = this.resourceData.get(uri)
        const m: ResourceMetrics = existing ?? {
            readCount: 0,
            errorCount: 0,
            lastReadAt: null,
        }

        m.readCount++
        if (isError) m.errorCount++
        m.lastReadAt = new Date().toISOString()

        this.resourceData.set(uri, m)
    }

    /**
     * Aggregate summary across all recorded tools and resources.
     */
    getSummary(): MetricsSummary {
        let totalCalls = 0
        let totalErrors = 0
        let totalDurationMs = 0
        let totalInputTokens = 0
        let totalOutputTokens = 0
        let totalResourceReads = 0

        for (const m of this.toolData.values()) {
            totalCalls += m.callCount
            totalErrors += m.errorCount
            totalDurationMs += m.totalDurationMs
            totalInputTokens += m.totalInputTokens
            totalOutputTokens += m.totalOutputTokens
        }

        for (const m of this.resourceData.values()) {
            totalResourceReads += m.readCount
        }

        return {
            totalCalls,
            totalErrors,
            totalDurationMs,
            totalInputTokens,
            totalOutputTokens,
            totalResourceReads,
            upSince: this.upSince,
            toolBreakdown: Object.fromEntries(this.toolData),
            resourceBreakdown: Object.fromEntries(this.resourceData),
        }
    }

    /**
     * Per-tool token usage breakdown, sorted by total output tokens desc.
     */
    getTokenBreakdown(): {
        toolName: string
        inputTokens: number
        outputTokens: number
        callCount: number
        avgOutputTokens: number
    }[] {
        return Array.from(this.toolData.entries())
            .map(([toolName, m]) => ({
                toolName,
                inputTokens: m.totalInputTokens,
                outputTokens: m.totalOutputTokens,
                callCount: m.callCount,
                avgOutputTokens:
                    m.callCount > 0 ? Math.round(m.totalOutputTokens / m.callCount) : 0,
            }))
            .sort((a, b) => b.outputTokens - a.outputTokens)
    }

    /**
     * Per-resource read frequency breakdown, sorted by total reads desc.
     */
    getResourceBreakdown(): {
        uri: string
        readCount: number
        errorCount: number
        lastReadAt: string | null
    }[] {
        return Array.from(this.resourceData.entries())
            .map(([uri, m]) => ({
                uri,
                readCount: m.readCount,
                errorCount: m.errorCount,
                lastReadAt: m.lastReadAt,
            }))
            .sort((a, b) => b.readCount - a.readCount)
    }

    /**
     * Per-user call counts, sourced from a user tag injected by the interceptor.
     * When no user tracking is configured this returns an empty breakdown.
     */
    getUserBreakdown(): Record<string, number> {
        return Object.fromEntries(this.userCounts)
    }

    private readonly userCounts = new Map<string, number>()

    /**
     * Per-tool latency percentile summary, sorted by p99 descending.
     */
    getLatencySummary(): LatencyPercentiles[] {
        return this.latencyTracker.getLatencySummary()
    }

    recordUser(user: string): void {
        if (this.userCounts.size >= 10000 && !this.userCounts.has(user)) {
            const bucket = 'other'
            this.userCounts.set(bucket, (this.userCounts.get(bucket) ?? 0) + 1)
            return
        }
        this.userCounts.set(user, (this.userCounts.get(user) ?? 0) + 1)
    }

    /**
     * System-level metrics snapshot.
     */
    getSystemMetrics(): SystemMetrics {
        const mem = process.memoryUsage()
        return {
            upSince: this.upSince,
            uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
            processMemoryMb: Math.round(mem.rss / (1024 * 1024)),
            nodeVersion: process.version,
            platform: process.platform,
        }
    }

    /**
     * Reset all accumulated data (primarily useful in tests).
     */
    reset(): void {
        this.toolData.clear()
        this.resourceData.clear()
        this.userCounts.clear()
        this.deprecationWarnings.clear()
        this.latencyTracker.reset()
    }

    /**
     * Export the current metrics state as a JSON string.
     */
    exportState(): string {
        return JSON.stringify({
            toolData: Array.from(this.toolData.entries()),
            resourceData: Array.from(this.resourceData.entries()),
            userCounts: Array.from(this.userCounts.entries()),
            upSince: this.upSince,
        })
    }

    /**
     * Import metrics state from a JSON string, merging with current state.
     */
    importState(jsonState: string): void {
        try {
            const parsed = JSON.parse(jsonState) as {
                toolData?: [string, ToolMetrics][]
                resourceData?: [string, ResourceMetrics][]
                userCounts?: [string, number][]
            }
            if (parsed.toolData) {
                for (const [key, val] of parsed.toolData) {
                    const existing = this.toolData.get(key)
                    if (existing) {
                        existing.callCount += val.callCount
                        existing.errorCount += val.errorCount
                        existing.totalDurationMs += val.totalDurationMs
                        existing.totalInputTokens += val.totalInputTokens
                        existing.totalOutputTokens += val.totalOutputTokens
                        // Keep the most recent timestamp
                        if (val.lastCalledAt) {
                            if (!existing.lastCalledAt || new Date(val.lastCalledAt) > new Date(existing.lastCalledAt)) {
                                existing.lastCalledAt = val.lastCalledAt
                            }
                        }
                    } else {
                        this.toolData.set(key, val)
                    }
                }
            }
            if (parsed.resourceData) {
                for (const [key, val] of parsed.resourceData) {
                    const existing = this.resourceData.get(key)
                    if (existing) {
                        existing.readCount += val.readCount
                        existing.errorCount += val.errorCount
                        if (val.lastReadAt) {
                            if (!existing.lastReadAt || new Date(val.lastReadAt) > new Date(existing.lastReadAt)) {
                                existing.lastReadAt = val.lastReadAt
                            }
                        }
                    } else {
                        this.resourceData.set(key, val)
                    }
                }
            }
            if (parsed.userCounts) {
                for (const [key, val] of parsed.userCounts) {
                    this.userCounts.set(key, (this.userCounts.get(key) ?? 0) + val)
                }
            }
        } catch (error) {
            logger.error('Failed to import metrics state', { module: 'Metrics', error: String(error) })
        }
    }

    /**
     * Save metrics to a file asynchronously.
     */
    async saveToFile(path: string): Promise<void> {
        try {
            const state = this.exportState()
            await fs.writeFile(path, state, 'utf8')
            logger.debug('Metrics saved to disk', { module: 'Metrics', path })
        } catch (error) {
            logger.error('Failed to save metrics to disk', { module: 'Metrics', error: String(error), path })
        }
    }

    /**
     * Load metrics from a file asynchronously.
     */
    async loadFromFile(path: string): Promise<void> {
        try {
            const data = await fs.readFile(path, 'utf8')
            this.importState(data)
            logger.info('Metrics loaded from disk', { module: 'Metrics', path })
        } catch (error: unknown) {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code !== 'ENOENT'
            ) {
                logger.error('Failed to load metrics from disk', { 
                    module: 'Metrics', 
                    error: error instanceof Error ? error.message : JSON.stringify(error), 
                    path 
                })
            }
        }
    }
}

// ============================================================================
// Singleton
// ============================================================================

// REMOVED: globalMetrics singleton. Use ServerRuntime.metrics instead.
