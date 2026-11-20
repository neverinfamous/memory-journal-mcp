import { SENSITIVE_KEY_RE, sanitizeErrorForLogging } from '../utils/security-utils.js'

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

function isRecordObject(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null
}

function scrubAuditObject(
    val: object,
    depth: number,
    seen: WeakSet<object>,
    budget: { count: number }
): Record<string, unknown> {
    const entries = isRecordObject(val) ? Object.entries(val) : []
    const out: Record<string, unknown> = {}
    Object.setPrototypeOf(out, null)
    const limit = Math.min(entries.length, MAX_AUDIT_OBJECT_KEYS)
    for (let i = 0; i < limit; i++) {
        const pair = entries[i]
        if (pair === undefined) continue
        const [k, v] = pair
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
    const entries: Record<string, unknown> = {}
    Object.setPrototypeOf(entries, null)
    let count = 0
    for (const [mk, mv] of val.entries()) {
        if (count++ >= MAX_AUDIT_OBJECT_KEYS || budget.count >= MAX_AUDIT_TOTAL_NODES) {
            entries['_truncatedKeys'] = Math.max(0, val.size - MAX_AUDIT_OBJECT_KEYS)
            break
        }
        const rawKey = String(mk)
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
    if (typeof val === 'bigint') return val.toString()
    if (val === null || typeof val !== 'object') return val
    if (seen.has(val)) return '[Circular]'
    if (depth >= MAX_SCRUB_DEPTH || budget.count >= MAX_AUDIT_TOTAL_NODES) return '[Truncated]'
    budget.count++

    if (ArrayBuffer.isView(val)) return `[Binary: ${String(val.byteLength)} bytes]`
    if (val instanceof Date) return val.toISOString()
    if (val instanceof Error) {
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
        return scrubAuditObject(val, depth, seen, budget)
    } finally {
        seen.delete(val)
    }
}

export function scrubAuditArgs(args: unknown): Record<string, unknown> | undefined {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
    const seen = new WeakSet([args])
    try {
        return scrubAuditObject(args, 0, seen, { count: 1 })
    } finally {
        seen.delete(args)
    }
}
