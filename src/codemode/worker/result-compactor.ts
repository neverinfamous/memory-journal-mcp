/**
 * Worker Result Compactor — compacts oversized structured payloads and enforces
 * the serialized egress byte boundary to prevent OOM and hard payload failures.
 */

import type { SandboxResult } from '../types.js'
import { unwrapResultProxy } from '../worker-result-proxy.js'
import { isCallable } from './result-proxy-aliases.js'
import { isCrossRealmError, safeFormatSandboxError } from './script-and-metadata-cache.js'

const MAX_COMPACTION_DEPTH = 6
const MAX_COMPACTION_NODES = 2_000
const COMPACTED_ARRAY_MAX_ITEMS = 20
const COMPACTED_ARRAY_TRIGGER_LENGTH = 25
const COMPACTED_OBJECT_MAX_KEYS = 100
const TRUNCATED_STRING_THRESHOLD_CHARS = 400
const TRUNCATED_STRING_PREVIEW_CHARS = 300

class CompactionBudgetExceeded extends Error {
    constructor() {
        super('Compaction node budget exceeded')
        this.name = 'CompactionBudgetExceeded'
    }
}

function consumeCompactionBudget(budget: { remaining: number }, count = 1): void {
    budget.remaining -= count
    if (budget.remaining < 0) {
        throw new CompactionBudgetExceeded()
    }
}

function compactOversizedArray(
    arr: unknown[],
    limitBytes: number,
    depth: number,
    seen: WeakSet<object>,
    budget: { remaining: number }
): unknown[] {
    const maxItems = arr.length > COMPACTED_ARRAY_TRIGGER_LENGTH ? COMPACTED_ARRAY_MAX_ITEMS : arr.length
    const compactedArr: unknown[] = []
    for (let i = 0; i < maxItems; i++) {
        const item: unknown = arr[i]
        if (typeof item === 'string' && item.length > TRUNCATED_STRING_THRESHOLD_CHARS) {
            consumeCompactionBudget(budget)
            compactedArr.push(
                `${item.slice(0, TRUNCATED_STRING_PREVIEW_CHARS)}... [truncated by Code Mode result size guardrail]`
            )
        } else {
            compactedArr.push(compactOversizedResult(item, limitBytes, depth + 1, seen, budget))
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

function compactOversizedObject(
    val: object,
    limitBytes: number,
    depth: number,
    seen: WeakSet<object>,
    budget: { remaining: number }
): Record<string, unknown> {
    const compactedObj: Record<string, unknown> = {}
    const keys = Object.keys(val)
    const maxKeys = keys.length > COMPACTED_OBJECT_MAX_KEYS ? COMPACTED_OBJECT_MAX_KEYS : keys.length
    for (let i = 0; i < maxKeys; i++) {
        const k = keys[i]
        if (k === undefined) continue
        if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k === 'toJSON') continue
        const v: unknown = Reflect.get(val, k)
        if (typeof v === 'function') continue
        if (typeof v === 'string' && v.length > TRUNCATED_STRING_THRESHOLD_CHARS) {
            consumeCompactionBudget(budget)
            compactedObj[k] =
                `${v.slice(0, TRUNCATED_STRING_PREVIEW_CHARS)}... [truncated by Code Mode result size guardrail]`
        } else if (typeof v === 'bigint') {
            consumeCompactionBudget(budget)
            compactedObj[k] = v.toString()
        } else if (typeof v === 'object' && v !== null) {
            compactedObj[k] = compactOversizedResult(v, limitBytes, depth + 1, seen, budget)
        } else {
            consumeCompactionBudget(budget)
            compactedObj[k] = v
        }
    }
    if (keys.length > maxKeys) {
        compactedObj['_omitted_keys_count'] = keys.length - maxKeys
    }
    if (depth === 0) {
        compactedObj['_compaction_notice'] =
            `⚠️ Result payload was automatically compacted because serialized payload exceeded the ${Math.round(limitBytes / 1024)}KB boundary. Pass 'max_result_size' in mj_execute_code (e.g. max_result_size: ${limitBytes * 2}) to retrieve full contents without truncation.`
    }
    return compactedObj
}

/**
 * Automatically compacts oversized structured result payloads (objects and collections)
 * so that queries returning large datasets (e.g. 50 entries with markdown content)
 * do not fail outright when exceeding the egress limit.
 *
 * Primitive strings and numbers are deliberately left uncompacted so that raw
 * string contract tests reject properly with structured aggregation guidance.
 */
export function compactOversizedResult(
    rawVal: unknown,
    limitBytes: number,
    depth = 0,
    seen = new WeakSet(),
    budget: { remaining: number } = { remaining: MAX_COMPACTION_NODES }
): unknown {
    consumeCompactionBudget(budget)
    const val = unwrapResultProxy(rawVal)
    if (typeof val === 'bigint') return val.toString()
    if (val === null || val === undefined || typeof val !== 'object') return val
    if (depth > MAX_COMPACTION_DEPTH) return '[MaxDepthExceeded]'
    if (seen.has(val)) return '[Circular]'
    seen.add(val)

    try {
        const toJsonFn: unknown = Reflect.get(val, 'toJSON')
        if (isCallable(toJsonFn)) {
            const converted = toJsonFn.call(val)
            if (converted !== val) {
                return compactOversizedResult(converted, limitBytes, depth + 1, seen, budget)
            }
        }
        if (isCrossRealmError(val)) {
            const errObj: Record<string, unknown> = {
                name: typeof val.name === 'string' ? val.name : 'Error',
                message: typeof val.message === 'string' ? val.message : String(val.message),
            }
            for (const k of Object.keys(val)) {
                if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k === 'toJSON') continue
                const errProp: unknown = Reflect.get(val, k)
                if (typeof errProp === 'function') continue
                errObj[k] = errProp
            }
            return compactOversizedObject(errObj, limitBytes, depth, seen, budget)
        }
        return Array.isArray(val)
            ? compactOversizedArray(val, limitBytes, depth, seen, budget)
            : compactOversizedObject(val, limitBytes, depth, seen, budget)
    } finally {
        seen.delete(val)
    }
}

/**
 * Attempts to replace an oversized object result with a compacted copy that fits the limit.
 * Returns true when the result was compacted successfully.
 */
function tryCompactIntoResult(result: SandboxResult, egressLimit: number): boolean {
    if (result.result === null || typeof result.result !== 'object') return false
    try {
        const compacted = compactOversizedResult(result.result, egressLimit)
        if (compacted === undefined) return false
        const compactedJson = JSON.stringify(compacted)
        const compactedBytes = Buffer.byteLength(compactedJson, 'utf8')
        if (compactedBytes > egressLimit) return false
        result.result = JSON.parse(compactedJson) as unknown
        result.success = true
        delete result.error
        return true
    } catch {
        return false
    }
}

function syncReplacerAncestors(
    holder: unknown,
    ancestors: object[],
    ancestorSet: Set<object>
): void {
    const unwrapped = unwrapResultProxy(holder)
    if (unwrapped === null || typeof unwrapped !== 'object') {
        ancestors.length = 0
        ancestorSet.clear()
        return
    }
    const holderIdx = ancestors.lastIndexOf(unwrapped)
    if (holderIdx === -1) {
        ancestors.length = 0
        ancestorSet.clear()
        return
    }
    while (ancestors.length > holderIdx + 1) {
        const popped = ancestors.pop()
        if (popped !== undefined) ancestorSet.delete(popped)
    }
}

function createEgressReplacer(
    egressLimit: number
): (this: unknown, _key: string, rawValue: unknown) => unknown {
    let bytes = 0
    const ancestors: object[] = []
    const ancestorSet = new Set<object>()

    return function (this: unknown, _key: string, rawValue: unknown): unknown {
        const value = unwrapResultProxy(rawValue)
        if (typeof value === 'object' && value !== null) {
            syncReplacerAncestors(this, ancestors, ancestorSet)
            if (ancestorSet.has(value)) {
                bytes += 12
                if (bytes > egressLimit) throw new Error(`EgressLimitExceeded:${bytes}`)
                return '[Circular]'
            }
            if (isCrossRealmError(value)) {
                const errName = typeof value.name === 'string' ? value.name : 'Error'
                const errMsg = typeof value.message === 'string' ? value.message : String(value.message)
                bytes += errName.length + errMsg.length + 24
                if (bytes > egressLimit) throw new Error(`EgressLimitExceeded:${bytes}`)
                const plainErr: Record<string, unknown> = { name: errName, message: errMsg }
                for (const k of Object.keys(value)) {
                    if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k === 'toJSON') continue
                    const errProp: unknown = Reflect.get(value, k)
                    if (typeof errProp === 'function') continue
                    plainErr[k] = errProp
                }
                ancestors.push(value, plainErr)
                ancestorSet.add(value)
                ancestorSet.add(plainErr)
                return plainErr
            }
            ancestors.push(value)
            ancestorSet.add(value)
            bytes += 5
        } else if (typeof value === 'string') {
            // Fast UTF-16 code unit lower-bound in replacer; exact UTF-8 byte length is checked once on resultJson
            bytes += value.length + 2
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            bytes += 8
        } else if (typeof value === 'bigint') {
            const str = value.toString()
            bytes += str.length + 2
            if (bytes > egressLimit) throw new Error(`EgressLimitExceeded:${bytes}`)
            return str
        } else {
            bytes += 5 // brackets/keys/null overhead
        }

        if (bytes > egressLimit) {
            throw new Error(`EgressLimitExceeded:${bytes}`)
        }
        return value
    }
}

function handleEgressSerializationFailure(
    err: unknown,
    result: SandboxResult,
    egressLimit: number
): void {
    if (err instanceof Error && err.message.startsWith('EgressLimitExceeded:')) {
        const actualBytesStr = err.message.split(':')[1]
        const actualBytes =
            actualBytesStr !== undefined ? Number(actualBytesStr) : egressLimit + 1
        const actualKb = (actualBytes / 1024).toFixed(1)

        if (!tryCompactIntoResult(result, egressLimit)) {
            result.success = false
            result.error = `🛠️ AUTONOMOUS HEALING: Output limit exceeded: Result serialization exceeded the ${Math.round(egressLimit / 1024)}KB boundary (Actual size: >${actualKb}KB). Please aggregate or filter your results to reduce the payload size, or pass 'max_result_size' parameter (in bytes) to accommodate larger payloads.`
            result.result = undefined
        }
        return
    }
    result.success = false
    const safeMsg = safeFormatSandboxError(err).message
    const fullError = `Result could not be serialized or exceeded memory limits: ${safeMsg}`
    result.error =
        fullError.length > MAX_EGRESS_ERROR_CHARS
            ? `${fullError.slice(0, MAX_EGRESS_ERROR_CHARS)}...[truncated]`
            : fullError
    result.result = undefined
}

const MAX_EGRESS_ERROR_CHARS = 16_384

/**
 * Enforces the egress byte limit during JSON serialization and applies
 * `compactOversizedResult` fallback when an object/array exceeds the boundary.
 */
export function serializeAndEnforceEgress(
    result: SandboxResult,
    maxResultSize?: number
): void {
    if (!result.success) {
        if (typeof result.error === 'string' && result.error.length > MAX_EGRESS_ERROR_CHARS) {
            result.error = `${result.error.slice(0, MAX_EGRESS_ERROR_CHARS)}...[truncated]`
        }
        if (typeof result.stack === 'string' && result.stack.length > MAX_EGRESS_ERROR_CHARS) {
            result.stack = `${result.stack.slice(0, MAX_EGRESS_ERROR_CHARS)}...[truncated]`
        }
        return
    }

    const egressLimit = maxResultSize ?? 100 * 1024
    const rootValue = unwrapResultProxy(result.result)

    if (egressLimit >= 32) {
        if (rootValue === null || rootValue === undefined || typeof rootValue === 'boolean') {
            return
        }
        if (typeof rootValue === 'number') {
            result.result = Number.isFinite(rootValue) ? rootValue : null
            return
        }
        if (typeof rootValue === 'string') {
            if (rootValue.length * 6 + 2 <= egressLimit) return
            const byteLength = Buffer.byteLength(JSON.stringify(rootValue), 'utf8')
            if (byteLength > egressLimit) {
                handleEgressSerializationFailure(
                    new Error(`EgressLimitExceeded:${byteLength}`),
                    result,
                    egressLimit
                )
            }
            return
        }
    }

    try {
        const resultJson = JSON.stringify(rootValue, createEgressReplacer(egressLimit))
        if (resultJson !== undefined) {
            const byteLength = Buffer.byteLength(resultJson, 'utf8')
            if (byteLength > egressLimit) {
                throw new Error(`EgressLimitExceeded:${byteLength}`)
            }
            // [SECURITY H5] Always round-trip through JSON.parse so VM objects with custom
            // toJSON(), stateful getters, or ArrayBuffer/Map values cannot smuggle unmeasured
            // multi-MB payloads over parentPort.postMessage structured clone.
            result.result = JSON.parse(resultJson) as unknown
        } else {
            result.result = undefined
        }
    } catch (err) {
        handleEgressSerializationFailure(err, result, egressLimit)
    }
}
