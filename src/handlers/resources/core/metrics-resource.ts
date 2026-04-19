/**
 * Metrics Resource Handlers
 *
 * Serves the four memory://metrics/* resources from the global
 * MetricsAccumulator singleton. All payloads use YAML/key-value text
 * for token efficiency (mcp-builder §1.1).
 *
 * Resources:
 *   memory://metrics/summary  — HIGH_PRIORITY  — aggregate call/error/token stats
 *   memory://metrics/tokens   — MEDIUM_PRIORITY — per-tool token usage breakdown
 *   memory://metrics/system   — MEDIUM_PRIORITY — process memory, uptime, Node version
 *   memory://metrics/users    — LOW_PRIORITY    — per-user call count breakdown
 */

// Removed globalMetrics import
import {
    HIGH_PRIORITY,
    MEDIUM_PRIORITY,
    LOW_PRIORITY,
} from '../../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'

// ============================================================================
// Helpers
// ============================================================================

function nowIso(): string {
    return new Date().toISOString()
}

// ============================================================================
// memory://metrics/summary
// ============================================================================

export const metricsSummaryResource: InternalResourceDef = {
    uri: 'memory://metrics/summary',
    name: 'Metrics Summary',
    title: 'Tool Call Metrics Summary',
    description:
        'Aggregate metrics across all tool calls since server start. ' +
        'Includes total calls, errors, duration, and token estimates.',
    mimeType: 'text/plain',
    annotations: {
        ...HIGH_PRIORITY,
        audience: ['assistant'],
    },
    handler: (_uri: string, ctx: ResourceContext): ResourceResult => {
        const lastModified = nowIso()
        const s = ctx.runtime?.metrics.getSummary()
        
        if (!s) {
            return { data: 'metrics_summary:\n  error: Metrics not available\n', annotations: { lastModified } }
        }

        const errorRate =
            s.totalCalls > 0 ? ((s.totalErrors / s.totalCalls) * 100).toFixed(1) : '0.0'
        const avgDuration = s.totalCalls > 0 ? Math.round(s.totalDurationMs / s.totalCalls) : 0

        const text =
            `metrics_summary:\n` +
            `  up_since: ${s.upSince}\n` +
            `  as_of: ${lastModified}\n` +
            `  total_calls: ${s.totalCalls}\n` +
            `  total_errors: ${s.totalErrors}\n` +
            `  error_rate_pct: ${errorRate}\n` +
            `  total_duration_ms: ${s.totalDurationMs}\n` +
            `  avg_duration_ms: ${avgDuration}\n` +
            `  total_input_tokens: ${s.totalInputTokens}\n` +
            `  total_output_tokens: ${s.totalOutputTokens}\n` +
            `  tools_called: ${Object.keys(s.toolBreakdown).length}\n`

        return { data: text, annotations: { lastModified } }
    },
}

// ============================================================================
// memory://metrics/tokens
// ============================================================================

export const metricsTokensResource: InternalResourceDef = {
    uri: 'memory://metrics/tokens',
    name: 'Metrics Tokens',
    title: 'Token Usage Breakdown by Tool',
    description:
        'Per-tool token usage breakdown sorted by total output tokens. ' +
        'Use this to identify which tools are consuming the most context window.',
    mimeType: 'text/plain',
    annotations: {
        ...MEDIUM_PRIORITY,
        audience: ['assistant'],
    },
    handler: (_uri: string, ctx: ResourceContext): ResourceResult => {
        const lastModified = nowIso()
        const breakdown = ctx.runtime?.metrics.getTokenBreakdown() ?? []

        if (breakdown.length === 0) {
            return {
                data: `token_breakdown:\n  note: No tool calls recorded yet.\n  as_of: ${lastModified}\n`,
                annotations: { lastModified },
            }
        }

        const rows = breakdown
            .map(
                (t) =>
                    `  - tool: ${t.toolName}\n` +
                    `    calls: ${t.callCount}\n` +
                    `    input_tokens: ${t.inputTokens}\n` +
                    `    output_tokens: ${t.outputTokens}\n` +
                    `    avg_output_tokens: ${t.avgOutputTokens}`
            )
            .join('\n')

        const text = `token_breakdown:\n  as_of: ${lastModified}\n${rows}\n`

        return { data: text, annotations: { lastModified } }
    },
}

// ============================================================================
// memory://metrics/system
// ============================================================================

export const metricsSystemResource: InternalResourceDef = {
    uri: 'memory://metrics/system',
    name: 'Metrics System',
    title: 'System Metrics',
    description:
        'Process-level system metrics: memory usage, uptime, Node.js version, and platform.',
    mimeType: 'text/plain',
    annotations: {
        ...MEDIUM_PRIORITY,
        audience: ['assistant'],
    },
    handler: (_uri: string, ctx: ResourceContext): ResourceResult => {
        const lastModified = nowIso()
        const sys = ctx.runtime?.metrics.getSystemMetrics()
        
        if (!sys) {
            return { data: 'system_metrics:\n  error: Metrics not available\n', annotations: { lastModified } }
        }

        const text =
            `system_metrics:\n` +
            `  up_since: ${sys.upSince}\n` +
            `  uptime_seconds: ${sys.uptimeSeconds}\n` +
            `  process_memory_mb: ${sys.processMemoryMb}\n` +
            `  node_version: ${sys.nodeVersion}\n` +
            `  platform: ${sys.platform}\n` +
            `  as_of: ${lastModified}\n`

        return { data: text, annotations: { lastModified } }
    },
}

// ============================================================================
// memory://metrics/users
// ============================================================================

export const metricsUsersResource: InternalResourceDef = {
    uri: 'memory://metrics/users',
    name: 'Metrics Users',
    title: 'Per-User Call Counts',
    description:
        'Per-user tool call counts. Populated when user identifiers are provided ' +
        'via OAuth or request metadata. Returns empty breakdown when no user tracking configured.',
    mimeType: 'text/plain',
    annotations: {
        ...LOW_PRIORITY,
        audience: ['assistant'],
    },
    handler: (_uri: string, ctx: ResourceContext): ResourceResult => {
        const lastModified = nowIso()
        const userBreakdown = ctx.runtime?.metrics.getUserBreakdown() ?? {}
        const users = Object.entries(userBreakdown)

        if (users.length === 0) {
            return {
                data:
                    `user_metrics:\n` +
                    `  note: No user tracking data available.\n` +
                    `  hint: User tracking activates when OAuth user identifiers are present.\n` +
                    `  as_of: ${lastModified}\n`,
                annotations: { lastModified },
            }
        }

        const sorted = users.sort(([, a], [, b]) => b - a)
        const rows = sorted
            .map(([user, count]) => `  - user: ${user}\n    calls: ${count}`)
            .join('\n')

        const text = `user_metrics:\n  as_of: ${lastModified}\n${rows}\n`

        return { data: text, annotations: { lastModified } }
    },
}

// ============================================================================
// Convenience: all four metrics resources
// ============================================================================

export function getMetricsResourceDefinitions(): InternalResourceDef[] {
    return [
        metricsSummaryResource,
        metricsTokensResource,
        metricsSystemResource,
        metricsUsersResource,
    ]
}
