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
 */

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

export interface MetricsSummary {
    totalCalls: number
    totalErrors: number
    totalDurationMs: number
    totalInputTokens: number
    totalOutputTokens: number
    upSince: string
    toolBreakdown: Record<string, ToolMetrics>
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
    readonly upSince: string = new Date().toISOString()
    private readonly startTime: number = Date.now()

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
    }

    /**
     * Aggregate summary across all recorded tools.
     */
    getSummary(): MetricsSummary {
        let totalCalls = 0
        let totalErrors = 0
        let totalDurationMs = 0
        let totalInputTokens = 0
        let totalOutputTokens = 0

        for (const m of this.toolData.values()) {
            totalCalls += m.callCount
            totalErrors += m.errorCount
            totalDurationMs += m.totalDurationMs
            totalInputTokens += m.totalInputTokens
            totalOutputTokens += m.totalOutputTokens
        }

        return {
            totalCalls,
            totalErrors,
            totalDurationMs,
            totalInputTokens,
            totalOutputTokens,
            upSince: this.upSince,
            toolBreakdown: Object.fromEntries(this.toolData),
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
     * Per-user call counts, sourced from a user tag injected by the interceptor.
     * When no user tracking is configured this returns an empty breakdown.
     */
    getUserBreakdown(): Record<string, number> {
        return Object.fromEntries(this.userCounts)
    }

    private readonly userCounts = new Map<string, number>()

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
        this.userCounts.clear()
    }
}

// ============================================================================
// Singleton
// ============================================================================

/** Global metrics accumulator — shared between interceptor and resource handlers */
export const globalMetrics = new MetricsAccumulator()
