/**
 * Latency Tracker
 *
 * Per-tool sliding-window latency percentile tracker.
 * Uses a zero-dependency sorted-insert algorithm with bounded memory.
 *
 * Design:
 *   - One sorted number[] per tool name for O(1) percentile lookup
 *   - One parallel insertion-order number[] per tool for FIFO eviction
 *   - Binary-search insert: O(log n) per record
 *   - Configurable max samples per tool (default: 1000)
 *   - Nearest-rank percentile method (industry standard)
 */

// ============================================================================
// Types
// ============================================================================

export interface LatencyPercentiles {
    toolName: string
    count: number
    p50Ms: number
    p95Ms: number
    p99Ms: number
    minMs: number
    maxMs: number
}

// ============================================================================
// Internal Helpers
// ============================================================================

interface ToolLatencyData {
    /** Sorted ascending for O(1) percentile lookup */
    sorted: number[]
    /** Insertion order for FIFO eviction when window is exceeded */
    insertionOrder: number[]
}

/**
 * Safely read an element from a number array at a given index.
 * Returns 0 if the index is out of bounds.
 */
function safeAt(arr: number[], idx: number): number {
    return arr[idx] ?? 0
}

/**
 * Binary search for the correct insertion index in a sorted array.
 * Returns the index where `value` should be inserted to maintain sort order.
 */
function binarySearchInsertIndex(sorted: number[], value: number): number {
    let lo = 0
    let hi = sorted.length

    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (safeAt(sorted, mid) < value) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }

    return lo
}

/**
 * Binary search for the index of a specific value in a sorted array.
 * Returns the index if found, -1 otherwise.
 */
function binarySearchExact(sorted: number[], value: number): number {
    let lo = 0
    let hi = sorted.length - 1

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        const midVal = safeAt(sorted, mid)
        if (midVal === value) return mid
        if (midVal < value) {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }

    return -1
}

// ============================================================================
// Tracker
// ============================================================================

export class LatencyTracker {
    private readonly data = new Map<string, ToolLatencyData>()
    private readonly maxSamplesPerTool: number

    constructor(maxSamplesPerTool = 1000) {
        this.maxSamplesPerTool = maxSamplesPerTool
    }

    /**
     * Record a latency sample for a tool.
     */
    record(toolName: string, durationMs: number): void {
        let entry = this.data.get(toolName)
        if (!entry) {
            entry = { sorted: [], insertionOrder: [] }
            this.data.set(toolName, entry)
        }

        // Evict oldest sample if window exceeded
        if (entry.sorted.length >= this.maxSamplesPerTool) {
            const oldest = entry.insertionOrder.shift()
            if (oldest !== undefined) {
                const removeIdx = binarySearchExact(entry.sorted, oldest)
                if (removeIdx !== -1) {
                    entry.sorted.splice(removeIdx, 1)
                }
            }
        }

        // Binary-search insert into sorted array
        const insertIdx = binarySearchInsertIndex(entry.sorted, durationMs)
        entry.sorted.splice(insertIdx, 0, durationMs)

        // Track insertion order for FIFO eviction
        entry.insertionOrder.push(durationMs)
    }

    /**
     * Compute the p-th percentile for a tool using nearest-rank method.
     * @param toolName - Tool to query
     * @param p - Percentile as a fraction (0.50, 0.95, 0.99)
     * @returns The percentile value, or 0 if no data
     */
    getPercentile(toolName: string, p: number): number {
        const entry = this.data.get(toolName)
        if (!entry || entry.sorted.length === 0) return 0

        const n = entry.sorted.length
        const rank = Math.ceil(p * n) - 1
        const clampedRank = Math.max(0, Math.min(rank, n - 1))
        return safeAt(entry.sorted, clampedRank)
    }

    /**
     * Get latency summary for all tracked tools, sorted by p99 descending.
     */
    getLatencySummary(): LatencyPercentiles[] {
        const results: LatencyPercentiles[] = []

        for (const [toolName, entry] of this.data) {
            if (entry.sorted.length === 0) continue

            const n = entry.sorted.length
            results.push({
                toolName,
                count: n,
                p50Ms: safeAt(entry.sorted, Math.max(0, Math.ceil(0.50 * n) - 1)),
                p95Ms: safeAt(entry.sorted, Math.max(0, Math.ceil(0.95 * n) - 1)),
                p99Ms: safeAt(entry.sorted, Math.max(0, Math.ceil(0.99 * n) - 1)),
                minMs: safeAt(entry.sorted, 0),
                maxMs: safeAt(entry.sorted, n - 1),
            })
        }

        return results.sort((a, b) => b.p99Ms - a.p99Ms)
    }

    /**
     * Reset all tracked data (primarily for tests).
     */
    reset(): void {
        this.data.clear()
    }
}
