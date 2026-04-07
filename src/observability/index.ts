/**
 * Observability Module Barrel
 *
 * Re-exports all observability sub-modules:
 *   - token-estimator: byte-length heuristic for token counting
 *   - metrics: in-memory Map-based accumulator + singleton
 *   - interceptor: metrics-collecting tool handler wrapper
 */

export { estimateTokens, estimatePayloadTokens, injectTokenEstimate } from './token-estimator.js'

export { MetricsAccumulator, globalMetrics } from './metrics.js'

export type { ToolMetrics, MetricsSummary, SystemMetrics } from './metrics.js'

export { wrapWithMetrics } from './interceptor.js'

export type { ToolHandlerFn } from './interceptor.js'
