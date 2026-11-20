/**
 * Worker Script & Metadata Cache — caches compiled `vm.Script` instances and
 * retains unchanged method/schema metadata across warm worker reuse.
 *
 * [BOUNDARY] Imports `node:vm` ONLY so `dist/worker-script.js` stays free of external deps.
 */

import * as vm from 'node:vm'
import type { MessagePort } from 'node:worker_threads'
import type { SandboxResult } from '../types.js'

export interface ExecuteWorkerMessage {
    type: 'EXECUTE'
    id: number
    code: string
    methodList?: Record<string, string[]>
    schemaList?: Record<string, Record<string, string>>
    timeoutMs?: number
    maxResultSize?: number
    rpcPort: MessagePort
    contextObj?: Record<string, unknown>
    readonlyMode?: boolean
    dryRunMode?: boolean
    useTestDbMode?: boolean
}

export function isExecuteMessage(msg: unknown): msg is ExecuteWorkerMessage {
    return (
        msg !== null &&
        msg !== undefined &&
        typeof msg === 'object' &&
        'type' in msg &&
        Reflect.get(msg, 'type') === 'EXECUTE'
    )
}

const MAX_ERROR_STRING_CHARS = 16_384

function boundErrorText(text: string): string {
    return text.length > MAX_ERROR_STRING_CHARS
        ? `${text.slice(0, MAX_ERROR_STRING_CHARS)}...[truncated]`
        : text
}

/**
 * Safely extracts error message and stack without throwing on `Object.create(null)` rejection values
 * and caps error/stack payload sizes prior to structured-clone egress.
 */
export function safeFormatSandboxError(reason: unknown): { message: string; stack?: string } {
    if (reason instanceof Error) {
        let message: string
        try {
            message = typeof reason.message === 'string' ? reason.message : String(reason.message)
        } catch {
            message = 'Error'
        }
        let stack: string | undefined
        try {
            if (typeof reason.stack === 'string') stack = boundErrorText(reason.stack)
        } catch {
            stack = undefined
        }
        return { message: boundErrorText(message), ...(stack !== undefined ? { stack } : {}) }
    }
    try {
        return { message: boundErrorText(String(reason)) }
    } catch {
        return { message: 'Unknown non-primitive sandbox error' }
    }
}

export function formatVmErrorResult(
    err: unknown,
    startTime: number,
    startCpu: NodeJS.CpuUsage
): SandboxResult {
    const endTime = performance.now()
    const endCpu = process.cpuUsage(startCpu)
    const formatted = safeFormatSandboxError(err)
    let message = formatted.message
    if (
        message.includes('missing ) after argument list') ||
        message.includes('is not a function') ||
        message.includes('Invalid or unexpected token') ||
        message.includes('Unexpected token') ||
        message.includes('Unexpected identifier') ||
        message.includes('Cannot use import statement')
    ) {
        message = boundErrorText(
            `🛠️ AUTONOMOUS HEALING: Syntax error in Code Mode execution (${message}). Code Mode requires valid JavaScript code (e.g., 'return await mj.core.getRecentEntries({ limit: 10 })' or 'return await mj.core.createEntry(...)'), not raw SQL statements or unquoted text.\n\n💡 Tip: When querying the journal, use Code Mode methods like 'return await mj.core.getRecentEntries({ limit: 10 })' or 'return await mj.search.searchEntries({ query: "..." })'. When passing long multi-line strings or markdown with embedded quotes/backticks, pass them safely via the \`context\` parameter and reference them as \`context.myParam\`.`
        )
    }
    return {
        success: false,
        error: message,
        metrics: {
            wallTimeMs: Math.round(endTime - startTime),
            cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1000),
            memoryUsedMb: 0,
        },
    }
}

const MAX_COMPILED_SCRIPTS = 64
const compiledScriptCache = new Map<string, vm.Script>()

let cachedMethodList: Record<string, string[]> = Object.freeze({})
let cachedSchemaList: Record<string, Record<string, string>> | undefined

function freezeMethodList(raw: Record<string, string[]>): Record<string, string[]> {
    const frozen: Record<string, string[]> = {}
    for (const [group, methods] of Object.entries(raw)) {
        const copy: string[] = Array.isArray(methods) ? [...methods] : []
        Object.freeze(copy)
        frozen[group] = copy
    }
    return Object.freeze(frozen)
}

function freezeSchemaList(
    raw: Record<string, Record<string, string>> | undefined
): Record<string, Record<string, string>> | undefined {
    if (raw === undefined) return undefined
    const frozen: Record<string, Record<string, string>> = {}
    for (const [group, schemas] of Object.entries(raw)) {
        frozen[group] = Object.freeze({ ...schemas })
    }
    return Object.freeze(frozen)
}

export interface WorkerExecuteMetadataMsg {
    methodList?: Record<string, string[]>
    schemaList?: Record<string, Record<string, string>>
}

/**
 * Retrieve a cached compiled `vm.Script` for `wrappedSource` (LRU capacity 64),
 * or compile and insert it when absent.
 */
export function getOrCompileVmScript(wrappedSource: string): vm.Script {
    const cached = compiledScriptCache.get(wrappedSource)
    if (cached !== undefined) {
        compiledScriptCache.delete(wrappedSource)
        compiledScriptCache.set(wrappedSource, cached)
        return cached
    }
    const script = new vm.Script(wrappedSource, {
        filename: 'codemode-execution.js',
    })
    if (compiledScriptCache.size >= MAX_COMPILED_SCRIPTS) {
        const oldestKey = compiledScriptCache.keys().next().value
        if (oldestKey !== undefined) {
            compiledScriptCache.delete(oldestKey)
        }
    }
    compiledScriptCache.set(wrappedSource, script)
    return script
}

/**
 * Resolve execution `methodList` and `schemaList`, freezing and retaining unchanged metadata
 * on warm worker `EXECUTE` messages so untrusted VM code cannot mutate shared cache arrays.
 */
export function resolveWorkerMetadata(msg: WorkerExecuteMetadataMsg): {
    methodList: Record<string, string[]>
    schemaList: Record<string, Record<string, string>> | undefined
} {
    if ('methodList' in msg && msg.methodList !== undefined) {
        cachedMethodList = freezeMethodList(msg.methodList)
    }
    if ('schemaList' in msg) {
        cachedSchemaList = freezeSchemaList(msg.schemaList)
    }
    return {
        methodList: cachedMethodList,
        schemaList: cachedSchemaList,
    }
}
