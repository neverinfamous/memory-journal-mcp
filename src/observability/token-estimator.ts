/**
 * Token Estimator
 *
 * Provides a heuristic for estimating token counts without requiring a heavy tokenizer
 * dependency. Varies the byte-to-token ratio based on the content type to improve
 * accuracy for structured data and code.
 *
 * Ratios (empirically derived against tiktoken for GPT-4):
 *   - Prose: ~4.0 bytes/token (standard English)
 *   - JSON:  ~2.8 bytes/token (high density of structural characters)
 *   - Code:  ~3.2 bytes/token (mixed density)
 *
 * Usage:
 *   estimateTokens(str, contentType?)   → number
 *   estimatePayloadTokens(payload)      → number (always 'json')
 *   injectTokenEstimate(payload)        → payload with _meta.tokenEstimate added
 */

export type ContentType = 'prose' | 'json' | 'code'

const BYTES_PER_TOKEN_PROSE = 4.0
const BYTES_PER_TOKEN_JSON = 2.8
const BYTES_PER_TOKEN_CODE = 3.2

// ============================================================================
// Core Estimator
// ============================================================================

/**
 * Detect the content type of a string to apply the most accurate token heuristic.
 */
export function detectContentType(text: string): ContentType {
    if (!text || text.length === 0) return 'prose'
    
    // Quick heuristic: look at the first non-whitespace character
    const trimmed = text.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        // High likelihood of JSON
        try {
            JSON.parse(text)
            return 'json'
        } catch {
            // Not valid JSON, but still structurally JSON-like?
            // If it ends with } or ], we'll call it JSON
            const endTrimmed = text.trimEnd()
            if (endTrimmed.endsWith('}') || endTrimmed.endsWith(']')) {
                return 'json'
            }
        }
    }

    // Heuristic for code: look for common code indicators
    // If it contains a high density of semicolons, braces, or keywords, call it code
    const codeIndicators = ['function', 'const', 'let', 'class', 'import', 'export', '=>', ';']
    let matches = 0
    for (const indicator of codeIndicators) {
        if (text.includes(indicator)) matches++
    }
    
    if (matches >= 2 || (text.includes('{') && text.includes('}'))) {
         // Prevent over-classification: if it's very long and lacks many code keywords but has {}, it might be markdown with a snippet
         // For now, if we match 2+ indicators or have braces, call it code.
         return 'code'
    }

    return 'prose'
}

/**
 * Estimate the number of tokens in a string using a content-type-aware heuristic.
 * If contentType is not provided, it is auto-detected.
 */
export function estimateTokens(text: string, contentType?: ContentType): number {
    if (!text) return 0
    
    const type = contentType ?? detectContentType(text)
    const bytes = Buffer.byteLength(text, 'utf8')
    
    let ratio = BYTES_PER_TOKEN_PROSE
    if (type === 'json') ratio = BYTES_PER_TOKEN_JSON
    else if (type === 'code') ratio = BYTES_PER_TOKEN_CODE
        
    return Math.ceil(bytes / ratio)
}

/**
 * Estimate tokens for an arbitrary serializable value by serializing it
 * to JSON first. Uses the 'json' content type heuristic.
 */
export function estimatePayloadTokens(payload: unknown): number {
    if (payload === null || payload === undefined) return 0
    try {
        return estimateTokens(JSON.stringify(payload), 'json')
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
    // We know it's JSON because we serialized an object
    const tokenEstimate = estimateTokens(serialized, 'json')

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
