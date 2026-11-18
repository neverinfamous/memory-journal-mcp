/**
 * Memory Journal MCP Server - Readonly Filter Cache
 *
 * Memoizes parsed readonly / post-readonly include/exclude state across
 * high-frequency tools/list and tools/call visibility checks.
 */

export interface ReadonlyFilterState {
    active: boolean
    postIncluded: Set<string>
}

export interface ReadonlyFilterOps {
    applyInclude: (enabled: Set<string>, name: string) => Set<string>
    applyExclude: (enabled: Set<string>, name: string) => void
}

const MAX_READONLY_FILTER_CACHE = 64
const EMPTY_STATE: ReadonlyFilterState = { active: false, postIncluded: new Set<string>() }
const READONLY_FILTER_STATE_CACHE = new Map<string, ReadonlyFilterState>()

function computeReadonlyFilterState(
    raw: string,
    ops: ReadonlyFilterOps
): ReadonlyFilterState {
    const tokens = raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    let active = false
    let lastReadonlyIdx = -1
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (token === 'readonly' || token === '+readonly' || token === '-write') {
            active = true
            lastReadonlyIdx = i
        } else if (token === '-readonly' || token === 'write' || token === '+write') {
            active = false
            lastReadonlyIdx = -1
        }
    }
    let postIncluded = new Set<string>()
    if (lastReadonlyIdx !== -1) {
        for (let i = lastReadonlyIdx + 1; i < tokens.length; i++) {
            const token = tokens[i]
            if (!token) continue
            if (token.startsWith('-')) {
                ops.applyExclude(postIncluded, token.slice(1))
            } else {
                const name = token.startsWith('+') ? token.slice(1) : token
                postIncluded = ops.applyInclude(postIncluded, name)
            }
        }
    }
    return { active, postIncluded }
}

/** Return memoized readonly filter state for a raw filter expression. */
export function getCachedReadonlyFilterState(
    raw: string | undefined,
    ops: ReadonlyFilterOps
): ReadonlyFilterState {
    if (raw === undefined || raw === '') return EMPTY_STATE
    const cached = READONLY_FILTER_STATE_CACHE.get(raw)
    if (cached !== undefined) return cached
    const state = computeReadonlyFilterState(raw, ops)
    if (READONLY_FILTER_STATE_CACHE.size >= MAX_READONLY_FILTER_CACHE) {
        const oldestKey = READONLY_FILTER_STATE_CACHE.keys().next().value
        if (oldestKey !== undefined) READONLY_FILTER_STATE_CACHE.delete(oldestKey)
    }
    READONLY_FILTER_STATE_CACHE.set(raw, state)
    return state
}
