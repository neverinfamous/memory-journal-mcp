/**
 * Shared cross-realm Error/Date inspection and safe `toJSON()` resolution
 * for host-side error, log, and audit sanitizers (M3).
 *
 * [BOUNDARY] Host-only utility (never imported by `src/codemode/worker/**`).
 */

export function isCrossRealmError(value: unknown): value is Error {
    const isErrFn: unknown = Reflect.get(Error, 'isError')
    if (typeof isErrFn === 'function') {
        return (isErrFn as (v: unknown) => boolean)(value)
    }
    return value instanceof Error
}

export function isCrossRealmDate(value: unknown): value is Date {
    return value instanceof Date || Object.prototype.toString.call(value) === '[object Date]'
}

export function tryResolveToJson(
    value: object
): { resolved: true; value: unknown } | { resolved: false } {
    if (isCrossRealmDate(value) || value instanceof URL) {
        return { resolved: false }
    }
    let toJsonFn: unknown
    try {
        toJsonFn = Reflect.get(value, 'toJSON')
    } catch {
        return { resolved: true, value: '[Unserializable]' }
    }
    if (typeof toJsonFn !== 'function') {
        return { resolved: false }
    }
    try {
        const res: unknown = (toJsonFn as () => unknown).call(value)
        if (res === value) return { resolved: false }
        return { resolved: true, value: res }
    } catch {
        return { resolved: true, value: '[Unserializable]' }
    }
}
