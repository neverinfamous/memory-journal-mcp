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
import { isRecord } from '../utils/type-guards.js'

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
const CODE_INDICATORS = ['function', 'const', 'let', 'class', 'import', 'export', '=>', ';'] as const

function isAsciiWhitespaceCode(code: number): boolean {
    return code === 32 || code === 9 || code === 10 || code === 13
}

/**
 * Detect the content type of a string to apply the most accurate token heuristic.
 */
export function detectContentType(text: string): ContentType {
    const len = text.length
    if (len === 0) return 'prose'

    let start = 0
    while (start < len && isAsciiWhitespaceCode(text.charCodeAt(start))) start++
    if (start === len) return 'prose'
    let end = len - 1
    while (end > start && isAsciiWhitespaceCode(text.charCodeAt(end))) end--

    const first = text.charCodeAt(start)
    const last = text.charCodeAt(end)
    if ((first === 123 && last === 125) || (first === 91 && last === 93)) {
        return 'json'
    }

    if (text.includes('{') && text.includes('}')) {
        return 'code'
    }

    let matches = 0
    for (const indicator of CODE_INDICATORS) {
        if (text.includes(indicator)) {
            matches++
            if (matches >= 2) return 'code'
        }
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
        if (isRecord(payload)) {
            const meta = payload['_meta']
            if (isRecord(meta)) {
                const existing = meta['tokenEstimate']
                if (typeof existing === 'number') {
                    payloadTokenCache.set(payload, existing)
                    return existing
                }
            }
        }
        const cachedJson = serializedPayloadCache.get(payload)
        if (cachedJson !== undefined) {
            const est = estimateTokens(cachedJson, 'json')
            payloadTokenCache.set(payload, est)
            return est
        }
    }
    try {
        const serialized = fastJsonStringify(payload)
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

/** Fast-path native `JSON.stringify` for sentinel meta injection, falling back to `bigintReplacer`. */
function stringifyWithBigintFallback(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return JSON.stringify(value, bigintReplacer)
    }
}

/** Fast-path native `JSON.stringify` avoiding V8 JS-replacer deopt; falls back to `safeJsonStringify` on error. */
function fastJsonStringify(payload: unknown): string {
    try {
        const json = JSON.stringify(payload)
        return typeof json === 'string' ? json : 'null'
    } catch {
        return safeJsonStringify(payload, 32, false)
    }
}

/** Cycle-safe, depth-bounded, bigint-coercing JSON serializer with optional `toJSON()` fallback. */
export function safeJsonStringify(
    payload: unknown,
    maxDepth = 32,
    fallbackOnError = true
): string {
    const ancestors: object[] = []
    const replacer = function (this: unknown, _key: string, value: unknown): unknown {
        if (typeof value === 'bigint') return value.toString()
        if (typeof value !== 'object' || value === null) return value
        if (typeof this === 'object' && this !== null) {
            while (ancestors.length > 0 && ancestors.at(-1) !== this) {
                ancestors.pop()
            }
        }
        if (ancestors.includes(value)) return '[Circular]'
        if (ancestors.length >= maxDepth) return '[Truncated]'
        ancestors.push(value)
        return value
    }
    try {
        const json = JSON.stringify(payload, replacer)
        return typeof json === 'string' ? json : 'null'
    } catch (err) {
        if (!fallbackOnError) throw err
        logger.debug('Payload JSON serialization fell back after error', {
            module: 'token-estimator',
            error: err instanceof Error ? err.message : String(err),
        })
        return JSON.stringify({ _serializationError: 'unserializable payload' })
    }
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
        const json = fastJsonStringify(payload)
        serializedPayloadCache.set(payload, json)
        return json
    }
    return fastJsonStringify(payload)
}

// ============================================================================
// Injection Helper
// ============================================================================

const TOKEN_EMPTY_META_ESTIMATE = Math.ceil(
    Buffer.byteLength('{"_meta":{"tokenEstimate":0}}', 'utf8') / BYTES_PER_TOKEN_JSON
)
const TOKEN_EMPTY_META_JSON = `{"_meta":{"tokenEstimate":${String(TOKEN_EMPTY_META_ESTIMATE)}}}`
const TOKEN_EXISTING_META_NEEDLE = `"tokenEstimate":"${TOKEN_ESTIMATE_SENTINEL}"`
const TOKEN_EXISTING_META_PREFIX_OVERHEAD_BYTES =
    Buffer.byteLength(`,"tokenEstimate":"${TOKEN_ESTIMATE_SENTINEL}"`, 'utf8') - 1
const TOKEN_EXISTING_META_BARE_OVERHEAD_BYTES =
    Buffer.byteLength(TOKEN_EXISTING_META_NEEDLE, 'utf8') - 1

function injectIntoExistingMeta(
    payload: unknown,
    obj: Record<string, unknown>,
    existingMeta: Record<string, unknown>
): unknown {
    const cleanMeta: Record<string, unknown> = {}
    for (const k of Object.keys(existingMeta)) {
        if (k !== 'tokenEstimate') cleanMeta[k] = existingMeta[k]
    }
    const hadOtherMetaKeys = Object.keys(cleanMeta).length > 0
    const placeholder = {
        ...obj,
        _meta: { ...cleanMeta, tokenEstimate: TOKEN_ESTIMATE_SENTINEL },
    }
    try {
        const placeholderJson = stringifyWithBigintFallback(placeholder)
        const needleIdx = placeholderJson.indexOf(TOKEN_EXISTING_META_NEEDLE)
        if (
            needleIdx !== -1 &&
            !placeholderJson.includes(TOKEN_EXISTING_META_NEEDLE, needleIdx + 1)
        ) {
            const overhead = hadOtherMetaKeys
                ? TOKEN_EXISTING_META_PREFIX_OVERHEAD_BYTES
                : TOKEN_EXISTING_META_BARE_OVERHEAD_BYTES
            const rawBytes = Buffer.byteLength(placeholderJson, 'utf8') - overhead
            const tokenEstimate =
                rawBytes <= 0 ? 0 : Math.ceil(rawBytes / BYTES_PER_TOKEN_JSON)
            const finalJson =
                placeholderJson.slice(0, needleIdx) +
                `"tokenEstimate":${String(tokenEstimate)}` +
                placeholderJson.slice(needleIdx + TOKEN_EXISTING_META_NEEDLE.length)
            const enriched = { ...obj, _meta: { ...cleanMeta, tokenEstimate } }
            payloadTokenCache.set(enriched, tokenEstimate)
            serializedPayloadCache.set(enriched, finalJson)
            return enriched
        }
    } catch {
        // Fall through to standard estimatePayloadTokens handling below.
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
    if (!isRecord(payload)) {
        return payload
    }

    const rawMeta = payload['_meta']
    const existingMeta = isRecord(rawMeta) ? rawMeta : {}

    if (typeof existingMeta['tokenEstimate'] === 'number') {
        const est = existingMeta['tokenEstimate']
        const enriched = { ...payload, _meta: { ...existingMeta, tokenEstimate: est } }
        payloadTokenCache.set(enriched, est)
        return enriched
    }

    if (!('_meta' in payload) || rawMeta === undefined) {
        const cachedRawJson = serializedPayloadCache.get(payload)
        if (cachedRawJson !== undefined && cachedRawJson.startsWith('{') && cachedRawJson.endsWith('}')) {
            const cachedEst = payloadTokenCache.get(payload) ?? estimateTokens(cachedRawJson, 'json')
            const enriched = { ...payload, _meta: { tokenEstimate: cachedEst } }
            const finalJson =
                cachedRawJson === '{}'
                    ? `{"_meta":{"tokenEstimate":${String(cachedEst)}}}`
                    : `${cachedRawJson.slice(0, -1)},"_meta":{"tokenEstimate":${String(cachedEst)}}}`
            payloadTokenCache.set(enriched, cachedEst)
            serializedPayloadCache.set(enriched, finalJson)
            return enriched
        }

        if (!('_meta' in payload) && Object.keys(payload).length === 0) {
            const enriched = { _meta: { tokenEstimate: TOKEN_EMPTY_META_ESTIMATE } }
            payloadTokenCache.set(enriched, TOKEN_EMPTY_META_ESTIMATE)
            serializedPayloadCache.set(enriched, TOKEN_EMPTY_META_JSON)
            return enriched
        }

        const placeholder = { ...payload, _meta: { tokenEstimate: TOKEN_ESTIMATE_SENTINEL } }
        try {
            const placeholderJson = stringifyWithBigintFallback(placeholder)
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
                const enriched = { ...payload, _meta: { tokenEstimate } }
                payloadTokenCache.set(enriched, tokenEstimate)
                serializedPayloadCache.set(enriched, finalJson)
                return enriched
            }
        } catch {
            // Fall through to standard estimatePayloadTokens error handling below.
        }
    }

    return injectIntoExistingMeta(payload, payload, existingMeta)
}
