/**
 * Untrusted argument snapshot helpers for nested Code Mode `executeCode` invocations.
 * Extracted from `nested-exec-scope.ts` to keep both worker modules cleanly under 500 lines.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import { createNullProtoRecord } from '../../utils/type-guards.js'
import { mergeNestedArgAndOptions } from './nested-exec-payload.js'
import { isPlainRecord } from './nested-exec-validation.js'

const MAX_SNAPSHOT_DEPTH = 12
const MAX_SNAPSHOT_NODES = 2_000
const MAX_SNAPSHOT_BYTES = 128 * 1024

interface SnapshotBudget {
    remaining: number
    remainingBytes: number
}

function snapshotPlainRecord(
    val: Record<string, unknown>,
    depth: number,
    budget: SnapshotBudget,
    active: WeakSet<object>
): Record<string, unknown> {
    if (depth >= MAX_SNAPSHOT_DEPTH || budget.remaining <= 0) {
        throw new Error('Nested executeCode argument exceeds snapshot bounds')
    }
    if (active.has(val)) {
        throw new Error('Nested executeCode argument contains circular references')
    }
    const keys = Object.keys(val)
    if (keys.length > budget.remaining) {
        throw new Error('Nested executeCode argument exceeds snapshot bounds')
    }
    budget.remaining -= Math.max(1, keys.length)
    active.add(val)
    try {
        const snap = createNullProtoRecord()
        for (const key of keys) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
            snap[key] = snapshotUntrustedValue(val[key], depth + 1, budget, active)
        }
        return snap
    } finally {
        active.delete(val)
    }
}

function snapshotUntrustedValue(
    val: unknown,
    depth: number,
    budget: SnapshotBudget,
    active: WeakSet<object>
): unknown {
    if (typeof val === 'string') {
        budget.remainingBytes -= Buffer.byteLength(val, 'utf8')
        if (budget.remainingBytes < 0) {
            throw new Error('Nested executeCode argument exceeds snapshot byte limit')
        }
        return val
    }
    if (val === null || typeof val !== 'object') return val
    if (depth >= MAX_SNAPSHOT_DEPTH || budget.remaining <= 0) {
        throw new Error('Nested executeCode argument exceeds snapshot bounds')
    }
    if (active.has(val)) {
        throw new Error('Nested executeCode argument contains circular references')
    }
    if (Array.isArray(val)) {
        const len = val.length
        if (len > budget.remaining) {
            throw new Error('Nested executeCode argument exceeds snapshot bounds')
        }
        budget.remaining -= Math.max(1, len)
        active.add(val)
        try {
            const out: unknown[] = new Array<unknown>(len)
            for (let i = 0; i < len; i++) {
                out[i] = snapshotUntrustedValue(val[i], depth + 1, budget, active)
            }
            return out
        } finally {
            active.delete(val)
        }
    }
    if (!isPlainRecord(val)) return val
    return snapshotPlainRecord(val, depth, budget, active)
}

function snapshotUntrustedArg(arg: unknown): {
    safeArg: unknown
    argRec: Record<string, unknown> | undefined
} {
    if (typeof arg === 'string') {
        if (Buffer.byteLength(arg, 'utf8') > MAX_SNAPSHOT_BYTES) {
            throw new Error('Nested executeCode argument exceeds snapshot byte limit')
        }
        return { safeArg: arg, argRec: undefined }
    }
    if (!isPlainRecord(arg)) return { safeArg: arg, argRec: undefined }
    const snap = snapshotPlainRecord(
        arg,
        0,
        { remaining: MAX_SNAPSHOT_NODES, remainingBytes: MAX_SNAPSHOT_BYTES },
        new WeakSet()
    )
    return { safeArg: snap, argRec: snap }
}

/**
 * Snapshots untrusted nested `executeCode` arguments into bounded null-prototype clones
 * and merges optional two-argument `(codeOrPayload, options)` shapes.
 */
export function resolveSnapshottedNestedArgs(
    rawArgs: unknown[]
): { arg: unknown; argRec: Record<string, unknown> | undefined } | { error: string } {
    try {
        const snapped = snapshotUntrustedArg(rawArgs[0])
        let arg = snapped.safeArg
        let argRec = snapped.argRec
        const snappedOpts =
            rawArgs.length > 1 && rawArgs[1] !== undefined ? snapshotUntrustedArg(rawArgs[1]) : undefined
        if (typeof arg === 'string' && snappedOpts?.argRec !== undefined) {
            argRec = createNullProtoRecord({ ...snappedOpts.argRec, code: arg })
            arg = argRec
        } else if (argRec !== undefined && snappedOpts?.argRec !== undefined) {
            const res = mergeNestedArgAndOptions(argRec, snappedOpts.argRec)
            if ('error' in res) return { error: res.error }
            arg = argRec = res.merged
        }
        return { arg, argRec }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        return {
            error:
                msg !== ''
                    ? `Nested executeCode argument snapshot failed: ${msg}`
                    : 'Nested executeCode argument snapshot failed',
        }
    }
}
