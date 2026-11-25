/**
 * Nested Code Mode payload extraction and natural-language synthesis helpers.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import * as vm from 'node:vm'
import { createNullProtoRecord, isRecord } from '../../utils/type-guards.js'
import type { SandboxResult } from '../types.js'
import { isCallable, isObjectOrFunction } from './result-proxy-aliases.js'
import { serializeAndEnforceEgress } from './result-compactor.js'
import {
    appendOptionalQuerySearchFields,
    normalizeUserContextPayload,
    parseByteSizeValue,
    parseStringContextPayload,
} from '../shared-context-parsers.js'

const NESTED_DISCRIMINATORS = ['action', 'operation', 'op', 'tool', 'method', 'function'] as const
const hasNestedDiscriminator = (arg: object): boolean =>
    NESTED_DISCRIMINATORS.some((k) => Reflect.get(arg, k) !== undefined)

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
        typeof codeProp === 'string' ? codeProp : typeof scriptProp === 'string' ? scriptProp : ''
    if (codeToExec !== '') return codeToExec
    if (hasNestedDiscriminator(arg)) return ''
    const queryProp = Reflect.get(arg, 'query') as unknown
    if (typeof queryProp === 'string' && queryProp.trim() !== '') return queryProp
    const hasEntryText =
        typeof Reflect.get(arg, 'content') === 'string' ||
        typeof Reflect.get(arg, 'text') === 'string' ||
        typeof Reflect.get(arg, 'description') === 'string' ||
        typeof Reflect.get(arg, 'title') === 'string'
    return hasEntryText ? null : ''
}

const SINGLE_IDENT_RE = /^[A-Za-z_$][\w$]*$/
const COLON_PROSE_RE = /^[A-Za-z0-9_-]+:\s+/
const JS_SYNTAX_PUNCT_RE = /[(.=[\];]/
const EXPLICIT_QUERY_CODE_RE = /^(?:return\s+|await\s+mj\.)/

export function isSyntacticallyValidJs(trimmed: string): boolean {
    if (trimmed === '' || SINGLE_IDENT_RE.test(trimmed)) return false
    if (COLON_PROSE_RE.test(trimmed) && !JS_SYNTAX_PUNCT_RE.test(trimmed)) return false
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

/** Extracts a nested `{ query: "..." }` search request when no `code`/`script`/discriminator is present. */
export function readNestedQuerySearch(
    arg: unknown
): ({ query: string; workspace_id?: string; project_number?: number; limit?: unknown } & Record<string, unknown>) | undefined {
    if (!isRecord(arg)) return undefined
    if (hasNestedDiscriminator(arg)) return undefined
    const codeProp = arg['code']
    const scriptProp = arg['script']
    if ((typeof codeProp === 'string' && codeProp.trim() !== '') || (typeof scriptProp === 'string' && scriptProp.trim() !== '')) {
        return undefined
    }
    const queryProp = arg['query']
    if (typeof queryProp !== 'string' || queryProp.trim() === '') return undefined
    const trimmedQuery = queryProp.trim()
    if (DANGEROUS_NESTED_QUERY_TOKEN_RE.test(trimmedQuery) || EXPLICIT_QUERY_CODE_RE.test(trimmedQuery)) return undefined

    const searchPayload: { query: string; workspace_id?: string; project_number?: number; limit?: unknown } & Record<string, unknown> = {
        query: queryProp,
    }
    const wsCandidates: unknown[] = [
        Reflect.get(arg, 'workspace_id'),
        Reflect.get(arg, 'workspaceId'),
        Reflect.get(arg, 'workspace'),
    ]
    const wsProp = wsCandidates.find((v): v is string => typeof v === 'string' && v.trim() !== '')
    if (wsProp !== undefined) searchPayload.workspace_id = wsProp.trim()
    const projCandidates: unknown[] = [Reflect.get(arg, 'project_number'), Reflect.get(arg, 'projectNumber')]
    const projProp = projCandidates.find(
        (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')
    )
    if (typeof projProp === 'number' && Number.isSafeInteger(projProp) && projProp > 0) searchPayload.project_number = projProp
    appendOptionalQuerySearchFields(searchPayload, arg)
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
    if (isObjectOrFunction(groupObj)) {
        const fn: unknown = Reflect.get(groupObj, method)
        if (isCallable(fn)) return fn(payload)
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
        effectiveUseTestDb && isRecord(payload)
            ? { ...payload, use_test_db: true }
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
            : typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim())
              ? Number(raw.trim())
              : Number.NaN
    if (!Number.isFinite(num) || num <= 0) return undefined
    const safeOuter =
        Number.isFinite(outerTimeoutMs) && outerTimeoutMs > 0 ? Math.max(1, Math.ceil(outerTimeoutMs)) : 1
    return Math.min(safeOuter, Math.max(1, Math.ceil(num)))
}

function isNestedPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Extracts and normalizes a `context` payload from nested `executeCode` arguments,
 * wrapping strings and arrays safely to match top-level `buildSandboxUserContext`.
 */
const MAX_NESTED_CONTEXT_BYTES = 128 * 1024

export function extractNestedContextRecord(
    argRec: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (argRec === undefined) return undefined
    const rawCtx = argRec['context']
    if (rawCtx === undefined || rawCtx === null) return undefined
    if (isNestedPlainRecord(rawCtx)) return { ...rawCtx }
    if (typeof rawCtx === 'string') {
        if (Buffer.byteLength(rawCtx, 'utf8') > MAX_NESTED_CONTEXT_BYTES) {
            throw new Error(`Nested executeCode context exceeds maximum ${String(MAX_NESTED_CONTEXT_BYTES)} bytes`)
        }
        return parseStringContextPayload(rawCtx)
    }
    return { value: rawCtx, raw: rawCtx }
}

/** Extracts trimmed non-empty `session_id` / `sessionId` from nested `executeCode` arguments. */
export function extractNestedSessionId(
    argRec: Record<string, unknown> | undefined
): string | undefined {
    if (argRec === undefined) return undefined
    const raw = argRec['session_id'] ?? argRec['sessionId']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
    const rawCtx = argRec['context']
    const ctx = isNestedPlainRecord(rawCtx)
        ? rawCtx
        : typeof rawCtx === 'string'
          ? parseStringContextPayload(rawCtx)
          : undefined
    if (ctx !== undefined) {
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

/** Enforces sandbox egress byte limits on nested `executeCode` shortcut return values. */
export function enforceNestedResultLimit(rawResult: unknown, maxResultSize: number | undefined): unknown {
    if (rawResult === undefined) return rawResult
    const effectiveLimit = maxResultSize ?? 100 * 1024
    const wrapper: SandboxResult = {
        success: true,
        result: rawResult,
        metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
    }
    serializeAndEnforceEgress(wrapper, effectiveLimit)
    if (!wrapper.success) {
        throw new Error(wrapper.error ?? 'Nested execution output limit exceeded')
    }
    return wrapper.result
}

/** True when a nested entry shortcut payload targets an existing entry for update. */
export function hasExplicitNestedEntryId(payload: unknown): boolean {
    if (!isNestedPlainRecord(payload)) return false
    const idVal = payload['entry_id'] ?? payload['entryId'] ?? payload['id']
    return idVal !== undefined && idVal !== null
}

const NESTED_OPT_CONFLICT_GROUPS: readonly (readonly string[])[] = [
    ['workspace_id', 'workspaceId', 'workspace', 'project_name', 'projectName'],
    ['project_number', 'projectNumber', 'project_id', 'projectId', 'project'],
    ['repo', 'repo_name', 'repoName', 'repository'],
    ['target_workspace_id', 'targetWorkspaceId'],
    ['readonly', 'read_only', 'readOnly'],
    ['dry_run', 'dryRun'],
    ['use_test_db', 'useTestDb'],
]

function firstDefinedGroupVal(rec: Record<string, unknown>, keys: readonly string[]): unknown {
    for (const k of keys) {
        if (rec[k] !== undefined) return rec[k]
    }
    return undefined
}

/** Merge two-arg nested `executeCode(payload, options)` objects while failing closed on conflicting scope or mode flags. */
export function mergeNestedArgAndOptions(
    argRec: Record<string, unknown>,
    optsRec: Record<string, unknown>
): { merged: Record<string, unknown> } | { error: string } {
    for (const group of NESTED_OPT_CONFLICT_GROUPS) {
        const left = firstDefinedGroupVal(argRec, group)
        const right = firstDefinedGroupVal(optsRec, group)
        if (left === undefined || right === undefined) continue
        const differs =
            typeof left === 'string' && typeof right === 'string'
                ? left.trim().toLowerCase() !== right.trim().toLowerCase()
                : left !== right
        if (differs) {
            return { error: `Conflicting nested executeCode '${group[0]}' between argument and options.` }
        }
    }
    const merged = createNullProtoRecord(argRec)
    for (const k of Object.keys(optsRec)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
        if (merged[k] === undefined && optsRec[k] !== undefined) merged[k] = optsRec[k]
    }
    return { merged }
}
