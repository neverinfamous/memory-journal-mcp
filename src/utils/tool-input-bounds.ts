/**
 * Tool input element-count bounds helpers shared across server registration and
 * direct tool dispatchers without creating module cycles.
 */

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

function isByteBufferInstance(cur: object): cur is ArrayBuffer | SharedArrayBuffer {
    if (cur instanceof ArrayBuffer) return true
    return typeof SharedArrayBuffer !== 'undefined' && cur instanceof SharedArrayBuffer
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

/**
 * Counts input elements iteratively (cycle-safe via active-ancestor tracking so shared
 * DAG references count on every expansion, plus O(1) TypedArray/ArrayBuffer/Map/Set bounds)
 * and aborts as soon as `maxElements` is exceeded.
 */
export function exceedsMaxToolInputElements(value: unknown, maxElements: number): boolean {
    if (!Number.isFinite(maxElements) || maxElements < 0) return false
    const stack: unknown[] = [value]
    const ancestors: object[] = []
    const active = new WeakSet()
    let count = 0

    while (stack.length > 0) {
        const cur = stack.pop()
        if (cur === POP_ANCESTOR) {
            const exited = ancestors.pop()
            if (exited !== undefined) active.delete(exited)
            continue
        }
        if (cur === null || typeof cur !== 'object') {
            count++
            if (count > maxElements) return true
            continue
        }
        if (active.has(cur)) continue

        if (cur instanceof String || Object.prototype.toString.call(cur) === '[object String]') {
            count += 1 + (cur as { length: number }).length
            if (count > maxElements) return true
            continue
        }
        if (ArrayBuffer.isView(cur) || isByteBufferInstance(cur)) {
            count += 1 + cur.byteLength
            if (count > maxElements) return true
            continue
        }
        if (Array.isArray(cur)) {
            count += 1 + cur.length
            if (count > maxElements) return true
            pushObjectChildren(cur, stack, ancestors, active)
            const items: readonly unknown[] = cur
            for (const item of items) {
                if (item !== null && typeof item === 'object') stack.push(item)
            }
            continue
        }
        if (cur instanceof Map) {
            count += 1 + cur.size * 2
            if (count > maxElements) return true
            pushObjectChildren(cur, stack, ancestors, active)
            for (const [k, v] of cur.entries()) {
                if (k !== null && typeof k === 'object') stack.push(k)
                if (v !== null && typeof v === 'object') stack.push(v)
            }
            continue
        }
        if (cur instanceof Set) {
            count += 1 + cur.size
            if (count > maxElements) return true
            pushObjectChildren(cur, stack, ancestors, active)
            for (const item of cur.values()) {
                if (item !== null && typeof item === 'object') stack.push(item)
            }
            continue
        }

        const keys = Object.keys(cur)
        count += 1 + keys.length
        if (count > maxElements) return true
        pushObjectChildren(cur, stack, ancestors, active)
        const rec = cur as Record<string, unknown>
        for (const key of keys) {
            const val = rec[key]
            if (val !== null && typeof val === 'object') stack.push(val)
        }
    }
    return false
}
