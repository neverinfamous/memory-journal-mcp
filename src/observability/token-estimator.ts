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

import { logger } from '../utils/logger.js'

export type ContentType = 'prose' | 'json' | 'code'

const BYTES_PER_TOKEN_PROSE = 4.0
const BYTES_PER_TOKEN_JSON = 2.8
const BYTES_PER_TOKEN_CODE = 3.2

const payloadTokenCache = new WeakMap<object, number>()
const serializedPayloadCache = new WeakMap<object, string>()
const TOKEN_ESTIMATE_SENTINEL = '__MJ_TOKEN_EST__'
const TOKEN_SENTINEL_META_SUFFIX = `,"_meta":{"tokenEstimate":"${TOKEN_ESTIMATE_SENTINEL}"}}`
const TOKEN_SENTINEL_OVERHEAD_BYTES = Buffer.byteLength(TOKEN_SENTINEL_META_SUFFIX, 'utf8') - 1
const TOKEN_SENTINEL_TAIL = `"${TOKEN_ESTIMATE_SENTINEL}"}}`

// ============================================================================
// Core Estimator
// ============================================================================

/**
 * Detect the content type of a string to apply the most accurate token heuristic.
 */
export function detectContentType(text: string): ContentType {
    if (!text || text.length === 0) return 'prose'
    
    // Quick heuristic: look at the first and last non-whitespace characters
    const trimmed = text.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const endTrimmed = text.trimEnd()
        if (endTrimmed.endsWith('}') || endTrimmed.endsWith(']')) {
            return 'json'
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
    if (typeof payload === 'object') {
        const cached = payloadTokenCache.get(payload)
        if (cached !== undefined) return cached
        const obj = payload as Record<string, unknown>
        const meta = obj['_meta']
        if (typeof meta === 'object' && meta !== null) {
            const existing = (meta as Record<string, unknown>)['tokenEstimate']
            if (typeof existing === 'number') {
                payloadTokenCache.set(payload, existing)
                return existing
            }
        }
    }
    try {
        const serialized = JSON.stringify(payload, bigintReplacer)
        if (typeof serialized !== 'string') return 0
        const est = estimateTokens(serialized, 'json')
        if (typeof payload === 'object') {
            payloadTokenCache.set(payload, est)
            serializedPayloadCache.set(payload, serialized)
        }
        return est
    } catch (error) {
        logger.debug('Token estimation failed; defaulting to 0', {
            module: 'token-estimator',
            error: error instanceof Error ? error.message : String(error),
        })
        return 0
    }
}

export function bigintReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value
}

/** Invalidate cached serialized JSON when a post-handler transform mutates `payload`. */
export function invalidateSerializedPayload(payload: unknown): void {
    if (typeof payload === 'object' && payload !== null) {
        serializedPayloadCache.delete(payload)
        payloadTokenCache.delete(payload)
    }
}

/** Return the JSON string for `payload`, reusing cached serialization from token estimation/injection. */
export function getSerializedPayloadJson(payload: unknown): string {
    if (typeof payload === 'string') return payload
    if (typeof payload === 'object' && payload !== null) {
        const cached = serializedPayloadCache.get(payload)
        if (cached !== undefined) return cached
        const json = JSON.stringify(payload, bigintReplacer)
        if (typeof json === 'string') {
            serializedPayloadCache.set(payload, json)
            return json
        }
    }
    return JSON.stringify(payload, bigintReplacer) ?? 'null'
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
    const rawMeta = obj['_meta']
    const hasMeta = typeof rawMeta === 'object' && rawMeta !== null
    const existingMeta = hasMeta ? (rawMeta as Record<string, unknown>) : {}

    if (typeof existingMeta['tokenEstimate'] === 'number') {
        const est = existingMeta['tokenEstimate']
        const enriched = { ...obj, _meta: { ...existingMeta, tokenEstimate: est } }
        payloadTokenCache.set(enriched, est)
        return enriched
    }

    if (!('_meta' in obj) || rawMeta === undefined) {
        const cachedRawJson = serializedPayloadCache.get(payload)
        if (cachedRawJson !== undefined && cachedRawJson.startsWith('{') && cachedRawJson.endsWith('}')) {
            const cachedEst = payloadTokenCache.get(payload) ?? estimateTokens(cachedRawJson, 'json')
            const enriched = { ...obj, _meta: { tokenEstimate: cachedEst } }
            const finalJson =
                cachedRawJson === '{}'
                    ? `{"_meta":{"tokenEstimate":${String(cachedEst)}}}`
                    : `${cachedRawJson.slice(0, -1)},"_meta":{"tokenEstimate":${String(cachedEst)}}}`
            payloadTokenCache.set(enriched, cachedEst)
            serializedPayloadCache.set(enriched, finalJson)
            return enriched
        }

        const placeholder = { ...obj, _meta: { tokenEstimate: TOKEN_ESTIMATE_SENTINEL } }
        try {
            const placeholderJson = JSON.stringify(placeholder, bigintReplacer)
            if (placeholderJson.endsWith(TOKEN_SENTINEL_META_SUFFIX)) {
                const rawBytes =
                    Buffer.byteLength(placeholderJson, 'utf8') - TOKEN_SENTINEL_OVERHEAD_BYTES
                const tokenEstimate =
                    rawBytes <= 0 ? 0 : Math.ceil(rawBytes / BYTES_PER_TOKEN_JSON)
                const finalJson =
                    placeholderJson.slice(
                        0,
                        placeholderJson.length - TOKEN_SENTINEL_TAIL.length
                    ) + `${String(tokenEstimate)}}}`
                const enriched = { ...obj, _meta: { tokenEstimate } }
                payloadTokenCache.set(enriched, tokenEstimate)
                serializedPayloadCache.set(enriched, finalJson)
                return enriched
            }
        } catch {
            // Fall through to standard estimatePayloadTokens error handling below.
        }
    }

    const tokenEstimate = estimatePayloadTokens(payload)
    const enriched = {
        ...obj,
        _meta: {
            ...existingMeta,
            tokenEstimate,
        },
    }
    payloadTokenCache.set(enriched, tokenEstimate)
    return enriched
}
