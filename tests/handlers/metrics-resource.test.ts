import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    metricsSummaryResource,
    metricsTokensResource,
    metricsSystemResource,
    metricsUsersResource,
    getMetricsResourceDefinitions,
} from '../../src/handlers/resources/core/metrics-resource.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'

describe('Metrics Resources', () => {
    let metrics: MetricsAccumulator

    beforeEach(() => {
        metrics = new MetricsAccumulator()
    })

    afterEach(() => {
        // Nothing to reset, instance is recreated
    })

    it('getMetricsResourceDefinitions returns all four definitions', () => {
        const defs = getMetricsResourceDefinitions()
        expect(defs.length).toBe(4)
        expect(defs.map((d) => d.name)).toEqual([
            'Metrics Summary',
            'Metrics Tokens',
            'Metrics System',
            'Metrics Users',
        ])
    })

    describe('metricsSummaryResource', () => {
        it('returns zero summary when no calls recorded', async () => {
            const res = (await metricsSummaryResource.handler('memory://metrics/summary', {
                runtime: { metrics },
            } as any)) as any
            expect(res.data).toContain('total_calls: 0')
            expect(res.data).toContain('error_rate_pct: 0.0')
            expect(res.data).toContain('avg_duration_ms: 0')
        })

        it('returns calculated summary when calls exist', async () => {
            metrics.record({
                toolName: 'test_tool',
                isError: false,
                durationMs: 100,
                inputTokens: 10,
                outputTokens: 20,
            })
            metrics.record({
                toolName: 'test_tool',
                isError: true,
                durationMs: 150,
                inputTokens: 10,
                outputTokens: 20,
            }) // error

            const res = (await metricsSummaryResource.handler('memory://metrics/summary', {
                runtime: { metrics },
            } as any)) as any

            expect(res.data).toContain('total_calls: 2')
            expect(res.data).toContain('total_errors: 1')
            expect(res.data).toContain('error_rate_pct: 50.0')
            expect(res.data).toContain('total_duration_ms: 250')
            expect(res.data).toContain('avg_duration_ms: 125')
            expect(res.data).toContain('total_input_tokens: 20')
            expect(res.data).toContain('total_output_tokens: 40')
            expect(res.data).toContain('tools_called: 1')
        })
    })

    describe('metricsTokensResource', () => {
        it('returns warning when no tool calls recorded', async () => {
            const res = (await metricsTokensResource.handler('memory://metrics/tokens', {
                runtime: { metrics },
            } as any)) as any
            expect(res.data).toContain('No tool calls recorded yet')
        })

        it('returns token breakdown list sorted by usage', async () => {
            metrics.record({
                toolName: 'tool_a',
                isError: false,
                durationMs: 100,
                inputTokens: 10,
                outputTokens: 50,
            })
            metrics.record({
                toolName: 'tool_b',
                isError: false,
                durationMs: 100,
                inputTokens: 10,
                outputTokens: 100,
            })

            const res = (await metricsTokensResource.handler('memory://metrics/tokens', {
                runtime: { metrics },
            } as any)) as any

            expect(res.data).toContain('tool: tool_b')
            expect(res.data).toContain('tool: tool_a')
            expect(res.data).toContain('output_tokens: 100') // B has 100
        })
    })

    describe('metricsSystemResource', () => {
        it('returns process and environment system metrics', async () => {
            const res = (await metricsSystemResource.handler('memory://metrics/system', {
                runtime: { metrics },
            } as any)) as any
            expect(res.data).toContain('process_memory_mb:')
            expect(res.data).toContain('node_version:')
            expect(res.data).toContain('uptime_seconds:')
        })
    })

    describe('metricsUsersResource', () => {
        it('returns hint when no users recorded', async () => {
            const res = (await metricsUsersResource.handler('memory://metrics/users', {
                runtime: { metrics },
            } as any)) as any
            expect(res.data).toContain('No user tracking data available')
        })

        it('returns user breakdown when users recorded', async () => {
            metrics.record({
                toolName: 'tool_a',
                isError: false,
                durationMs: 100,
                inputTokens: 10,
                outputTokens: 10,
            })
            metrics.recordUser('alice')
            metrics.record({
                toolName: 'tool_a',
                isError: false,
                durationMs: 100,
                inputTokens: 10,
                outputTokens: 10,
            })
            metrics.recordUser('alice')
            metrics.record({
                toolName: 'tool_b',
                isError: false,
                durationMs: 100,
                inputTokens: 10,
                outputTokens: 10,
            })
            metrics.recordUser('bob')

            const res = (await metricsUsersResource.handler('memory://metrics/users', {
                runtime: { metrics },
            } as any)) as any

            expect(res.data).toContain('user: alice')
            expect(res.data).toContain('calls: 2')
            expect(res.data).toContain('user: bob')
            expect(res.data).toContain('calls: 1')
        })
    })
})
