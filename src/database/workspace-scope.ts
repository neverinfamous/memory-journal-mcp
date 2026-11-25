/**
 * Omitted workspace means the `default` workspace.
 * `*` is the only scope that reads or writes every workspace.
 */
export function effectiveWorkspace(workspaceId: string | undefined): string {
    const trimmed = workspaceId?.trim()
    if (trimmed === undefined || trimmed.length === 0) return 'default'
    return trimmed
}

/** Expand bare `YYYY-MM-DD` start bounds with `' 00:00:00'` so space- and `'T'`-separated timestamps both match. */
export function normalizeDateRangeStart(start: string): string {
    return !/[Tt ]/.test(start) ? `${start} 00:00:00` : start
}

/** Expand bare `YYYY-MM-DD` end bounds with `'T23:59:59.999Z'` so both `' '` and `'T'` same-day timestamps match. */
export function normalizeDateRangeEnd(end: string): string {
    return !/[Tt ]/.test(end) ? `${end}T23:59:59.999Z` : end
}

