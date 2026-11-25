import { SENSITIVE_KEY_RE, sanitizeErrorForLogging } from '../utils/security-utils.js'
import { createNullProtoRecord, isRecord } from '../utils/type-guards.js'
import { logger } from '../utils/logger.js'
import { estimatePayloadTokens, estimateTokens } from '../observability/token-estimator.js'
import {
    isCrossRealmDate,
    isCrossRealmError,
    tryResolveToJson,
} from '../utils/sanitize-value-helpers.js'

const MAX_SCRUB_DEPTH = 6
const MAX_AUDIT_ARRAY_ITEMS = 50
const MAX_AUDIT_OBJECT_KEYS = 50
const MAX_AUDIT_TOTAL_NODES = 250
const MAX_AUDIT_RAW_SCRUB_CHARS = 4096

function scrubAndTruncateAuditString(raw: string, maxChars: number): string {
    const bounded = raw.length > MAX_AUDIT_RAW_SCRUB_CHARS ? raw.slice(0, MAX_AUDIT_RAW_SCRUB_CHARS) : raw
    const clean = sanitizeErrorForLogging(bounded)
    return clean.length > maxChars || raw.length > maxChars
        ? `${clean.slice(0, maxChars)}...[truncated]`
        : clean
}

function scrubAuditObject(
    val: object,
    depth: number,
    seen: WeakSet<object>,
    budget: { count: number }
): Record<string, unknown> {
    const entries = isRecord(val) ? Object.entries(val) : []
    const out = createNullProtoRecord()
    const limit = Math.min(entries.length, MAX_AUDIT_OBJECT_KEYS)
    for (let i = 0; i < limit; i++) {
        const pair = entries[i]
        if (pair === undefined) continue
        const [k, v] = pair
        if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k === 'toJSON' || typeof v === 'function') {
            continue
        }
        const safeKey = scrubAndTruncateAuditString(k, 256)
        out[safeKey] =
            SENSITIVE_KEY_RE.test(k) || SENSITIVE_KEY_RE.test(safeKey)
                ? '[REDACTED]'
                : scrubAuditArgValue(v, depth + 1, seen, budget)
    }
    if (entries.length > MAX_AUDIT_OBJECT_KEYS) {
        out['_truncatedKeys'] = entries.length - MAX_AUDIT_OBJECT_KEYS
    }
    return out
}

function scrubAuditMap(
    val: ReadonlyMap<unknown, unknown>,
    depth: number,
    seen: WeakSet<object>,
    budget: { count: number }
): Record<string, unknown> {
    const entries = createNullProtoRecord()
    let count = 0
    for (const [mk, mv] of val.entries()) {
        if (count++ >= MAX_AUDIT_OBJECT_KEYS || budget.count >= MAX_AUDIT_TOTAL_NODES) {
            entries['_truncatedKeys'] = Math.max(0, val.size - (count - 1))
            break
        }
        const rawKey = String(mk)
        if (rawKey === 'toJSON' || typeof mv === 'function') continue
        const keyStr = scrubAndTruncateAuditString(rawKey, 256)
        entries[keyStr] =
            SENSITIVE_KEY_RE.test(rawKey) || SENSITIVE_KEY_RE.test(keyStr)
                ? '[REDACTED]'
                : scrubAuditArgValue(mv, depth + 1, seen, budget)
    }
    return entries
}

export function scrubAuditArgValue(
    val: unknown,
    depth: number,
    seen: WeakSet<object>,
    budget: { count: number }
): unknown {
    if (typeof val === 'string') {
        return scrubAndTruncateAuditString(val, 2048)
    }
    if (typeof val === 'function') return '[Function]'
    if (typeof val === 'bigint') return val.toString()
    if (val === null || typeof val !== 'object') return val
    if (seen.has(val)) return '[Circular]'
    if (depth >= MAX_SCRUB_DEPTH || budget.count >= MAX_AUDIT_TOTAL_NODES) return '[Truncated]'
    budget.count++

    if (ArrayBuffer.isView(val)) return `[Binary: ${String(val.byteLength)} bytes]`
    if (isCrossRealmDate(val)) return Number.isNaN(val.getTime()) ? 'Invalid Date' : val.toISOString()
    if (val instanceof URL) return scrubAndTruncateAuditString(val.href, 2048)
    if (isCrossRealmError(val)) {
        return scrubAndTruncateAuditString(`${val.name}: ${val.message}`, 2048)
    }

    seen.add(val)
    try {
        if (val instanceof Set) {
            return scrubAuditArgValue(Array.from(val.values()), depth, seen, budget)
        }
        if (val instanceof Map) {
            return scrubAuditMap(val, depth, seen, budget)
        }
        if (Array.isArray(val)) {
            const sliced = val.slice(0, MAX_AUDIT_ARRAY_ITEMS)
            const out = sliced.map((item) => scrubAuditArgValue(item, depth + 1, seen, budget))
            if (val.length > MAX_AUDIT_ARRAY_ITEMS) {
                out.push(`...[+${String(val.length - MAX_AUDIT_ARRAY_ITEMS)} more]`)
            }
            return out
        }
        const jsonRes = tryResolveToJson(val)
        if (jsonRes.resolved) {
            return scrubAuditArgValue(jsonRes.value, depth + 1, seen, budget)
        }
        return scrubAuditObject(val, depth, seen, budget)
    } finally {
        seen.delete(val)
    }
}

export function scrubAuditArgs(args: unknown): Record<string, unknown> | undefined {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
    const seen = new WeakSet([args])
    const budget = { count: 1 }
    try {
        const jsonRes = tryResolveToJson(args)
        if (jsonRes.resolved) {
            const resolved = scrubAuditArgValue(jsonRes.value, 1, seen, budget)
            if (isRecord(resolved)) {
                return resolved
            }
            const wrapped = createNullProtoRecord()
            wrapped['value'] = resolved
            return wrapped
        }
        return scrubAuditObject(args, 0, seen, budget)
    } finally {
        seen.delete(args)
    }
}

function extractRecordText(val: unknown): string | undefined {
    return isRecord(val) && typeof val['text'] === 'string' ? val['text'] : undefined
}

function estimateEnvelopeTextTokens(result: unknown): number | undefined {
    if (!isRecord(result)) return undefined
    const contents = result['contents']
    if (Array.isArray(contents)) {
        let total = 0
        for (const item of contents) {
            const itemVal: unknown = item
            const text = extractRecordText(itemVal)
            if (text === undefined) return undefined
            total += estimateTokens(text, 'json')
        }
        return total
    }
    const messages = result['messages']
    if (Array.isArray(messages)) {
        let total = 0
        for (const msg of messages) {
            const msgVal: unknown = msg
            const content = isRecord(msgVal) ? msgVal['content'] : undefined
            const text = extractRecordText(content)
            if (text === undefined) return undefined
            total += estimateTokens(text, 'prose')
        }
        return total
    }
    return undefined
}

/** Estimate token count for resource/prompt operation audit records, avoiding full JSON stringification on envelopes. */
export function estimateOperationResultTokens(result: unknown, name: string): number | undefined {
    if (typeof result === 'object' && result !== null) {
        const fastTokens = estimateEnvelopeTextTokens(result)
        if (fastTokens !== undefined) return fastTokens
        try {
            return estimatePayloadTokens(result)
        } catch (serializeError) {
            logger.debug('Token estimate skipped: result is not serializable', {
                module: 'Audit',
                tool: name,
                error: serializeError instanceof Error ? serializeError.message : String(serializeError),
            })
            return undefined
        }
    }
    return typeof result === 'string' ? estimateTokens(result, 'prose') : undefined
}
