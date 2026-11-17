const CANONICAL_POSITIVE_INT = /^[1-9]\d*$/

/** Parse a canonical decimal project or id string. Rejects hex, exponents, leading zeros, and unsafe integers. */
export function parseCanonicalPositiveInt(value: string): number | undefined {
    const trimmed = value.trim().replace(/^#/, '')
    if (!CANONICAL_POSITIVE_INT.test(trimmed)) return undefined
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) return undefined
    return parsed
}

/** Accept a number or canonical decimal string. Rejects hex, exponents, leading zeros, and unsafe integers. */
export function parsePositiveProjectNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : undefined
    }
    if (typeof value === 'string') return parseCanonicalPositiveInt(value)
    return undefined
}
