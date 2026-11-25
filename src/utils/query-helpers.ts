/**
 * Query Helpers — Input Coercion Utilities
 *
 * Standard coercion helpers that safely convert MCP SDK inputs (which may
 * arrive as strings due to JSON serialization) into their expected types.
 *
 * Used with `z.preprocess()` to ensure bad input reaches the handler's
 * try/catch instead of causing raw -32602 protocol errors.
 */

// =============================================================================
// Constants
// =============================================================================

/** Default number of rows returned by query tools */
export const DEFAULT_QUERY_LIMIT = 100

// =============================================================================
// Coercion Functions
// =============================================================================

/**
 * Coerce a value to a number. Returns `undefined` for non-numeric input
 * so Zod treats it as "not provided" instead of producing NaN.
 *
 * Usage: `z.preprocess(coerceNumber, z.number().optional())`
 */
const CANONICAL_DECIMAL_NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const CANONICAL_NON_NEG_INT_RE = /^(?:0|[1-9]\d*)$/

export function coerceNumber(val: unknown): unknown {
    if (typeof val === 'number') return Number.isFinite(val) ? val : undefined
    if (typeof val === 'string') {
        // [INVARIANT] Empty/whitespace strings mean "not provided", never Number('') === 0.
        const trimmed = val.trim()
        if (trimmed === '' || !CANONICAL_DECIMAL_NUMBER_RE.test(trimmed)) return undefined
        const n = Number(trimmed)
        if (!trimmed.includes('.')) {
            if (trimmed === '-0') return 0
            return Number.isSafeInteger(n) && String(n) === trimmed ? n : undefined
        }
        return Number.isFinite(n) ? n : undefined
    }
    return undefined
}

/**
 * Coerce a value to a boolean. Handles string "true"/"false" from
 * MCP SDK serialization.
 *
 * Usage: `z.preprocess(coerceBoolean, z.boolean().optional())`
 */
export function coerceBoolean(val: unknown): unknown {
    if (typeof val === 'boolean') return val
    if (val === 'true') return true
    if (val === 'false') return false
    return undefined
}

/**
 * Coerce a raw limit value to a usable number.
 * - `undefined` → `defaultLimit`
 * - `NaN` → `defaultLimit`
 * - `0` → `null` (meaning "unlimited")
 * - negative → `defaultLimit`
 * - positive → the value itself
 *
 * Works with both `z.preprocess(coerceNumber, ...)` and `z.coerce.number()`
 * outputs, safely handling NaN and undefined.
 */
export function coerceLimit(
    raw: unknown,
    defaultLimit: number = DEFAULT_QUERY_LIMIT
): number | null {
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || raw < 0) return defaultLimit
        if (raw === 0) return null
        if (raw < 1) return defaultLimit
        const floored = Math.floor(raw)
        return Number.isSafeInteger(floored) ? floored : defaultLimit
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (!CANONICAL_NON_NEG_INT_RE.test(trimmed)) return defaultLimit
        const num = Number(trimmed)
        if (!Number.isSafeInteger(num) || String(num) !== trimmed) return defaultLimit
        return num === 0 ? null : num
    }
    return defaultLimit
}

/**
 * Build a SQL LIMIT clause from a coerced limit value.
 * `null` means "no limit" — returns an empty string.
 */
export function buildLimitClause(limitVal: number | null): string {
    if (limitVal === null) return ''
    if (!Number.isSafeInteger(limitVal) || limitVal < 0) {
        throw new RangeError(`Invalid SQL LIMIT value: ${String(limitVal)}`)
    }
    return ` LIMIT ${String(limitVal)}`
}
