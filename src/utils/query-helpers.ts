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
export function coerceNumber(val: unknown): unknown {
    if (typeof val === 'number') return Number.isFinite(val) ? val : undefined
    if (typeof val === 'string') {
        // [INVARIANT] Empty/whitespace strings mean "not provided", never Number('') === 0.
        if (val.trim() === '') return undefined
        const n = Number(val)
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
    if (raw === undefined || raw === null) return defaultLimit
    if (typeof raw === 'string' && raw.trim() === '') return defaultLimit
    const num = Number(raw)
    if (!Number.isFinite(num)) return defaultLimit
    if (num === 0) return null
    return num > 0 ? Math.floor(num) : defaultLimit
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
