/**
 * Prometheus Metrics Formatter
 *
 * Formats MetricsAccumulator telemetry data into Prometheus exposition format (text/plain).
 * Complies with Prometheus 0.0.4 text format specification.
 * Zero external dependencies.
 */

import type { MetricsAccumulator } from './metrics.js'

/**
 * Escapes characters for Prometheus label values: \, ", and \n.
 */
function escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

/**
 * Converts a string to a valid Prometheus label name.
 * Prometheus label names may contain ASCII letters, numbers, and underscores.
 * Any other character is replaced with an underscore.
 */
function sanitizeLabelName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * Formats a single metric line.
 */
function formatMetric(name: string, value: number, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
        return `${name} ${value}`
    }

    const labelPairs = Object.entries(labels)
        .map(([k, v]) => `${sanitizeLabelName(k)}="${escapeLabelValue(v)}"`)
        .join(',')

    return `${name}{${labelPairs}} ${value}`
}

/**
 * Formats a metric block including HELP and TYPE headers.
 */
function formatMetricBlock(
    name: string,
    help: string,
    type: 'counter' | 'gauge' | 'summary',
    metrics: { value: number; labels?: Record<string, string> }[]
): string {
    if (metrics.length === 0) return ''

    let block = `# HELP ${name} ${help}\n`
    block += `# TYPE ${name} ${type}\n`
    
    for (const m of metrics) {
        block += formatMetric(name, m.value, m.labels) + '\n'
    }
    
    return block
}

/**
 * Transforms all MetricsAccumulator state into Prometheus exposition format.
 * Returns a complete text/plain payload ready for HTTP transmission.
 */
export function formatPrometheusMetrics(metrics: MetricsAccumulator): string {
    const summary = metrics.getSummary()
    const system = metrics.getSystemMetrics()
    const tokenBreakdown = metrics.getTokenBreakdown()
    const latencySummary = metrics.getLatencySummary()
    const userBreakdown = metrics.getUserBreakdown()

    const blocks: string[] = []

    // 1. Server Info (Gauge = 1 with labels)
    blocks.push(
        formatMetricBlock(
            'mcp_server_info',
            'Constant 1 with labels providing identifying information about the server',
            'gauge',
            [
                {
                    value: 1,
                    labels: {
                        version: system.nodeVersion,
                        platform: system.platform,
                    },
                },
            ]
        )
    )

    // 2. Global Totals
    blocks.push(
        formatMetricBlock('mcp_tool_calls_total', 'Total number of tool invocations', 'counter', [
            { value: summary.totalCalls },
        ])
    )
    blocks.push(
        formatMetricBlock(
            'mcp_tool_errors_total',
            'Total number of tool invocations resulting in an error',
            'counter',
            [{ value: summary.totalErrors }]
        )
    )
    blocks.push(
        formatMetricBlock(
            'mcp_tool_duration_seconds_total',
            'Total duration of all tool invocations in seconds',
            'counter',
            [{ value: summary.totalDurationMs / 1000 }]
        )
    )
    blocks.push(
        formatMetricBlock(
            'mcp_tool_input_tokens_total',
            'Total estimated input tokens across all tool invocations',
            'counter',
            [{ value: summary.totalInputTokens }]
        )
    )
    blocks.push(
        formatMetricBlock(
            'mcp_tool_output_tokens_total',
            'Total estimated output tokens across all tool invocations',
            'counter',
            [{ value: summary.totalOutputTokens }]
        )
    )

    // 3. System Metrics
    blocks.push(
        formatMetricBlock('mcp_process_memory_bytes', 'Process RSS memory usage in bytes', 'gauge', [
            { value: system.processMemoryMb * 1024 * 1024 },
        ])
    )
    blocks.push(
        formatMetricBlock('mcp_process_uptime_seconds', 'Server process uptime in seconds', 'gauge', [
            { value: system.uptimeSeconds },
        ])
    )

    // 4. Per-Tool Breakdowns
    const callsByName: { value: number; labels: Record<string, string> }[] = []
    const tokensByName: { value: number; labels: Record<string, string> }[] = []

    for (const [toolName, toolData] of Object.entries(summary.toolBreakdown)) {
        callsByName.push({ value: toolData.callCount, labels: { tool: toolName } })
    }
    
    for (const data of tokenBreakdown) {
        tokensByName.push({ value: data.inputTokens, labels: { tool: data.toolName, type: 'input' } })
        tokensByName.push({ value: data.outputTokens, labels: { tool: data.toolName, type: 'output' } })
    }

    if (callsByName.length > 0) {
        blocks.push(
            formatMetricBlock('mcp_tool_calls_by_name_total', 'Total tool calls partitioned by tool name', 'counter', callsByName)
        )
    }

    if (tokensByName.length > 0) {
        blocks.push(
            formatMetricBlock('mcp_tool_tokens_by_name_total', 'Total tokens partitioned by tool name and token type (input/output)', 'counter', tokensByName)
        )
    }

    const errorsByName: { value: number; labels: Record<string, string> }[] = []
    const tokensPerCall: { value: number; labels: Record<string, string> }[] = []

    for (const [toolName, toolData] of Object.entries(summary.toolBreakdown)) {
        if (toolData.errorCount > 0) {
            errorsByName.push({ value: toolData.errorCount, labels: { tool: toolName } })
        }
    }
    
    for (const data of tokenBreakdown) {
        if (data.callCount > 0) {
            tokensPerCall.push({ 
                value: Math.round((data.inputTokens + data.outputTokens) / data.callCount), 
                labels: { tool: data.toolName } 
            })
        }
    }

    if (errorsByName.length > 0) {
        blocks.push(
            formatMetricBlock('mcp_tool_errors_by_name_total', 'Total tool errors partitioned by tool name', 'counter', errorsByName)
        )
    }

    if (tokensPerCall.length > 0) {
        blocks.push(
            formatMetricBlock('mcp_tool_tokens_per_call', 'Average total tokens per call partitioned by tool name', 'gauge', tokensPerCall)
        )
    }

    // 5. Per-User Breakdown
    const users: { value: number; labels: Record<string, string> }[] = []
    for (const [user, count] of Object.entries(userBreakdown)) {
        users.push({ value: count, labels: { user } })
    }
    
    if (users.length > 0) {
        blocks.push(
            formatMetricBlock('mcp_user_calls_total', 'Total tool calls partitioned by user', 'counter', users)
        )
    }

    const p50Metrics: { value: number; labels: Record<string, string> }[] = []
    const p95Metrics: { value: number; labels: Record<string, string> }[] = []
    const p99Metrics: { value: number; labels: Record<string, string> }[] = []

    for (const l of latencySummary) {
        p50Metrics.push({ value: l.p50Ms, labels: { tool: l.toolName } })
        p95Metrics.push({ value: l.p95Ms, labels: { tool: l.toolName } })
        p99Metrics.push({ value: l.p99Ms, labels: { tool: l.toolName } })
    }

    if (p50Metrics.length > 0) {
        blocks.push(formatMetricBlock('mcp_tool_latency_ms_p50', 'Median (p50) latency in milliseconds', 'gauge', p50Metrics))
        blocks.push(formatMetricBlock('mcp_tool_latency_ms_p95', '95th percentile (p95) latency in milliseconds', 'gauge', p95Metrics))
        blocks.push(formatMetricBlock('mcp_tool_latency_ms_p99', '99th percentile (p99) latency in milliseconds', 'gauge', p99Metrics))
    }

    // Join with double newlines between blocks, ensuring trailing newline.
    return blocks.filter((b) => b.length > 0).join('\n') + (blocks.length > 0 ? '' : '\n')
}
