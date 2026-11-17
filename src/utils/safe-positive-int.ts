const CANONICAL_POSITIVE_INT = /^[1-9]\d*$/

/** Parse a canonical decimal project or id string. Rejects hex, exponents, leading zeros, and unsafe integers. */
export function parseCanonicalPositiveInt(value: string): number | undefined {
    const trimmed = value.trim().replace(/^#/, '')
    if (!CANONICAL_POSITIVE_INT.test(trimmed)) return undefined
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) return undefined
    return parsed
}
