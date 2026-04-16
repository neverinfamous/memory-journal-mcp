/**
 * Metrics Interceptor
 *
 * Wraps a tool handler invocation to capture:
 *   - Wall-clock duration (using performance.now())
 *   - Input token estimate (from serialized args)
 *   - Output token estimate (from serialized result)
 *   - Error detection ({success: false} shape or thrown exceptions)
 *
 * Design rules:
 *   - NEVER throws — all interceptor errors are swallowed silently
 *   - ALWAYS returns the original handler result unchanged
 *   - Does NOT mutate the result (token injection happens separately in callTool)
 */

import { performance } from 'node:perf_hooks'
import { estimatePayloadTokens } from './token-estimator.js'
import type { MetricsAccumulator } from './metrics.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

/** Handler function signature that the interceptor wraps */
export type ToolHandlerFn = (args: Record<string, unknown>) => Promise<unknown>

// ============================================================================
// Guard Helpers
// ============================================================================

/**
 * Detect whether a tool result is a structured error response.
 * Matches the {success: false, error: string} shape used by formatHandlerError().
 */
function isErrorResult(result: unknown): boolean {
    if (typeof result !== 'object' || result === null) return false
    const obj = result as Record<string, unknown>
    return obj['success'] === false && typeof obj['error'] === 'string'
}

// ============================================================================
// Interceptor Factory
// ============================================================================

/**
 * Wrap a tool handler with metrics collection.
 *
 * @param toolName  - Name of the tool being intercepted
 * @param handler   - The original tool handler function
 * @param accumulator - The MetricsAccumulator to record into
 * @returns A new async function with identical signature that records metrics
 */
export function wrapWithMetrics(
    toolName: string,
    handler: ToolHandlerFn,
    accumulator: MetricsAccumulator
): ToolHandlerFn {
    return async (args: Record<string, unknown>): Promise<unknown> => {
        const start = performance.now()
        let result: unknown
        let isError: boolean

        try {
            result = await handler(args)
            isError = isErrorResult(result)
        } catch (err) {
            // Re-throw so the caller still receives the original exception.
            // Record the error metric before re-throwing.
            const durationMs = Math.round(performance.now() - start)
            try {
                accumulator.record({
                    toolName,
                    durationMs,
                    inputTokens: estimatePayloadTokens(args),
                    outputTokens: 0,
                    isError: true,
                })
            } catch (err) {
                logger.error(`Accumulator failed to record metrics error`, { module: 'Metrics', error: err instanceof Error ? err.message : String(err) })
            }
            throw err
        }

        const durationMs = Math.round(performance.now() - start)

        try {
            accumulator.record({
                toolName,
                durationMs,
                inputTokens: estimatePayloadTokens(args),
                outputTokens: estimatePayloadTokens(result),
                isError,
            })
        } catch (err) {
            logger.error(`Accumulator failed to record metrics:`, { module: 'Metrics', error: err instanceof Error ? err.message : String(err) })
        }

        return result
    }
}
