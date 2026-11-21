/**
 * Tool input element-count bounds helpers shared across server registration and
 * direct tool dispatchers without creating module cycles.
 */

import * as utilTypes from 'node:util/types'

/**
 * Default maximum number of array elements and object properties allowed across a
 * single tool input payload before Zod validation runs.
 */
export const DEFAULT_MAX_TOOL_INPUT_ELEMENTS = 25_000

/**
 * Resolves the configured `maxToolInputElements` option into the value passed to `McpServer`.
 * - `undefined` -> `DEFAULT_MAX_TOOL_INPUT_ELEMENTS` (25,000)
 * - `0` or `Infinity` -> `Infinity` (disables the element limit check)
 * - positive number -> passed through as-is
 */
export function resolveEffectiveMaxToolInputElements(configured: number | undefined): number {
    if (configured === undefined || Number.isNaN(configured) || configured < 0) {
        return DEFAULT_MAX_TOOL_INPUT_ELEMENTS
    }
    return configured === 0 || configured === Infinity ? Infinity : configured
}

const POP_ANCESTOR = Symbol('popAncestor')
const CANONICAL_INDEX_RE = /^(?:0|[1-9]\d{0,9})$/

const mapSizeDesc = Object.getOwnPropertyDescriptor(Map.prototype, 'size')
const setSizeDesc = Object.getOwnPropertyDescriptor(Set.prototype, 'size')
const typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype) as object
const typedArrayLengthDesc = Object.getOwnPropertyDescriptor(typedArrayProto, 'length')
const byteLengthDescriptors = [
    Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength'),
    Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength'),
    typeof SharedArrayBuffer !== 'undefined'
        ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')
        : undefined,
] as const

function tryReadTypedArrayLength(cur: object): number | null {
    if (!utilTypes.isTypedArray(cur) || typedArrayLengthDesc === undefined) return null
    try {
        const len: unknown = typedArrayLengthDesc.get?.call(cur)
        return typeof len === 'number' ? safeNonNegativeInt(len) : null
    } catch {
        return null
    }
}

function safeNonNegativeInt(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
    return Math.trunc(value)
}

function tryReadBoxedStringLength(cur: object): number | null {
    if (!utilTypes.isStringObject(cur)) return null
    try {
        const primitive = String.prototype.valueOf.call(cur)
        return typeof primitive === 'string' ? primitive.length : null
    } catch {
        return null
    }
}

function tryReadByteBufferLength(cur: object): number | null {
    if (!utilTypes.isDataView(cur) && !utilTypes.isAnyArrayBuffer(cur)) return null
    for (const desc of byteLengthDescriptors) {
        if (desc === undefined) continue
        try {
            const len: unknown = desc.get?.call(cur)
            if (typeof len === 'number') return safeNonNegativeInt(len)
        } catch {
            // Internal slot mismatch; try next byte-backed intrinsic
        }
    }
    return null
}

function tryReadAuthenticMap(cur: object): { size: number; entries: IterableIterator<[unknown, unknown]> } | null {
    if (!utilTypes.isMap(cur) || mapSizeDesc === undefined) return null
    try {
        const rawSize: unknown = mapSizeDesc.get?.call(cur)
        if (typeof rawSize !== 'number') return null
        return { size: safeNonNegativeInt(rawSize), entries: Map.prototype.entries.call(cur) }
    } catch {
        return null
    }
}

function tryReadAuthenticSet(cur: object): { size: number; values: IterableIterator<unknown> } | null {
    if (!utilTypes.isSet(cur) || setSizeDesc === undefined) return null
    try {
        const rawSize: unknown = setSizeDesc.get?.call(cur)
        if (typeof rawSize !== 'number') return null
        return { size: safeNonNegativeInt(rawSize), values: Set.prototype.values.call(cur) }
    } catch {
        return null
    }
}

function pushOwnObjectKeys(cur: object, stack: unknown[], skipArrayIndicesBelow?: number): number {
    const keys = Object.keys(cur)
    const rec = cur as Record<string, unknown>
    let extraCount = 0
    for (const key of keys) {
        if (skipArrayIndicesBelow !== undefined && CANONICAL_INDEX_RE.test(key)) {
            const idx = Number(key)
            if (idx < skipArrayIndicesBelow) continue
        }
        extraCount++
        const val = rec[key]
        if (val !== null && typeof val === 'object') stack.push(val)
    }
    return extraCount
}

function pushObjectChildren(
    cur: object,
    stack: unknown[],
    ancestors: object[],
    active: WeakSet<object>
): void {
    active.add(cur)
    ancestors.push(cur)
    stack.push(POP_ANCESTOR)
}

function visitInputContainerNode(
    cur: object,
    maxElements: number,
    state: { count: number },
    stack: unknown[],
    ancestors: object[],
    active: WeakSet<object>
): boolean {
    if (Array.isArray(cur)) {
        const arrLen = safeNonNegativeInt(cur.length)
        state.count += 1 + arrLen
        if (state.count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        state.count += pushOwnObjectKeys(cur, stack, arrLen)
        if (state.count > maxElements) return true
        const arr = cur as readonly unknown[]
        for (let i = 0; i < arrLen; i++) {
            if (!Object.hasOwn(arr, i)) continue
            const item = arr[i]
            if (item !== null && typeof item === 'object') stack.push(item)
        }
        return false
    }
    const boxedStrLen = tryReadBoxedStringLength(cur)
    if (boxedStrLen !== null) {
        state.count += 1 + boxedStrLen
        if (state.count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        state.count += pushOwnObjectKeys(cur, stack, boxedStrLen)
        return state.count > maxElements
    }
    const typedLen = tryReadTypedArrayLength(cur)
    if (typedLen !== null) {
        state.count += 1 + typedLen
        if (state.count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        state.count += pushOwnObjectKeys(cur, stack, typedLen)
        return state.count > maxElements
    }
    const byteLen = tryReadByteBufferLength(cur)
    if (byteLen !== null) {
        state.count += 1 + byteLen
        if (state.count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        state.count += pushOwnObjectKeys(cur, stack)
        return state.count > maxElements
    }
    const mapData = tryReadAuthenticMap(cur)
    if (mapData !== null) {
        state.count += 1 + mapData.size * 2
        if (state.count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        state.count += pushOwnObjectKeys(cur, stack)
        if (state.count > maxElements) return true
        for (const [k, v] of mapData.entries) {
            if (k !== null && typeof k === 'object') stack.push(k)
            if (v !== null && typeof v === 'object') stack.push(v)
        }
        return false
    }
    const setData = tryReadAuthenticSet(cur)
    if (setData !== null) {
        state.count += 1 + setData.size
        if (state.count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        state.count += pushOwnObjectKeys(cur, stack)
        if (state.count > maxElements) return true
        for (const item of setData.values) {
            if (item !== null && typeof item === 'object') stack.push(item)
        }
        return false
    }
    pushObjectChildren(cur, stack, ancestors, active)
    state.count += 1 + pushOwnObjectKeys(cur, stack)
    return state.count > maxElements
}

/**
 * Counts input elements iteratively (cycle-safe via active-ancestor tracking so shared
 * DAG references count on every expansion, plus O(1) internal-slot brand-checked
 * TypedArray/ArrayBuffer/Map/Set/String/Array expando bounds) and aborts above `maxElements`.
 */
export function exceedsMaxToolInputElements(value: unknown, maxElements: number): boolean {
    if (!Number.isFinite(maxElements) || maxElements < 0) return false
    const stack: unknown[] = [value]
    const ancestors: object[] = []
    const active = new WeakSet()
    const state = { count: 0 }

    while (stack.length > 0) {
        const cur = stack.pop()
        if (cur === POP_ANCESTOR) {
            const exited = ancestors.pop()
            if (exited !== undefined) active.delete(exited)
            continue
        }
        if (cur === null || typeof cur !== 'object') {
            state.count++
            if (state.count > maxElements) return true
            continue
        }
        if (active.has(cur)) continue
        if (visitInputContainerNode(cur, maxElements, state, stack, ancestors, active)) {
            return true
        }
    }
    return false
}
