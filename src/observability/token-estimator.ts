/**
 * Token Estimator
 *
 * Provides a byte-length heuristic for estimating token counts without
 * requiring a tokenizer. Uses ~4 bytes/token average (valid for most
 * English + mixed UTF-8 content). See mcp-builder §1.1.
 *
 * Usage:
 *   estimateTokens(str)              → number
 *   injectTokenEstimate(payload)     → payload with _meta.tokenEstimate added
 */

// ============================================================================
// Core Estimator
// ============================================================================

/**
 * Estimate the number of tokens in a string using the UTF-8 byte-length
 * heuristic: ~4 bytes per token. Fast, allocation-free.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0
    return Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

/**
 * Estimate tokens for an arbitrary serializable value by serializing it
 * to JSON first. Suitable for estimating tool response payload sizes.
 */
export function estimatePayloadTokens(payload: unknown): number {
    if (payload === null || payload === undefined) return 0
    try {
        return estimateTokens(JSON.stringify(payload))
    } catch {
        return 0
    }
}

// ============================================================================
// Injection Helper
// ============================================================================

/**
 * Inject a `_meta.tokenEstimate` field into a tool response payload.
 * Operates on a shallow copy — never mutates the original object.
 *
 * If the payload is not a plain object, returns it unchanged.
 * If `_meta` already exists, merges `tokenEstimate` into it.
 *
 * @param payload - Tool handler response (any shape)
 * @returns Payload with `_meta.tokenEstimate` added
 */
export function injectTokenEstimate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return payload
    }

    const obj = payload as Record<string, unknown>
    const serialized = (() => {
        try {
            return JSON.stringify(payload)
        } catch {
            return ''
        }
    })()
    const tokenEstimate = estimateTokens(serialized)

    const existingMeta =
        typeof obj['_meta'] === 'object' && obj['_meta'] !== null
            ? (obj['_meta'] as Record<string, unknown>)
            : {}

    return {
        ...obj,
        _meta: {
            ...existingMeta,
            tokenEstimate,
        },
    }
}
