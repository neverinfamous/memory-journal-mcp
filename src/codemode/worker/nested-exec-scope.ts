/**
 * Nested Code Mode `executeCode` scope guardrails and argument/NL extraction helpers.
 * Worker-thread safe (no host DB or config-file imports).
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type * as vm from 'node:vm'
import { transformAutoReturn } from '../auto-return.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import { validateSandboxCode } from '../security.js'
import { hasUnbalancedClosingDelimiter, stripCommentsAndStrings } from '../security-stripper.js'
import { parseStringContextPayload } from '../shared-context-parsers.js'
import { runWithNestedRpcOverrides, type ScopedRpcOverrides } from './nested-exec-runner.js'
import { getOrCompileVmScript } from './script-and-metadata-cache.js'
import {
    dispatchSynthesizedNestedEntry,
    enforceNestedResultLimit,
    extractNestedAutoVersion,
    extractNestedContextRecord,
    extractNestedMaxResultSize,
    extractNestedSessionId,
    extractNestedTimeoutMs,
    hasExplicitNestedEntryId,
    invokeShimGroupMethod,
    mergeNestedSynthesizedScope,
    naturalLanguageEntry,
    raceWithSandboxTimeout,
    readExecutableCode,
    readNestedQuerySearch,
} from './nested-exec-payload.js'
import { resolveSnapshottedNestedArgs } from './nested-exec-snapshot-helpers.js'
import {
    isPlainRecord,
    isProjectStringValue,
    parseProjectNumberCandidate,
    readNarrowedWorkspace,
    uniqueWorkspaceForProjectNum,
    validateNestedExecScope,
} from './nested-exec-validation.js'

export { readExecutableCode, naturalLanguageEntry, validateNestedExecScope }

export interface NestedExecIsolationOverrides {
    timeoutMs?: number
    workspaceId?: string
    projectNumber?: number
    contextObj?: Record<string, unknown>
    sessionId?: string
    autoVersion?: boolean
    maxResultSize?: number
    nestedDepth?: number
}

export type RunIsolatedNestedFn = (
    wrapped: string,
    nestedReadonly: boolean,
    nestedDryRun: boolean,
    nestedUseTestDb: boolean,
    overrides?: NestedExecIsolationOverrides
) => Promise<unknown>

export interface SandboxExecutorOptions {
    shimMj: Record<string, unknown>
    vmContextRef: { current?: vm.Context }
    timeoutMs: number
    maxResultSize?: number | undefined
    readonlyMode: boolean | undefined
    dryRunMode: boolean | undefined
    useTestDbMode?: boolean | undefined
    pinnedWorkspaceRaw: unknown
    pinnedProjectRaw: unknown
    projectRegistryRaw: unknown
    runIsolatedNestedCode: RunIsolatedNestedFn
    activeTimers?: Set<NodeJS.Timeout>
    nestedDepth?: number
}

function resolveNestedNarrowedScope(
    argRec: Record<string, unknown> | undefined,
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    projectRegistryRaw: unknown
): { workspaceId?: string; projectNumber?: number } {
    if (
        argRec === undefined ||
        (pinnedWorkspace !== undefined && pinnedProjectNumber !== undefined)
    ) {
        return {}
    }
    const registry = readProjectRegistryPayload(projectRegistryRaw)
    const rawCtx = argRec['context']
    const ctxRec = isPlainRecord(rawCtx)
        ? rawCtx
        : typeof rawCtx === 'string'
          ? parseStringContextPayload(rawCtx)
          : undefined
    const sources = ctxRec !== undefined ? [argRec, ctxRec] : [argRec]
    let workspaceId =
        pinnedWorkspace === undefined ? readNarrowedWorkspace(sources, registry) : undefined

    let projectNumber: number | undefined
    if (pinnedProjectNumber === undefined) {
        for (const src of sources) {
            for (const key of ['project_number', 'projectNumber', 'project_id', 'projectId', 'project'] as const) {
                const rawProj = src[key]
                if (rawProj === undefined || rawProj === null || rawProj === '') continue
                if (key === 'project' && isProjectStringValue(rawProj)) continue
                const parsed = parseProjectNumberCandidate(rawProj, registry)
                if (parsed !== null) {
                    projectNumber = parsed
                    break
                }
            }
            if (projectNumber !== undefined) break
        }
        if (projectNumber === undefined && workspaceId !== undefined && workspaceId.toLowerCase() !== 'default') {
            const regProj = registry?.[workspaceId]?.project_number
            if (typeof regProj === 'number' && Number.isSafeInteger(regProj) && regProj > 0) {
                projectNumber = regProj
            }
        }
    }
    if (workspaceId === undefined && pinnedWorkspace === undefined) {
        const effectiveProj = projectNumber ?? pinnedProjectNumber
        if (effectiveProj !== undefined) {
            workspaceId = uniqueWorkspaceForProjectNum(effectiveProj, registry)
        }
    }

    return {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    }
}

function buildIsolationOverrides(
    argRec: Record<string, unknown> | undefined,
    timeoutMs: number,
    outerMaxResultSize: number | undefined,
    narrowed: { workspaceId?: string; projectNumber?: number }
): NestedExecIsolationOverrides | undefined {
    const nestedTimeout = extractNestedTimeoutMs(argRec, timeoutMs)
    const nestedContext = extractNestedContextRecord(argRec)
    const sessionId = extractNestedSessionId(argRec)
    const autoVersion = extractNestedAutoVersion(argRec)
    const maxResultSize = extractNestedMaxResultSize(argRec, outerMaxResultSize)
    const res: NestedExecIsolationOverrides = {
        ...(nestedTimeout !== undefined ? { timeoutMs: nestedTimeout } : {}),
        ...(narrowed.workspaceId !== undefined ? { workspaceId: narrowed.workspaceId } : {}),
        ...(narrowed.projectNumber !== undefined ? { projectNumber: narrowed.projectNumber } : {}),
        ...(nestedContext !== undefined ? { contextObj: nestedContext } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(autoVersion !== undefined ? { autoVersion } : {}),
        ...(maxResultSize !== undefined ? { maxResultSize } : {}),
    }
    return Object.keys(res).length > 0 ? res : undefined
}

interface ShortcutDispatchInput {
    arg: unknown
    argRec: Record<string, unknown> | undefined
    rawNestedCode: string | null
    narrowed: { workspaceId?: string; projectNumber?: number }
    pinnedWorkspace: string | undefined
    pinnedProjectNumber: number | undefined
    effectiveReadonly: boolean
    effectiveDryRun: boolean
    effectiveUseTestDb: boolean
    shimMj: Record<string, unknown>
    runIsolatedNestedCode: RunIsolatedNestedFn
    isolation: NestedExecIsolationOverrides | undefined
    currentDepth: number
}

const MAX_NESTED_FASTPATH_DEPTH = 4

function dispatchNestedEntryPayload(
    payload: unknown,
    opts: Pick<
        ShortcutDispatchInput,
        | 'shimMj'
        | 'runIsolatedNestedCode'
        | 'isolation'
        | 'effectiveReadonly'
        | 'effectiveDryRun'
        | 'effectiveUseTestDb'
        | 'currentDepth'
    >
): unknown {
    const isUpdate = hasExplicitNestedEntryId(payload)
    if (isUpdate && opts.isolation?.autoVersion === false) {
        return opts.runIsolatedNestedCode(
            '"use strict";\n(async () => {\nreturn await mj.admin.updateEntry(context.synthPayload)\n})()',
            opts.effectiveReadonly,
            opts.effectiveDryRun,
            opts.effectiveUseTestDb,
            {
                ...opts.isolation,
                nestedDepth: opts.currentDepth,
                contextObj: {
                    ...(opts.isolation.contextObj ?? {}),
                    synthPayload: payload,
                },
            }
        )
    }
    return invokeShimGroupMethod(
        opts.shimMj,
        isUpdate ? 'admin' : 'core',
        isUpdate ? 'updateEntry' : 'createEntry',
        payload
    )
}

async function tryDispatchNestedShortcut(
    input: ShortcutDispatchInput
): Promise<{ handled: true; value: unknown } | { handled: false; codeToExec: string; isQueryOnlyArg: boolean }> {
    const {
        arg, argRec, rawNestedCode, narrowed, pinnedWorkspace, pinnedProjectNumber,
        effectiveReadonly, effectiveDryRun, effectiveUseTestDb, shimMj,
    } = input
    const nestedQuerySearch = readNestedQuerySearch(arg)
    if (nestedQuerySearch !== undefined) {
        const effWs = narrowed.workspaceId ?? pinnedWorkspace
        const effProj = narrowed.projectNumber ?? pinnedProjectNumber
        const scopedSearch = {
            ...nestedQuerySearch,
            ...(nestedQuerySearch.workspace_id === undefined && effWs !== undefined
                ? { workspace_id: effWs }
                : {}),
            ...(nestedQuerySearch.project_number === undefined && effProj !== undefined
                ? { project_number: effProj }
                : {}),
            ...(effectiveUseTestDb ? { use_test_db: true } : {}),
        }
        return {
            handled: true,
            value: await Promise.resolve(invokeShimGroupMethod(shimMj, 'search', 'searchEntries', scopedSearch)),
        }
    }
    const isQueryOnlyArg =
        argRec !== undefined &&
        typeof argRec['code'] !== 'string' &&
        typeof argRec['script'] !== 'string' &&
        typeof argRec['query'] === 'string' &&
        argRec['query'].trim() !== ''
    const codeToExec = rawNestedCode
    const dispatchEntry = (payload: unknown): unknown => dispatchNestedEntryPayload(payload, input)
    if (codeToExec === null) {
        const scoped = mergeNestedSynthesizedScope(arg, argRec, narrowed, pinnedWorkspace, pinnedProjectNumber)
        return {
            handled: true,
            value: await Promise.resolve(
                dispatchSynthesizedNestedEntry(scoped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, dispatchEntry)
            ),
        }
    }
    if (codeToExec === '') {
        return { handled: true, value: { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' } }
    }
    if (!isQueryOnlyArg) {
        const natural = naturalLanguageEntry(codeToExec)
        if (natural !== undefined) {
            const scoped = mergeNestedSynthesizedScope(natural, argRec, narrowed, pinnedWorkspace, pinnedProjectNumber)
            return {
                handled: true,
                value: await Promise.resolve(
                    dispatchSynthesizedNestedEntry(scoped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, dispatchEntry)
                ),
            }
        }
    }
    return { handled: false, codeToExec, isQueryOnlyArg }
}

function validateAndWrapNestedCode(
    codeToExec: string,
    isQueryOnlyArg: boolean
): { ok: true; wrapped: string } | { ok: false; errorResult: Record<string, unknown> } {
    const transformedCode = transformAutoReturn(codeToExec)
    const validation = validateSandboxCode(transformedCode)
    if (!validation.valid) {
        return {
            ok: false,
            errorResult: { success: false, error: validation.errors.join('; '), code: 'SECURITY_VIOLATION' },
        }
    }
    if (hasUnbalancedClosingDelimiter(validation.strippedCode ?? stripCommentsAndStrings(transformedCode))) {
        return {
            ok: false,
            errorResult: {
                success: false,
                error: 'Security validation failed: unbalanced closing delimiter',
                code: 'SECURITY_VIOLATION',
            },
        }
    }
    if (isQueryOnlyArg && !/^(?:return\s+|await\s+mj\.)/.test(codeToExec.trim())) {
        return {
            ok: false,
            errorResult: {
                success: false,
                error: 'Nested executeCode query could not be executed as a read-only search.',
                code: 'VALIDATION_ERROR',
            },
        }
    }
    return { ok: true, wrapped: `"use strict";\n(async () => {\n${transformedCode}\n})()` }
}

interface ExecuteValidatedNestedParams {
    arg: unknown
    argRec: Record<string, unknown> | undefined
    rawNestedCode: string | null
    currentDepth: number
    timeoutMs: number
    maxResultSize: number | undefined
    readonlyMode: boolean | undefined
    dryRunMode: boolean | undefined
    useTestDbMode: boolean | undefined
    pinnedWorkspace: string | undefined
    pinnedProjectNumber: number | undefined
    projectRegistryRaw: unknown
    shimMj: Record<string, unknown>
    vmContextRef: { current?: vm.Context }
    runIsolatedNestedCode: RunIsolatedNestedFn
    activeTimers: Set<NodeJS.Timeout> | undefined
    fastPathDepthStorage: AsyncLocalStorage<number>
}

function buildFastPathRpcOverrides(
    p: ExecuteValidatedNestedParams,
    narrowed: { workspaceId?: string; projectNumber?: number },
    effectiveReadonly: boolean,
    effectiveDryRun: boolean,
    effectiveUseTestDb: boolean,
    isolation: NestedExecIsolationOverrides | undefined
): ScopedRpcOverrides | undefined {
    const ws = p.pinnedWorkspace ?? narrowed.workspaceId
    const proj = p.pinnedProjectNumber ?? narrowed.projectNumber
    const raw: ScopedRpcOverrides = {
        ...(effectiveReadonly ? { readonly: true } : {}),
        ...(effectiveDryRun ? { dryRun: true } : {}),
        ...(effectiveUseTestDb ? { useTestDb: true } : {}),
        ...(ws !== undefined ? { workspaceId: ws } : {}),
        ...(proj !== undefined ? { projectNumber: proj } : {}),
        ...(isolation?.sessionId !== undefined ? { sessionId: isolation.sessionId } : {}),
        ...(isolation?.autoVersion !== undefined ? { autoVersion: isolation.autoVersion } : {}),
    }
    return Object.keys(raw).length > 0 ? raw : undefined
}

async function runValidatedNestedCall(p: ExecuteValidatedNestedParams): Promise<unknown> {
    const scopeErr = validateNestedExecScope(
        p.argRec, p.pinnedWorkspace, p.pinnedProjectNumber, p.projectRegistryRaw
    )
    if (scopeErr !== null) return { success: false, error: scopeErr.error, code: 'VALIDATION_ERROR' }

    const effectiveReadonly = p.readonlyMode === true || p.argRec?.['readonly'] === true || p.argRec?.['read_only'] === true || p.argRec?.['readOnly'] === true
    const effectiveDryRun = p.dryRunMode === true || p.argRec?.['dry_run'] === true || p.argRec?.['dryRun'] === true
    const effectiveUseTestDb = p.useTestDbMode === true || p.argRec?.['use_test_db'] === true || p.argRec?.['useTestDb'] === true
    if (p.rawNestedCode !== null && p.rawNestedCode !== '' && Buffer.byteLength(p.rawNestedCode, 'utf-8') > 50 * 1024) {
        return { success: false, error: 'Code exceeds maximum length of 51200 bytes', code: 'SECURITY_VIOLATION' }
    }
    const narrowed = resolveNestedNarrowedScope(p.argRec, p.pinnedWorkspace, p.pinnedProjectNumber, p.projectRegistryRaw)
    const isolation = buildIsolationOverrides(p.argRec, p.timeoutMs, p.maxResultSize, narrowed)
    const fastPathRpcOverrides = buildFastPathRpcOverrides(
        p, narrowed, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, isolation
    )
    const shortcutTimeoutMs = isolation?.timeoutMs ?? p.timeoutMs
    const shortcutMaxResult = isolation?.maxResultSize ?? p.maxResultSize
    const shortcut = await runWithNestedRpcOverrides(fastPathRpcOverrides, () =>
        raceWithSandboxTimeout(
            tryDispatchNestedShortcut({
                arg: p.arg, argRec: p.argRec, rawNestedCode: p.rawNestedCode, narrowed,
                pinnedWorkspace: p.pinnedWorkspace, pinnedProjectNumber: p.pinnedProjectNumber,
                effectiveReadonly, effectiveDryRun, effectiveUseTestDb, shimMj: p.shimMj,
                runIsolatedNestedCode: p.runIsolatedNestedCode, isolation, currentDepth: p.currentDepth,
            }),
            shortcutTimeoutMs,
            p.activeTimers
        )
    )
    if (shortcut.handled) return enforceNestedResultLimit(shortcut.value, shortcutMaxResult)

    const compiled = validateAndWrapNestedCode(shortcut.codeToExec, shortcut.isQueryOnlyArg)
    if (!compiled.ok) return compiled.errorResult
    const currentVmCtx = p.vmContextRef.current
    if (currentVmCtx === undefined) return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }

    const escalates =
        (effectiveReadonly && p.readonlyMode !== true) ||
        (effectiveDryRun && p.dryRunMode !== true) ||
        (effectiveUseTestDb && p.useTestDbMode !== true)
    if (escalates || isolation !== undefined) {
        const escalatedOverrides: NestedExecIsolationOverrides | undefined =
            p.currentDepth > 0 || isolation !== undefined
                ? { ...(isolation ?? {}), nestedDepth: p.currentDepth }
                : undefined
        return p.runIsolatedNestedCode(
            compiled.wrapped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, escalatedOverrides
        )
    }
    const rawResult: unknown = await runWithNestedRpcOverrides(fastPathRpcOverrides, () =>
        p.fastPathDepthStorage.run(p.currentDepth + 1, () =>
            raceWithSandboxTimeout<unknown>(
                Promise.resolve(
                    getOrCompileVmScript(compiled.wrapped).runInContext(currentVmCtx, { timeout: p.timeoutMs })
                ),
                p.timeoutMs,
                p.activeTimers
            )
        )
    )
    return enforceNestedResultLimit(rawResult, p.maxResultSize)
}

/**
 * Builds the sandboxed nested `executeCode` dispatcher enforcing pinned scope,
 * readonly/dryRun/useTestDb invariants, and code-security checks before `vm.runInContext`.
 */
export function createSandboxExecutor(options: SandboxExecutorOptions): (...args: unknown[]) => Promise<unknown> {
    const {
        shimMj, vmContextRef, timeoutMs, maxResultSize, readonlyMode, dryRunMode, useTestDbMode,
        pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, runIsolatedNestedCode, activeTimers,
        nestedDepth,
    } = options
    const baseDepth = nestedDepth ?? 0
    const fastPathDepthStorage = new AsyncLocalStorage<number>()
    const pinnedWorkspace =
        typeof pinnedWorkspaceRaw === 'string' && pinnedWorkspaceRaw.trim() !== '' && pinnedWorkspaceRaw.trim() !== '*'
            ? pinnedWorkspaceRaw.trim()
            : undefined
    const pinnedProjectNumber =
        typeof pinnedProjectRaw === 'number' && Number.isSafeInteger(pinnedProjectRaw) && pinnedProjectRaw > 0
            ? pinnedProjectRaw
            : undefined

    return async (...rawArgs: unknown[]): Promise<unknown> => {
        const currentDepth = fastPathDepthStorage.getStore() ?? baseDepth
        if (currentDepth >= MAX_NESTED_FASTPATH_DEPTH) {
            throw new Error(
                `Nested executeCode exceeded maximum recursion depth of ${String(MAX_NESTED_FASTPATH_DEPTH)}`
            )
        }
        const snap = resolveSnapshottedNestedArgs(rawArgs)
        if ('error' in snap) return { success: false, error: snap.error, code: 'VALIDATION_ERROR' }
        return runValidatedNestedCall({
            arg: snap.arg,
            argRec: snap.argRec,
            rawNestedCode: readExecutableCode(snap.arg),
            currentDepth,
            timeoutMs,
            maxResultSize,
            readonlyMode,
            dryRunMode,
            useTestDbMode,
            pinnedWorkspace,
            pinnedProjectNumber,
            projectRegistryRaw,
            shimMj,
            vmContextRef,
            runIsolatedNestedCode,
            activeTimers,
            fastPathDepthStorage,
        })
    }
}
