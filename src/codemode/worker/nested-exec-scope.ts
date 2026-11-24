/**
 * Nested Code Mode `executeCode` scope guardrails and argument/NL extraction helpers.
 * Worker-thread safe (no host DB or config-file imports).
 */

import type * as vm from 'node:vm'
import { transformAutoReturn } from '../auto-return.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import { validateSandboxCode } from '../security.js'
import { hasUnbalancedClosingDelimiter, stripCommentsAndStrings } from '../security-stripper.js'
import { parseStringContextPayload } from '../shared-context-parsers.js'
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
    let activeFastPathDepth = 0
    const pinnedWorkspace =
        typeof pinnedWorkspaceRaw === 'string' && pinnedWorkspaceRaw.trim() !== '' && pinnedWorkspaceRaw.trim() !== '*'
            ? pinnedWorkspaceRaw.trim()
            : undefined
    const pinnedProjectNumber =
        typeof pinnedProjectRaw === 'number' && Number.isSafeInteger(pinnedProjectRaw) && pinnedProjectRaw > 0
            ? pinnedProjectRaw
            : undefined

    return async (...rawArgs: unknown[]): Promise<unknown> => {
        if (baseDepth + activeFastPathDepth >= MAX_NESTED_FASTPATH_DEPTH) {
            throw new Error(
                `Nested executeCode exceeded maximum recursion depth of ${String(MAX_NESTED_FASTPATH_DEPTH)}`
            )
        }
        const snap = resolveSnapshottedNestedArgs(rawArgs)
        if ('error' in snap) return { success: false, error: snap.error, code: 'VALIDATION_ERROR' }
        const { arg, argRec } = snap
        const scopeErr = validateNestedExecScope(argRec, pinnedWorkspace, pinnedProjectNumber, projectRegistryRaw)
        if (scopeErr !== null) return { success: false, error: scopeErr.error, code: 'VALIDATION_ERROR' }

        const effectiveReadonly = readonlyMode === true || argRec?.['readonly'] === true || argRec?.['read_only'] === true || argRec?.['readOnly'] === true
        const effectiveDryRun = dryRunMode === true || argRec?.['dry_run'] === true || argRec?.['dryRun'] === true
        const effectiveUseTestDb = useTestDbMode === true || argRec?.['use_test_db'] === true || argRec?.['useTestDb'] === true
        const rawNestedCode = readExecutableCode(arg)
        if (rawNestedCode !== null && rawNestedCode !== '' && Buffer.byteLength(rawNestedCode, 'utf-8') > 50 * 1024) {
            return { success: false, error: 'Code exceeds maximum length of 51200 bytes', code: 'SECURITY_VIOLATION' }
        }
        const narrowed = resolveNestedNarrowedScope(argRec, pinnedWorkspace, pinnedProjectNumber, projectRegistryRaw)
        const isolation = buildIsolationOverrides(argRec, timeoutMs, maxResultSize, narrowed)
        const shortcutTimeoutMs = isolation?.timeoutMs ?? timeoutMs
        const shortcutMaxResult = isolation?.maxResultSize ?? maxResultSize
        const shortcut = await raceWithSandboxTimeout(
            tryDispatchNestedShortcut({
                arg, argRec, rawNestedCode, narrowed, pinnedWorkspace, pinnedProjectNumber,
                effectiveReadonly, effectiveDryRun, effectiveUseTestDb, shimMj,
                runIsolatedNestedCode, isolation,
            }),
            shortcutTimeoutMs,
            activeTimers
        )
        if (shortcut.handled) return enforceNestedResultLimit(shortcut.value, shortcutMaxResult)

        const compiled = validateAndWrapNestedCode(shortcut.codeToExec, shortcut.isQueryOnlyArg)
        if (!compiled.ok) return compiled.errorResult
        if (vmContextRef.current === undefined) return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }

        const escalates =
            (effectiveReadonly && readonlyMode !== true) ||
            (effectiveDryRun && dryRunMode !== true) ||
            (effectiveUseTestDb && useTestDbMode !== true)
        if (escalates || isolation !== undefined) {
            return runIsolatedNestedCode(compiled.wrapped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, isolation)
        }
        activeFastPathDepth++
        try {
            const rawResult: unknown = await raceWithSandboxTimeout<unknown>(
                Promise.resolve(
                    getOrCompileVmScript(compiled.wrapped).runInContext(vmContextRef.current, { timeout: timeoutMs })
                ),
                timeoutMs,
                activeTimers
            )
            return enforceNestedResultLimit(rawResult, maxResultSize)
        } finally {
            activeFastPathDepth--
        }
    }
}
