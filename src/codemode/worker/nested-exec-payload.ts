/**
 * Nested Code Mode payload extraction and natural-language synthesis helpers.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import * as vm from 'node:vm'
import {
    normalizeUserContextPayload,
    parseByteSizeValue,
    parseStringContextPayload,
} from '../shared-context-parsers.js'

/**
 * Extracts executable JS code from nested `executeCode` arguments, returning `null`
 * only when explicit entry fields (`content`, `text`, `description`, `title`) indicate an entry payload.
 */
export function readExecutableCode(arg: unknown): string | null {
    if (typeof arg === 'string') return arg
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return ''
    const codeProp = Reflect.get(arg, 'code') as unknown
    const scriptProp = Reflect.get(arg, 'script') as unknown
    const codeToExec =
        typeof codeProp === 'string'
            ? codeProp
            : typeof scriptProp === 'string'
              ? scriptProp
              : ''
    if (codeToExec !== '') return codeToExec
    const queryProp = Reflect.get(arg, 'query') as unknown
    if (typeof queryProp === 'string' && queryProp.trim() !== '') {
        return queryProp
    }
    const hasEntryText =
        typeof Reflect.get(arg, 'content') === 'string' ||
        typeof Reflect.get(arg, 'text') === 'string' ||
        typeof Reflect.get(arg, 'description') === 'string' ||
        typeof Reflect.get(arg, 'title') === 'string'
    return hasEntryText ? null : ''
}

export function isSyntacticallyValidJs(trimmed: string): boolean {
    if (trimmed === '' || /^[A-Za-z_$][\w$]*$/.test(trimmed)) return false
    if (/^[A-Za-z0-9_-]+:\s+/.test(trimmed) && !/[(.=[\];]/.test(trimmed)) return false
    try {
        new vm.Script(trimmed)
        return true
    } catch {
        // Retry wrapped object literal syntax below
    }
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
    try {
        new vm.Script(`(${trimmed})`)
        return true
    } catch {
        return false
    }
}

const DANGEROUS_NESTED_QUERY_TOKEN_RE =
    /\b(?:process|require|eval|Function|Reflect|Proxy|global|globalThis|__proto__)\b/

/**
 * Extracts a nested `{ query: "..." }` search request when no explicit `code`/`script`
 * is present and the `query` text is not dangerous or an explicit `return` / `await mj.` snippet.
 */
export function readNestedQuerySearch(
    arg: unknown
): { query: string; workspace_id?: string; project_number?: number; limit?: number } | undefined {
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return undefined
    const codeProp = Reflect.get(arg, 'code') as unknown
    const scriptProp = Reflect.get(arg, 'script') as unknown
    if (typeof codeProp === 'string' && codeProp.trim() !== '') return undefined
    if (typeof scriptProp === 'string' && scriptProp.trim() !== '') return undefined
    const queryProp = Reflect.get(arg, 'query') as unknown
    if (typeof queryProp !== 'string' || queryProp.trim() === '') return undefined
    const trimmedQuery = queryProp.trim()
    if (
        DANGEROUS_NESTED_QUERY_TOKEN_RE.test(trimmedQuery) ||
        /^(?:return\s+|await\s+mj\.)/.test(trimmedQuery)
    ) {
        return undefined
    }

    const searchPayload: { query: string; workspace_id?: string; project_number?: number; limit?: number } = {
        query: queryProp,
    }
    const wsProp = (Reflect.get(arg, 'workspace_id') ?? Reflect.get(arg, 'workspaceId')) as unknown
    if (typeof wsProp === 'string' && wsProp.trim() !== '') {
        searchPayload.workspace_id = wsProp.trim()
    }
    const projProp = (Reflect.get(arg, 'project_number') ?? Reflect.get(arg, 'projectNumber')) as unknown
    if (typeof projProp === 'number' && Number.isSafeInteger(projProp) && projProp > 0) {
        searchPayload.project_number = projProp
    }
    const limitProp = Reflect.get(arg, 'limit') as unknown
    if (typeof limitProp === 'number' && Number.isSafeInteger(limitProp) && limitProp > 0) {
        searchPayload.limit = limitProp
    }
    return searchPayload
}

/**
 * Converts a plain natural-language prompt passed into nested `executeCode` into a technical note payload.
 */
export function naturalLanguageEntry(
    codeToExec: string
): { title: string; content: string; entry_type: string } | undefined {
    const trimmed = codeToExec.trim()
    const looksLikeCode = /[{}()=]/.test(trimmed)
    if (looksLikeCode) return undefined
    const isNaturalPrompt =
        /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(
            trimmed
        ) &&
        !/\b(const|let|var|function|return|await|async|for|if|try|while|switch|throw|class|import|export)\b|\bmj\./.test(
            trimmed
        )
    if (!(isNaturalPrompt || /^(?:create|add|new|record|log)?\s*entry\b/i.test(trimmed))) {
        return undefined
    }
    if (isSyntacticallyValidJs(trimmed)) return undefined
    const firstLine = (trimmed.split('\n')[0] ?? '')
        .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
        .replace(/[:.]+$/, '')
        .trim()
    const title = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
    return { title, content: trimmed, entry_type: 'technical_note' }
}

/**
 * Invokes a method on a shimmed `mj` namespace object when available.
 */
export function invokeShimGroupMethod(
    shimMj: Record<string, unknown>,
    group: string,
    method: string,
    payload: unknown
): unknown {
    const groupObj = shimMj[group]
    if ((typeof groupObj === 'object' && groupObj !== null) || typeof groupObj === 'function') {
        const fn = Reflect.get(groupObj, method) as unknown
        if (typeof fn === 'function') return (fn as (a: unknown) => unknown)(payload)
    }
    return undefined
}

/**
 * Dispatches a synthesized entry write inside nested `executeCode` after readonly/dry-run guards.
 */
export function dispatchSynthesizedNestedEntry(
    payload: unknown,
    effectiveReadonly: boolean,
    effectiveDryRun: boolean,
    effectiveUseTestDb: boolean,
    invokeCreateEntry: (p: unknown) => unknown
): unknown {
    if (effectiveReadonly) {
        return {
            success: false,
            error: 'Write operations are disabled in readonly mode',
            code: 'PERMISSION_DENIED',
        }
    }
    if (effectiveDryRun) {
        return {
            success: false,
            error: 'dry_run is not supported for synthesized entry writes inside nested execute_code',
            code: 'VALIDATION_ERROR',
        }
    }
    const nextPayload =
        effectiveUseTestDb && typeof payload === 'object' && payload !== null && !Array.isArray(payload)
            ? { ...(payload as Record<string, unknown>), use_test_db: true }
            : payload
    return invokeCreateEntry(nextPayload)
}

/**
 * Extracts and clamps nested `timeout` / `timeout_ms` / `timeoutMs` against the outer timeout budget.
 */
export function extractNestedTimeoutMs(
    argRec: Record<string, unknown> | undefined,
    outerTimeoutMs: number
): number | undefined {
    if (argRec === undefined) return undefined
    const raw = argRec['timeout'] ?? argRec['timeout_ms'] ?? argRec['timeoutMs']
    const num =
        typeof raw === 'number'
            ? raw
            : typeof raw === 'string' && raw.trim() !== ''
              ? Number(raw.trim())
              : Number.NaN
    if (!Number.isFinite(num) || num <= 0) return undefined
    return Math.min(outerTimeoutMs, num)
}

function isNestedPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Extracts and normalizes a `context` payload from nested `executeCode` arguments,
 * wrapping strings and arrays safely to match top-level `buildSandboxUserContext`.
 */
export function extractNestedContextRecord(
    argRec: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (argRec === undefined) return undefined
    const rawCtx = argRec['context']
    if (rawCtx === undefined || rawCtx === null) return undefined
    if (isNestedPlainRecord(rawCtx)) return { ...rawCtx }
    if (typeof rawCtx === 'string') return parseStringContextPayload(rawCtx)
    return { value: rawCtx, raw: rawCtx }
}

/** Extracts trimmed non-empty `session_id` / `sessionId` from nested `executeCode` arguments. */
export function extractNestedSessionId(
    argRec: Record<string, unknown> | undefined
): string | undefined {
    if (argRec === undefined) return undefined
    const raw = argRec['session_id'] ?? argRec['sessionId']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
    const ctx = argRec['context']
    if (isNestedPlainRecord(ctx)) {
        const ctxRaw = ctx['session_id'] ?? ctx['sessionId']
        if (typeof ctxRaw === 'string' && ctxRaw.trim() !== '') return ctxRaw.trim()
    }
    return undefined
}

/** Extracts boolean `auto_version` / `autoVersion` from nested `executeCode` arguments when provided. */
export function extractNestedAutoVersion(
    argRec: Record<string, unknown> | undefined
): boolean | undefined {
    if (argRec === undefined) return undefined
    if (typeof argRec['auto_version'] === 'boolean') return argRec['auto_version']
    if (typeof argRec['autoVersion'] === 'boolean') return argRec['autoVersion']
    return undefined
}

/** Extracts nested `max_result_size*` (or `_kb`) bounds, monotonically clamped to outer limit when set. */
const DEFAULT_NESTED_MAX_RESULT_SIZE = 100 * 1024
const ABSOLUTE_MAX_RESULT_SIZE = 50 * 1024 * 1024

export function extractNestedMaxResultSize(
    argRec: Record<string, unknown> | undefined,
    outerMaxResultSize?: number
): number | undefined {
    if (argRec === undefined) return undefined
    const nestedCtxRaw = argRec['context']
    const nestedCtx =
        isNestedPlainRecord(nestedCtxRaw) || typeof nestedCtxRaw === 'string'
            ? normalizeUserContextPayload(nestedCtxRaw)
            : undefined
    const direct = parseByteSizeValue(
        argRec['max_result_size'] ??
            argRec['maxResultSize'] ??
            argRec['max_result_size_bytes'] ??
            argRec['maxResultSizeBytes'] ??
            argRec['max_bytes'] ??
            argRec['maxBytes'] ??
            nestedCtx?.['max_result_size'] ??
            nestedCtx?.['maxResultSize'] ??
            nestedCtx?.['max_result_size_bytes'] ??
            nestedCtx?.['maxResultSizeBytes'] ??
            nestedCtx?.['max_bytes'] ??
            nestedCtx?.['maxBytes'],
        'b'
    )
    const kb = parseByteSizeValue(
        argRec['max_result_size_kb'] ??
            argRec['maxResultSizeKb'] ??
            nestedCtx?.['max_result_size_kb'] ??
            nestedCtx?.['maxResultSizeKb'],
        'kb'
    )
    const requested = direct ?? kb
    if (requested === undefined) return undefined
    const ceiling =
        outerMaxResultSize !== undefined && outerMaxResultSize > 0
            ? Math.min(outerMaxResultSize, ABSOLUTE_MAX_RESULT_SIZE)
            : DEFAULT_NESTED_MAX_RESULT_SIZE
    return Math.min(ceiling, requested)
}

const EXECUTE_CODE_CONTROL_KEYS = new Set([
    'repo',
    'repo_name',
    'repoName',
    'repository',
    'timeout',
    'timeout_ms',
    'timeoutMs',
    'max_result_size',
    'maxResultSize',
    'max_result_size_bytes',
    'maxResultSizeBytes',
    'max_result_size_kb',
    'maxResultSizeKb',
    'max_bytes',
    'maxBytes',
    'auto_version',
    'autoVersion',
    'readonly',
    'read_only',
    'readOnly',
    'dry_run',
    'dryRun',
    'use_test_db',
    'useTestDb',
])

/**
 * Merges narrowed `workspace_id`, `project_number`, and `session_id` from nested `argRec`
 * into synthesized entry payloads while stripping `executeCode`-only control keys (`repo`, timers, limits).
 */
export function mergeNestedSynthesizedScope(
    payload: unknown,
    argRec: Record<string, unknown> | undefined,
    narrowed: { workspaceId?: string; projectNumber?: number },
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined
): unknown {
    if (!isNestedPlainRecord(payload)) return payload
    const merged: Record<string, unknown> = { ...payload }
    for (const key of EXECUTE_CODE_CONTROL_KEYS) {
        if (key in merged) Reflect.deleteProperty(merged, key)
    }
    const effWs = narrowed.workspaceId ?? pinnedWorkspace
    if (effWs !== undefined && merged['workspace_id'] === undefined && merged['workspaceId'] === undefined) {
        merged['workspace_id'] = effWs
    }
    const effProj = narrowed.projectNumber ?? pinnedProjectNumber
    if (effProj !== undefined && merged['project_number'] === undefined && merged['projectNumber'] === undefined) {
        merged['project_number'] = effProj
    }
    const sessId = extractNestedSessionId(argRec)
    if (sessId !== undefined && merged['session_id'] === undefined && merged['sessionId'] === undefined) {
        merged['session_id'] = sessId
    }
    return merged
}

/** Races an async sandbox promise against a tracked `timeoutMs` timer. */
export async function raceWithSandboxTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    activeTimers?: Set<NodeJS.Timeout>
): Promise<T> {
    let handle: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        handle = setTimeout(() => {
            if (handle !== undefined) activeTimers?.delete(handle)
            reject(new Error(`Script execution timed out after ${String(timeoutMs)}ms`))
        }, timeoutMs)
        activeTimers?.add(handle)
    })
    try {
        return await Promise.race([promise, timeoutPromise])
    } finally {
        if (handle !== undefined) {
            clearTimeout(handle)
            activeTimers?.delete(handle)
        }
    }
}
