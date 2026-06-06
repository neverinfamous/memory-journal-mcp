/**
 * Tests for src/observability/latency-tracker.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LatencyTracker } from '../../src/observability/latency-tracker.js'

describe('LatencyTracker', () => {
    let tracker: LatencyTracker

    beforeEach(() => {
        tracker = new LatencyTracker()
    })

    describe('record()', () => {
        it('maintains sorted order after random insertions', () => {
            const values = [42, 7, 99, 1, 55, 23, 88, 3, 67, 15]
            for (const v of values) {
                tracker.record('tool_a', v)
            }

            const summary = tracker.getLatencySummary()
            expect(summary).toHaveLength(1)
            expect(summary[0]?.count).toBe(10)
            expect(summary[0]?.minMs).toBe(1)
            expect(summary[0]?.maxMs).toBe(99)
        })

        it('tracks multiple tools independently', () => {
            tracker.record('fast_tool', 5)
            tracker.record('fast_tool', 10)
            tracker.record('slow_tool', 500)
            tracker.record('slow_tool', 1000)

            const summary = tracker.getLatencySummary()
            expect(summary).toHaveLength(2)

            const fast = summary.find((s) => s.toolName === 'fast_tool')
            const slow = summary.find((s) => s.toolName === 'slow_tool')

            expect(fast?.count).toBe(2)
            expect(fast?.maxMs).toBe(10)
            expect(slow?.count).toBe(2)
            expect(slow?.maxMs).toBe(1000)
        })
    })

    describe('getPercentile()', () => {
        it('returns correct percentiles for uniform 1..100 distribution', () => {
            for (let i = 1; i <= 100; i++) {
                tracker.record('uniform', i)
            }

            expect(tracker.getPercentile('uniform', 0.50)).toBe(50)
            expect(tracker.getPercentile('uniform', 0.95)).toBe(95)
            expect(tracker.getPercentile('uniform', 0.99)).toBe(99)
        })

        it('returns the same value for all percentiles when all values are equal', () => {
            for (let i = 0; i < 50; i++) {
                tracker.record('constant', 42)
            }

            expect(tracker.getPercentile('constant', 0.50)).toBe(42)
            expect(tracker.getPercentile('constant', 0.95)).toBe(42)
            expect(tracker.getPercentile('constant', 0.99)).toBe(42)
        })

        it('returns the single value for all percentiles when only one sample', () => {
            tracker.record('single', 77)

            expect(tracker.getPercentile('single', 0.50)).toBe(77)
            expect(tracker.getPercentile('single', 0.95)).toBe(77)
            expect(tracker.getPercentile('single', 0.99)).toBe(77)
        })

        it('returns correct percentiles for two samples', () => {
            tracker.record('pair', 10)
            tracker.record('pair', 90)

            expect(tracker.getPercentile('pair', 0.50)).toBe(10)
            expect(tracker.getPercentile('pair', 0.95)).toBe(90)
            expect(tracker.getPercentile('pair', 0.99)).toBe(90)
        })

        it('returns 0 for unknown tool', () => {
            expect(tracker.getPercentile('nonexistent', 0.50)).toBe(0)
        })
    })

    describe('sliding window eviction', () => {
        it('evicts oldest samples when max window is exceeded', () => {
            const smallTracker = new LatencyTracker(10)

            // Insert 15 values: 1, 2, ..., 15
            for (let i = 1; i <= 15; i++) {
                smallTracker.record('tool', i)
            }

            const summary = smallTracker.getLatencySummary()
            expect(summary[0]?.count).toBe(10)

            // Oldest 5 (1-5) should be evicted; remaining: 6-15
            expect(summary[0]?.minMs).toBe(6)
            expect(summary[0]?.maxMs).toBe(15)
        })

        it('maintains correct percentiles after eviction', () => {
            const smallTracker = new LatencyTracker(100)

            // Insert 150 values: 1..150
            for (let i = 1; i <= 150; i++) {
                smallTracker.record('tool', i)
            }

            // After eviction: values 51..150 remain (100 values)
            const summary = smallTracker.getLatencySummary()
            expect(summary[0]?.count).toBe(100)
            expect(summary[0]?.minMs).toBe(51)
            expect(summary[0]?.maxMs).toBe(150)

            // p50 of 51..150 = 100 (ceil(0.50 * 100) = 50th element = 100)
            expect(smallTracker.getPercentile('tool', 0.50)).toBe(100)
        })
    })

    describe('getLatencySummary()', () => {
        it('returns empty array when no data recorded', () => {
            expect(tracker.getLatencySummary()).toEqual([])
        })

        it('sorts results by p99 descending', () => {
            // fast tool: all low latency
            for (let i = 1; i <= 10; i++) {
                tracker.record('fast', i)
            }
            // slow tool: all high latency
            for (let i = 100; i <= 110; i++) {
                tracker.record('slow', i)
            }

            const summary = tracker.getLatencySummary()
            expect(summary[0]?.toolName).toBe('slow')
            expect(summary[1]?.toolName).toBe('fast')
        })

        it('includes correct min/max/count fields', () => {
            tracker.record('tool', 5)
            tracker.record('tool', 50)
            tracker.record('tool', 500)

            const summary = tracker.getLatencySummary()
            expect(summary[0]?.minMs).toBe(5)
            expect(summary[0]?.maxMs).toBe(500)
            expect(summary[0]?.count).toBe(3)
        })
    })

    describe('reset()', () => {
        it('clears all tracked data', () => {
            tracker.record('tool_a', 10)
            tracker.record('tool_b', 20)

            tracker.reset()

            expect(tracker.getLatencySummary()).toEqual([])
            expect(tracker.getPercentile('tool_a', 0.50)).toBe(0)
        })
    })
})
