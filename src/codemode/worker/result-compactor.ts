/**
 * Worker Result Compactor — compacts oversized structured payloads and enforces
 * the serialized egress byte boundary to prevent OOM and hard payload failures.
 */

import type { SandboxResult } from '../types.js'

/**
 * Automatically compacts oversized structured result payloads (objects and collections)
 * so that queries returning large datasets (e.g. 50 entries with markdown content)
 * do not fail outright when exceeding the egress limit.
 *
 * Primitive strings and numbers are deliberately left uncompacted so that raw
 * string contract tests reject properly with structured aggregation guidance.
 */
export function compactOversizedResult(
    val: unknown,
    limitBytes: number,
    depth = 0,
    seen = new WeakSet()
): unknown {
    if (depth > 6 || val === null || val === undefined) {
        return val
    }
    if (typeof val !== 'object') {
        return val
    }
    if (seen.has(val)) {
        return '[Circular]'
    }
    seen.add(val)

    if (Array.isArray(val)) {
        const arr: unknown[] = val
        const maxItems = arr.length > 25 ? 20 : arr.length
        const compactedArr: unknown[] = []
        for (let i = 0; i < maxItems; i++) {
            const item: unknown = arr[i]
            if (typeof item === 'string' && item.length > 400) {
                compactedArr.push(
                    `${item.slice(0, 300)}... [truncated by Code Mode result size guardrail]`
                )
            } else {
                compactedArr.push(compactOversizedResult(item, limitBytes, depth + 1, seen))
            }
        }
        if (arr.length > maxItems) {
            compactedArr.push({
                _truncated: true,
                omitted_items_count: arr.length - maxItems,
                message: `⚠️ Array truncated from ${arr.length} to ${maxItems} items to fit within ${Math.round(limitBytes / 1024)}KB egress boundary. Pass 'max_result_size' parameter in mj_execute_code to retrieve full data.`,
            })
        }
        return compactedArr
    }

    const compactedObj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val)) {
        if (typeof v === 'string') {
            if (v.length > 400) {
                compactedObj[k] =
                    `${v.slice(0, 300)}... [truncated by Code Mode result size guardrail]`
            } else {
                compactedObj[k] = v
            }
        } else if (typeof v === 'object' && v !== null) {
            compactedObj[k] = compactOversizedResult(v, limitBytes, depth + 1, seen)
        } else {
            compactedObj[k] = v
        }
    }

    if (depth === 0) {
        compactedObj['_compaction_notice'] =
            `⚠️ Result payload was automatically compacted because serialized payload exceeded the ${Math.round(limitBytes / 1024)}KB boundary. Pass 'max_result_size' in mj_execute_code (e.g. max_result_size: ${limitBytes * 2}) to retrieve full contents without truncation.`
    }
    return compactedObj
}

/**
 * Enforces the egress byte limit during JSON serialization and applies
 * `compactOversizedResult` fallback when an object/array exceeds the boundary.
 */
export function serializeAndEnforceEgress(
    result: SandboxResult,
    maxResultSize?: number
): void {
    if (!result.success) return

    const egressLimit = maxResultSize ?? 100 * 1024

    try {
        let bytes = 0
        const cache = new Set()

        const resultJson = JSON.stringify(result.result, (_key: string, value: unknown) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value)) return '[Circular]'
                cache.add(value)
            }
            if (typeof value === 'string') {
                bytes += Buffer.byteLength(value, 'utf8') + 2 // include quotes
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                bytes += Buffer.byteLength(String(value), 'utf8')
            } else if (typeof value === 'bigint') {
                bytes += Buffer.byteLength(value.toString(), 'utf8') + 2 // Treat as string
                return value.toString()
            } else {
                bytes += 5 // brackets/keys/null overhead
            }

            if (bytes > egressLimit) {
                throw new Error(`EgressLimitExceeded:${bytes}`)
            }
            return value
        })

        if (resultJson !== undefined) {
            const byteLength = Buffer.byteLength(resultJson, 'utf8')
            if (byteLength > egressLimit) {
                throw new Error(`EgressLimitExceeded:${byteLength}`)
            }
            result.result = JSON.parse(resultJson) as unknown
        } else {
            result.result = undefined
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('EgressLimitExceeded:')) {
            const actualBytesStr = err.message.split(':')[1]
            const actualBytes =
                actualBytesStr !== undefined ? Number(actualBytesStr) : egressLimit + 1
            const actualKb = (actualBytes / 1024).toFixed(1)

            let compactedSuccessfully = false
            if (result.result !== null && typeof result.result === 'object') {
                try {
                    const compacted = compactOversizedResult(result.result, egressLimit)
                    if (compacted !== undefined) {
                        const compactedJson = JSON.stringify(compacted)
                        const compactedBytes = Buffer.byteLength(compactedJson, 'utf8')
                        if (compactedBytes <= egressLimit) {
                            result.result = JSON.parse(compactedJson) as unknown
                            result.success = true
                            delete result.error
                            compactedSuccessfully = true
                        }
                    }
                } catch {
                    compactedSuccessfully = false
                }
            }

            if (!compactedSuccessfully) {
                result.success = false
                result.error = `🛠️ AUTONOMOUS HEALING: Output limit exceeded: Result serialization exceeded the ${Math.round(egressLimit / 1024)}KB boundary (Actual size: >${actualKb}KB). Please aggregate or filter your results to reduce the payload size, or pass 'max_result_size' parameter (in bytes) to accommodate larger payloads.`
                result.result = undefined
            }
        } else {
            result.success = false
            result.error = `Result could not be serialized or exceeded memory limits: ${err instanceof Error ? err.message : String(err)}`
            result.result = undefined
        }
    }
}
