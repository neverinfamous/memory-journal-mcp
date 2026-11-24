/**
 * Shared zero-dependency runtime type guards and prototype-safe record builders.
 * [BOUNDARY] Zero imports so worker scripts and leaf utilities can reuse without server pulls.
 */

/**
 * Type guard for non-null plain/dictionary objects (excludes arrays and primitives).
 */
export function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Safely extract a string POSIX/Node `code` (e.g. `'ENOENT'`) from an unknown error value.
 */
export function getErrnoCode(err: unknown): string | undefined {
    if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
        return err.code
    }
    return undefined
}

/**
 * Create a null-prototype dictionary without `Object.create(null) as ...` type assertions.
 */
export function createNullProtoRecord<T = unknown>(init?: Record<string, T>): Record<string, T> {
    const out: Record<string, T> = init !== undefined ? { ...init } : {}
    Object.setPrototypeOf(out, null)
    return out
}
