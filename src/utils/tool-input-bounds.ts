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
    if (configured === undefined) return DEFAULT_MAX_TOOL_INPUT_ELEMENTS
    return configured === 0 || configured === Infinity ? Infinity : configured
}

/** Counts input elements iteratively (cycle-safe) and aborts as soon as `maxElements` is exceeded. */
export function exceedsMaxToolInputElements(value: unknown, maxElements: number): boolean {
    if (!Number.isFinite(maxElements) || maxElements < 0) return false
    const stack: unknown[] = [value]
    const seen = new WeakSet()
    let count = 0

    while (stack.length > 0) {
        const cur = stack.pop()
        if (cur === null || typeof cur !== 'object') {
            count++
            if (count > maxElements) return true
            continue
        }
        if (seen.has(cur)) continue
        seen.add(cur)

        if (Array.isArray(cur)) {
            count++
            if (count > maxElements) return true
            for (const item of cur) {
                stack.push(item)
            }
            continue
        }

        const keys = Object.keys(cur)
        count += 1 + keys.length
        if (count > maxElements) return true
        const rec = cur as Record<string, unknown>
        for (const key of keys) {
            stack.push(rec[key])
        }
    }
    return false
}
