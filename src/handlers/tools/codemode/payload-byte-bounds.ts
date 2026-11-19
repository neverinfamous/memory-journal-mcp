/**
 * Pre-validation payload byte-size and nesting-depth bounds for Code Mode (`handler.ts`).
 * Uses active-ancestor DAG tracking so shared references count on every expansion and
 * rejects structures exceeding `MAX_ESTIMATE_DEPTH` without falling back to `JSON.stringify`.
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import {
    exceedsMaxToolInputElements,
    resolveEffectiveMaxToolInputElements,
} from '../../../utils/tool-input-bounds.js'

export const MAX_CONTEXT_BYTES = 5 * 1024 * 1024
const MAX_ESTIMATE_DEPTH = 64

export function estimateSerializedByteBounds(
    val: unknown,
    limitBytes: number,
    seen: Set<unknown>,
    depth = 0
): { lowerBytes: number; exactBytes: number | null; circular?: boolean; overDepth?: boolean } {
    if (val === null || val === undefined) return { lowerBytes: 4, exactBytes: 4 }
    if (typeof val === 'string') {
        const rawBytes = Buffer.byteLength(val, 'utf-8')
        return { lowerBytes: rawBytes + 2, exactBytes: rawBytes > limitBytes ? null : rawBytes * 6 + 2 }
    }
    if (typeof val === 'number' || typeof val === 'boolean') return { lowerBytes: 1, exactBytes: 24 }
    if (typeof val === 'bigint') return { lowerBytes: 0, exactBytes: null }
    if (typeof val !== 'object') return { lowerBytes: 0, exactBytes: 0 }
    if (depth > MAX_ESTIMATE_DEPTH) {
        return { lowerBytes: limitBytes + 1, exactBytes: null, overDepth: true }
    }
    if (seen.has(val)) return { lowerBytes: 0, exactBytes: null, circular: true }
    seen.add(val)

    const record = val as { toJSON?: unknown }
    if (typeof record.toJSON === 'function') {
        seen.delete(val)
        return { lowerBytes: 0, exactBytes: null }
    }

    let lowerBytes = 2
    let exactUpper: number | null = 2
    if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
            const sub = estimateSerializedByteBounds(val[i], limitBytes, seen, depth + 1)
            if (sub.circular === true || sub.overDepth === true) return sub
            lowerBytes += sub.lowerBytes + (i > 0 ? 1 : 0)
            if (lowerBytes > limitBytes) {
                seen.delete(val)
                return { lowerBytes, exactBytes: null }
            }
            exactUpper =
                exactUpper !== null && sub.exactBytes !== null ? exactUpper + sub.exactBytes + 1 : null
        }
    } else {
        let first = true
        for (const [k, v] of Object.entries(val)) {
            if (v === undefined) continue
            const rawKeyBytes = Buffer.byteLength(k, 'utf-8')
            const keyBytes = rawKeyBytes + 3
            const sub = estimateSerializedByteBounds(v, limitBytes, seen, depth + 1)
            if (sub.circular === true || sub.overDepth === true) return sub
            lowerBytes += keyBytes + sub.lowerBytes + (first ? 0 : 1)
            first = false
            if (lowerBytes > limitBytes) {
                seen.delete(val)
                return { lowerBytes, exactBytes: null }
            }
            exactUpper =
                exactUpper !== null && sub.exactBytes !== null
                    ? exactUpper + rawKeyBytes * 6 + 3 + sub.exactBytes + 1
                    : null
        }
    }
    seen.delete(val)
    return { lowerBytes, exactBytes: exactUpper }
}

export function checkSerializedByteLimit(val: unknown, limitBytes: number, errorMsg: string): string | null {
    try {
        if (typeof val === 'string') {
            return Buffer.byteLength(val, 'utf-8') > limitBytes ? errorMsg : null
        }
        const bounds = estimateSerializedByteBounds(val, limitBytes, new Set())
        if (bounds.circular === true) {
            return 'Security validation failed: Invalid non-serializable payload object'
        }
        if (bounds.overDepth === true) {
            return `Security validation failed: Payload exceeds maximum nesting depth of ${String(MAX_ESTIMATE_DEPTH)}`
        }
        if (bounds.lowerBytes > limitBytes) {
            return errorMsg
        }
        if (bounds.exactBytes !== null && bounds.exactBytes <= limitBytes) {
            return null
        }
        const serialized = JSON.stringify(val)
        if (typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf-8') > limitBytes) {
            return errorMsg
        }
        return null
    } catch {
        return 'Security validation failed: Invalid non-serializable payload object'
    }
}

export function validateRawPayloadSize(
    params: unknown,
    maxCodeLength: number,
    configuredMaxElements?: number
): string | null {
    const maxElements = resolveEffectiveMaxToolInputElements(configuredMaxElements)
    if (exceedsMaxToolInputElements(params, maxElements)) {
        return `Security validation failed: Tool input exceeds maximum of ${String(maxElements)} elements`
    }
    const overLimit = (): string =>
        `Security validation failed: Code exceeds maximum length of ${String(maxCodeLength)} bytes`
    if (typeof params === 'string') {
        return Buffer.byteLength(params, 'utf-8') > maxCodeLength ? overLimit() : null
    }
    if (!isRecord(params)) return null
    for (const [key, val] of Object.entries(params)) {
        if (val === undefined || val === null) continue
        if (key === 'context') {
            const ctxErr = checkSerializedByteLimit(
                val,
                MAX_CONTEXT_BYTES,
                `Security validation failed: Context exceeds maximum length of ${String(MAX_CONTEXT_BYTES)} bytes`
            )
            if (ctxErr !== null) return ctxErr
            continue
        }
        if (typeof val === 'string') {
            if (Buffer.byteLength(val, 'utf-8') > maxCodeLength) return overLimit()
        } else if (typeof val === 'object') {
            const objErr = checkSerializedByteLimit(val, maxCodeLength, overLimit())
            if (objErr !== null) return objErr
        }
    }
    return null
}
