/**
 * Tests for src/observability/interceptor.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MetricsAccumulator } from '../../src/observability/metrics.js'
import { wrapWithMetrics } from '../../src/observability/interceptor.js'

describe('wrapWithMetrics', () => {
    let acc: MetricsAccumulator

    beforeEach(() => {
        acc = new MetricsAccumulator()
    })

    it('passes through the original handler result unchanged', async () => {
        const handler = async (_args: Record<string, unknown>) => ({ success: true, data: 'hello' })
        const wrapped = wrapWithMetrics('test_tool', handler, acc)
        const result = await wrapped({})
        expect(result).toEqual({ success: true, data: 'hello' })
    })

    it('records a call to the accumulator on success', async () => {
        const handler = async (_args: Record<string, unknown>) => ({ success: true })
        const wrapped = wrapWithMetrics('my_tool', handler, acc)
        await wrapped({ content: 'hello' })

        const summary = acc.getSummary()
        expect(summary.totalCalls).toBe(1)
        expect(summary.toolBreakdown['my_tool']).toBeDefined()
    })

    it('captures timing (durationMs >= 0)', async () => {
        const handler = async (_args: Record<string, unknown>) => ({ success: true })
        const wrapped = wrapWithMetrics('my_tool', handler, acc)
        await wrapped({})

        const breakdown = acc.getSummary().toolBreakdown['my_tool']
        expect(breakdown?.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    it('records non-zero input tokens when args are non-empty', async () => {
        const handler = async (_args: Record<string, unknown>) => ({ success: true })
        const wrapped = wrapWithMetrics('my_tool', handler, acc)
        await wrapped({ content: 'a'.repeat(100) })

        const breakdown = acc.getSummary().toolBreakdown['my_tool']
        expect(breakdown?.totalInputTokens).toBeGreaterThan(0)
    })

    it('records non-zero output tokens for non-empty results', async () => {
        const handler = async (_args: Record<string, unknown>) => ({
            success: true,
            data: 'a'.repeat(200),
        })
        const wrapped = wrapWithMetrics('my_tool', handler, acc)
        await wrapped({})

        const breakdown = acc.getSummary().toolBreakdown['my_tool']
        expect(breakdown?.totalOutputTokens).toBeGreaterThan(0)
    })

    it('counts {success: false} result as an error', async () => {
        const handler = async (_args: Record<string, unknown>) => ({
            success: false,
            error: 'Something went wrong',
        })
        const wrapped = wrapWithMetrics('my_tool', handler, acc)
        await wrapped({})

        const summary = acc.getSummary()
        expect(summary.totalErrors).toBe(1)
        expect(summary.toolBreakdown['my_tool']?.errorCount).toBe(1)
    })

    it('re-throws exceptions and records them as errors', async () => {
        const handler = async (_args: Record<string, unknown>): Promise<unknown> => {
            throw new Error('boom')
        }
        const wrapped = wrapWithMetrics('my_tool', handler, acc)

        await expect(wrapped({})).rejects.toThrow('boom')

        const summary = acc.getSummary()
        expect(summary.totalErrors).toBe(1)
        expect(summary.toolBreakdown['my_tool']?.callCount).toBe(1)
    })

    it('handles multiple successive calls and accumulates metrics', async () => {
        const handler = async (_args: Record<string, unknown>) => ({ success: true })
        const wrapped = wrapWithMetrics('my_tool', handler, acc)
        await wrapped({})
        await wrapped({})
        await wrapped({})

        const breakdown = acc.getSummary().toolBreakdown['my_tool']
        expect(breakdown?.callCount).toBe(3)
    })

    it('does not crash when accumulator throws internally', async () => {
        // Corrupt the accumulator's record method to simulate an internal failure
        const faultyAcc = new MetricsAccumulator()
        faultyAcc.record = () => {
            throw new Error('accumulator internal error')
        }

        const handler = async (_args: Record<string, unknown>) => ({ success: true })
        const wrapped = wrapWithMetrics('my_tool', handler, faultyAcc)

        // Should not throw — interceptor swallows accumulator errors
        const result = await wrapped({})
        expect(result).toEqual({ success: true })
    })
})
