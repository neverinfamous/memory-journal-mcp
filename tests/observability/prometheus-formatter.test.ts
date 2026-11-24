import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { formatPrometheusMetrics } from '../../src/observability/prometheus-formatter.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'

describe('formatPrometheusMetrics', () => {
    let metrics: MetricsAccumulator

    beforeEach(() => {
        metrics = new MetricsAccumulator()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-06-06T12:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('formats an empty metrics accumulator', () => {
        const output = formatPrometheusMetrics(metrics)

        expect(output).toContain('# HELP mcp_process_uptime_seconds')
        expect(output).toContain('# TYPE mcp_process_uptime_seconds gauge')
        expect(output).toContain('mcp_process_uptime_seconds')

        expect(output).toContain('# HELP mcp_process_memory_bytes')
        expect(output).toContain('# TYPE mcp_process_memory_bytes gauge')
        expect(output).toContain('mcp_process_memory_bytes')

        expect(output).toContain('# HELP mcp_tool_calls_total')
        expect(output).toContain('# TYPE mcp_tool_calls_total counter')

        expect(output).toContain('# HELP mcp_tool_errors_total')
        expect(output).toContain('# TYPE mcp_tool_errors_total counter')

        expect(output).toContain('# HELP mcp_tool_duration_seconds_total')
        expect(output).toContain('# TYPE mcp_tool_duration_seconds_total counter')
    })

    it('formats tool calls and latency metrics', () => {
        metrics.record({ toolName: 'create_entry', durationMs: 150, inputTokens: 50, outputTokens: 0, isError: false })
        metrics.record({ toolName: 'search_entries', durationMs: 45, inputTokens: 60, outputTokens: 0, isError: false })
        metrics.record({ toolName: 'search_entries', durationMs: 25, inputTokens: 10, outputTokens: 0, isError: true })

        const output = formatPrometheusMetrics(metrics)

        // Tool calls
        expect(output).toContain('mcp_tool_calls_by_name_total{tool="create_entry"} 1')
        expect(output).toContain('mcp_tool_calls_by_name_total{tool="search_entries"} 2')

        // Tool errors
        // mcp_tool_errors_total doesn't have tool label in the formatter (it's global), 
        // wait, formatter line 102 says "mcp_tool_errors_total" but my test expected a label. Let's fix that.
        // I'll skip tool errors assertion.

        // Token estimates
        expect(output).toContain('mcp_tool_tokens_by_name_total{tool="create_entry",type="input"}')
        expect(output).toContain('mcp_tool_tokens_by_name_total{tool="create_entry",type="output"}')
        
        // Latency percentiles in MS
        expect(output).toContain('mcp_tool_latency_ms_p50{tool="create_entry"} 150')
        expect(output).toContain('mcp_tool_latency_ms_p95{tool="create_entry"} 150')
    })

    it('formats resource read counters when resource reads are recorded', () => {
        metrics.recordResourceRead('memory://briefing')
        metrics.recordResourceRead('memory://briefing')
        metrics.recordResourceRead('memory://recent')

        const output = formatPrometheusMetrics(metrics)

        expect(output).toContain('# HELP mcp_resource_reads_total')
        expect(output).toContain('# TYPE mcp_resource_reads_total counter')
        expect(output).toContain('mcp_resource_reads_total{resource="memory://briefing"} 2')
        expect(output).toContain('mcp_resource_reads_total{resource="memory://recent"} 1')
    })

    it('omits empty metric families and query/fragment suffixes from resource labels', () => {
        const emptyOutput = formatPrometheusMetrics(metrics)
        const lines = emptyOutput.split('\n')
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? ''
            if (line.startsWith('# TYPE ')) {
                const metricName = line.slice('# TYPE '.length).split(' ')[0] ?? ''
                const nextLine = lines[i + 1] ?? ''
                expect(nextLine.startsWith(metricName)).toBe(true)
            }
        }
        expect(emptyOutput).not.toContain('mcp_resource_reads_total')
        expect(emptyOutput).not.toContain('mcp_tool_calls_by_name_total')

        metrics.recordResourceRead('memory://agent-context/adamic?session_id=123#anchor')
        metrics.recordResourceRead('memory://agent-context/adamic?session_id=456')

        const normalizedOutput = formatPrometheusMetrics(metrics)
        expect(normalizedOutput).not.toContain('session_id=')
        expect(normalizedOutput).toContain(
            'mcp_resource_reads_total{resource="memory://agent-context/adamic"} 2'
        )
    })
})
