/**
 * Shared zero-dependency context and byte-limit parsers used by both the host Code Mode
 * dispatcher (`sandbox-user-context.ts`) and worker nested execution (`nested-exec-payload.ts`).
 */

function isPlainContextRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Parses positive byte or kilobyte size limits (`1024`, `"64kb"`, `"2mb"`, `"512b"`).
 * Rejects non-finite numbers and unparseable trailing junk instead of truncating with `parseInt`.
 */
export function parseByteSizeValue(
    val: unknown,
    defaultUnit: 'b' | 'kb' = 'b'
): number | undefined {
    const defaultMult = defaultUnit === 'kb' ? 1024 : 1
    if (typeof val === 'number') {
        return Number.isFinite(val) && val > 0 ? Math.round(val * defaultMult) : undefined
    }
    if (typeof val === 'string') {
        const trimmed = val.trim()
        const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|bytes|b)?$/i.exec(trimmed)
        if (match?.[1] !== undefined) {
            const num = Number(match[1])
            if (!Number.isFinite(num) || num <= 0) return undefined
            const unit = (match[2] ?? defaultUnit).toLowerCase()
            if (unit === 'mb') return Math.round(num * 1024 * 1024)
            if (unit === 'kb') return Math.round(num * 1024)
            return Math.round(num)
        }
    }
    return undefined
}

/** Parses stringified `context` payloads, returning structured records for JSON objects. */
export function parseStringContextPayload(raw: string): Record<string, unknown> {
    const trimmed = raw.trim()
    const looksJson =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    if (!looksJson) return { content: raw, text: raw, raw }
    try {
        const parsed: unknown = JSON.parse(trimmed)
        return isPlainContextRecord(parsed) ? parsed : { value: parsed, raw, text: raw, content: raw }
    } catch {
        return { content: raw, text: raw, raw }
    }
}

/** Normalizes arbitrary `context` values into a mutable plain record wrapper. */
export function normalizeUserContextPayload(context: unknown): Record<string, unknown> {
    if (context === undefined || context === null) return {}
    if (isPlainContextRecord(context)) return { ...context }
    if (typeof context === 'string') return parseStringContextPayload(context)
    return { value: context, raw: context }
}
