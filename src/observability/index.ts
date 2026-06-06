/**
 * Observability Module Barrel
 *
 * Re-exports all observability sub-modules:
 *   - token-estimator: byte-length heuristic for token counting
 *   - metrics: in-memory Map-based accumulator + singleton
 *   - interceptor: metrics-collecting tool handler wrapper
 *   - latency-tracker: per-tool sliding-window percentile tracker
 */

export { estimateTokens, estimatePayloadTokens, injectTokenEstimate } from './token-estimator.js'

export { MetricsAccumulator } from './metrics.js'

export type { ToolMetrics, MetricsSummary, SystemMetrics } from './metrics.js'

export { wrapWithMetrics } from './interceptor.js'

export type { ToolHandlerFn } from './interceptor.js'

export { LatencyTracker } from './latency-tracker.js'

export type { LatencyPercentiles } from './latency-tracker.js'

export { formatPrometheusMetrics } from './prometheus-formatter.js'
