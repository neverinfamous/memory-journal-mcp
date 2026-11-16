/**
 * Nested Code Mode payload extraction and natural-language synthesis helpers.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import * as vm from 'node:vm'

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
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                new vm.Script(`(${trimmed})`)
                return true
            } catch {
                return false
            }
        }
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
    if (typeof projProp === 'number' && Number.isInteger(projProp) && projProp > 0) {
        searchPayload.project_number = projProp
    }
    const limitProp = Reflect.get(arg, 'limit') as unknown
    if (typeof limitProp === 'number' && Number.isInteger(limitProp) && limitProp > 0) {
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
    if (isSyntacticallyValidJs(trimmed)) return undefined
    const isNaturalPrompt =
        /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(
            trimmed
        ) &&
        !/\b(const|let|var|function|return|await|async|for|if|try|while|switch|throw|class|import|export)\b|\bmj\./.test(
            trimmed
        )
    const looksLikeCode = /[{}()=]/.test(trimmed)
    if (
        looksLikeCode ||
        !(isNaturalPrompt || /^(?:create|add|new|record|log)?\s*entry\b/i.test(trimmed))
    ) {
        return undefined
    }
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

/**
 * Extracts a plain-object `context` payload from nested `executeCode` arguments when provided.
 */
export function extractNestedContextRecord(
    argRec: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (argRec === undefined) return undefined
    const rawCtx = argRec['context']
    if (typeof rawCtx !== 'object' || rawCtx === null || Array.isArray(rawCtx)) return undefined
    return rawCtx as Record<string, unknown>
}
