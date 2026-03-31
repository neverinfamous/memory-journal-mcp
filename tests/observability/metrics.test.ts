/**
 * Tests for src/observability/metrics.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MetricsAccumulator } from '../../src/observability/metrics.js'

describe('MetricsAccumulator', () => {
    let acc: MetricsAccumulator

    beforeEach(() => {
        acc = new MetricsAccumulator()
    })

    describe('record()', () => {
        it('initializes a new tool entry on first record', () => {
            acc.record({
                toolName: 'create_entry',
                durationMs: 42,
                inputTokens: 10,
                outputTokens: 20,
                isError: false,
            })

            const summary = acc.getSummary()
            expect(summary.totalCalls).toBe(1)
            expect(summary.totalErrors).toBe(0)
            expect(summary.totalDurationMs).toBe(42)
            expect(summary.totalInputTokens).toBe(10)
            expect(summary.totalOutputTokens).toBe(20)
        })

        it('accumulates across multiple calls for the same tool', () => {
            acc.record({ toolName: 'search', durationMs: 10, inputTokens: 5, outputTokens: 50, isError: false })
            acc.record({ toolName: 'search', durationMs: 20, inputTokens: 5, outputTokens: 60, isError: false })

            const summary = acc.getSummary()
            expect(summary.totalCalls).toBe(2)
            expect(summary.totalDurationMs).toBe(30)
            expect(summary.totalOutputTokens).toBe(110)
            expect(summary.toolBreakdown['search']?.callCount).toBe(2)
        })

        it('accumulates across multiple different tools', () => {
            acc.record({ toolName: 'create_entry', durationMs: 10, inputTokens: 5, outputTokens: 10, isError: false })
            acc.record({ toolName: 'get_entry', durationMs: 15, inputTokens: 3, outputTokens: 30, isError: false })

            const summary = acc.getSummary()
            expect(summary.totalCalls).toBe(2)
            expect(Object.keys(summary.toolBreakdown)).toHaveLength(2)
        })

        it('increments errorCount on isError: true', () => {
            acc.record({ toolName: 'create_entry', durationMs: 5, inputTokens: 2, outputTokens: 0, isError: true })

            const summary = acc.getSummary()
            expect(summary.totalErrors).toBe(1)
            expect(summary.toolBreakdown['create_entry']?.errorCount).toBe(1)
        })

        it('sets lastCalledAt timestamp on record', () => {
            const before = new Date().toISOString()
            acc.record({ toolName: 'create_entry', durationMs: 1, inputTokens: 1, outputTokens: 1, isError: false })
            const after = new Date().toISOString()

            const breakdown = acc.getSummary().toolBreakdown['create_entry']
            expect(breakdown?.lastCalledAt).toBeDefined()
            expect(breakdown!.lastCalledAt! >= before).toBe(true)
            expect(breakdown!.lastCalledAt! <= after).toBe(true)
        })
    })

    describe('getSummary()', () => {
        it('returns zero totals when no calls recorded', () => {
            const s = acc.getSummary()
            expect(s.totalCalls).toBe(0)
            expect(s.totalErrors).toBe(0)
            expect(s.totalDurationMs).toBe(0)
            expect(s.totalInputTokens).toBe(0)
            expect(s.totalOutputTokens).toBe(0)
            expect(s.toolBreakdown).toEqual({})
        })

        it('includes upSince timestamp', () => {
            const s = acc.getSummary()
            expect(typeof s.upSince).toBe('string')
            expect(s.upSince.length).toBeGreaterThan(0)
        })
    })

    describe('getTokenBreakdown()', () => {
        it('returns empty array when no calls recorded', () => {
            expect(acc.getTokenBreakdown()).toEqual([])
        })

        it('sorts by totalOutputTokens descending', () => {
            acc.record({ toolName: 'cheap', durationMs: 1, inputTokens: 1, outputTokens: 10, isError: false })
            acc.record({ toolName: 'expensive', durationMs: 1, inputTokens: 1, outputTokens: 500, isError: false })

            const breakdown = acc.getTokenBreakdown()
            expect(breakdown[0]?.toolName).toBe('expensive')
            expect(breakdown[1]?.toolName).toBe('cheap')
        })

        it('computes avgOutputTokens correctly', () => {
            acc.record({ toolName: 'tool', durationMs: 1, inputTokens: 0, outputTokens: 100, isError: false })
            acc.record({ toolName: 'tool', durationMs: 1, inputTokens: 0, outputTokens: 200, isError: false })

            const breakdown = acc.getTokenBreakdown()
            expect(breakdown[0]?.avgOutputTokens).toBe(150)
        })
    })

    describe('getUserBreakdown()', () => {
        it('returns empty object when no users recorded', () => {
            expect(acc.getUserBreakdown()).toEqual({})
        })

        it('increments count for same user', () => {
            acc.recordUser('alice')
            acc.recordUser('alice')
            acc.recordUser('bob')

            const users = acc.getUserBreakdown()
            expect(users['alice']).toBe(2)
            expect(users['bob']).toBe(1)
        })
    })

    describe('getSystemMetrics()', () => {
        it('returns required system fields', () => {
            const sys = acc.getSystemMetrics()
            expect(typeof sys.uptimeSeconds).toBe('number')
            expect(sys.uptimeSeconds).toBeGreaterThanOrEqual(0)
            expect(typeof sys.processMemoryMb).toBe('number')
            expect(typeof sys.nodeVersion).toBe('string')
            expect(sys.nodeVersion.startsWith('v')).toBe(true)
            expect(typeof sys.platform).toBe('string')
        })
    })

    describe('reset()', () => {
        it('clears all accumulated data', () => {
            acc.record({ toolName: 'create_entry', durationMs: 1, inputTokens: 1, outputTokens: 1, isError: false })
            acc.recordUser('alice')

            acc.reset()

            const s = acc.getSummary()
            expect(s.totalCalls).toBe(0)
            expect(acc.getUserBreakdown()).toEqual({})
        })
    })
})
