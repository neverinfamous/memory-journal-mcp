/**
 * Nested Code Mode `executeCode` scope guardrails and argument/NL extraction helpers.
 * Worker-thread safe (no host DB or config-file imports).
 */

import * as vm from 'node:vm'
import type { ProjectRegistryEntry } from '../../types/index.js'
import { transformAutoReturn } from '../auto-return.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import { validateSandboxCode } from '../security.js'
import {
    dispatchSynthesizedNestedEntry,
    extractNestedAutoVersion,
    extractNestedContextRecord,
    extractNestedMaxResultSize,
    extractNestedSessionId,
    extractNestedTimeoutMs,
    invokeShimGroupMethod,
    mergeNestedSynthesizedScope,
    naturalLanguageEntry,
    raceWithSandboxTimeout,
    readExecutableCode,
    readNestedQuerySearch,
} from './nested-exec-payload.js'
import {
    findRegistryKey,
    isPlainRecord,
    isProjectStringValue,
    parseProjectNumberCandidate,
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
}

function readNarrowedWorkspace(
    sources: Record<string, unknown>[],
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    for (const src of sources) {
        for (const key of ['workspace_id', 'workspaceId', 'workspace'] as const) {
            const raw = src[key]
            if (typeof raw === 'string' && raw.trim() !== '' && raw.trim() !== '*') {
                return findRegistryKey(raw.trim(), registry) ?? raw.trim()
            }
        }
        for (const key of ['repo', 'repo_name', 'repoName', 'repository'] as const) {
            const raw = src[key]
            if (typeof raw !== 'string' || raw.trim() === '') continue
            const trimmed = raw.trim()
            const slug = trimmed.split(/[/\\]/).filter(Boolean).pop() ?? trimmed
            const matched = findRegistryKey(trimmed, registry) ?? findRegistryKey(slug, registry)
            if (matched !== undefined) return matched
        }
    }
    return undefined
}

function uniqueWorkspaceForProjectNum(
    projectNum: number,
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    if (registry === undefined) return undefined
    let matched: string | undefined
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number !== projectNum) continue
        if (matched !== undefined) return undefined
        matched = key
    }
    return matched
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
    const ctxRec = isPlainRecord(argRec['context']) ? argRec['context'] : undefined
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
    narrowed: { workspaceId?: string; projectNumber?: number }
    pinnedWorkspace: string | undefined
    pinnedProjectNumber: number | undefined
    effectiveReadonly: boolean
    effectiveDryRun: boolean
    effectiveUseTestDb: boolean
    shimMj: Record<string, unknown>
}

async function tryDispatchNestedShortcut(
    input: ShortcutDispatchInput
): Promise<{ handled: true; value: unknown } | { handled: false; codeToExec: string; isQueryOnlyArg: boolean }> {
    const {
        arg, argRec, narrowed, pinnedWorkspace, pinnedProjectNumber,
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
    const codeToExec = readExecutableCode(arg)
    const invokeCreate = (payload: unknown): unknown => invokeShimGroupMethod(shimMj, 'core', 'createEntry', payload)
    if (codeToExec === null) {
        const scoped = mergeNestedSynthesizedScope(arg, argRec, narrowed, pinnedWorkspace, pinnedProjectNumber)
        return {
            handled: true,
            value: dispatchSynthesizedNestedEntry(scoped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, invokeCreate),
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
                value: dispatchSynthesizedNestedEntry(scoped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, invokeCreate),
            }
        }
    }
    return { handled: false, codeToExec, isQueryOnlyArg }
}

/**
 * Builds the sandboxed nested `executeCode` dispatcher enforcing pinned scope,
 * readonly/dryRun/useTestDb invariants, and code-security checks before `vm.runInContext`.
 */
export function createSandboxExecutor(options: SandboxExecutorOptions): (arg: unknown) => Promise<unknown> {
    const {
        shimMj, vmContextRef, timeoutMs, maxResultSize, readonlyMode, dryRunMode, useTestDbMode,
        pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, runIsolatedNestedCode, activeTimers,
    } = options
    const pinnedWorkspace =
        typeof pinnedWorkspaceRaw === 'string' && pinnedWorkspaceRaw.trim() !== '' && pinnedWorkspaceRaw.trim() !== '*'
            ? pinnedWorkspaceRaw.trim()
            : undefined
    const pinnedProjectNumber =
        typeof pinnedProjectRaw === 'number' && Number.isSafeInteger(pinnedProjectRaw) && pinnedProjectRaw > 0
            ? pinnedProjectRaw
            : undefined

    return async (arg: unknown): Promise<unknown> => {
        const argRec = isPlainRecord(arg) ? arg : undefined
        const scopeErr = validateNestedExecScope(argRec, pinnedWorkspace, pinnedProjectNumber, projectRegistryRaw)
        if (scopeErr !== null) return { success: false, error: scopeErr.error, code: 'VALIDATION_ERROR' }

        const effectiveReadonly = readonlyMode === true || argRec?.['readonly'] === true || argRec?.['read_only'] === true || argRec?.['readOnly'] === true
        const effectiveDryRun = dryRunMode === true || argRec?.['dry_run'] === true || argRec?.['dryRun'] === true
        const effectiveUseTestDb = useTestDbMode === true || argRec?.['use_test_db'] === true || argRec?.['useTestDb'] === true
        const rawNestedCode =
            typeof arg === 'string'
                ? arg
                : typeof argRec?.['code'] === 'string'
                  ? argRec['code']
                  : typeof argRec?.['script'] === 'string'
                    ? argRec['script']
                    : typeof argRec?.['query'] === 'string'
                      ? argRec['query']
                      : undefined
        if (rawNestedCode !== undefined && Buffer.byteLength(rawNestedCode, 'utf-8') > 50 * 1024) {
            return { success: false, error: 'Code exceeds maximum length of 51200 bytes', code: 'SECURITY_VIOLATION' }
        }
        const narrowed = resolveNestedNarrowedScope(argRec, pinnedWorkspace, pinnedProjectNumber, projectRegistryRaw)
        const shortcut = await tryDispatchNestedShortcut({
            arg, argRec, narrowed, pinnedWorkspace, pinnedProjectNumber,
            effectiveReadonly, effectiveDryRun, effectiveUseTestDb, shimMj,
        })
        if (shortcut.handled) return shortcut.value

        const { codeToExec, isQueryOnlyArg } = shortcut
        const transformedCode = transformAutoReturn(codeToExec)
        const validation = validateSandboxCode(transformedCode)
        if (!validation.valid) return { success: false, error: validation.errors.join('; '), code: 'SECURITY_VIOLATION' }
        if (isQueryOnlyArg && !/^(?:return\s+|await\s+mj\.)/.test(codeToExec.trim())) {
            return { success: false, error: 'Nested executeCode query could not be executed as a read-only search.', code: 'VALIDATION_ERROR' }
        }
        if (vmContextRef.current === undefined) return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }

        const wrapped = `(async () => {\n"use strict";\n${transformedCode}\n})()`
        const isolation = buildIsolationOverrides(argRec, timeoutMs, maxResultSize, narrowed)
        const escalates =
            (effectiveReadonly && readonlyMode !== true) ||
            (effectiveDryRun && dryRunMode !== true) ||
            (effectiveUseTestDb && useTestDbMode !== true)
        if (escalates || isolation !== undefined) {
            return runIsolatedNestedCode(wrapped, effectiveReadonly, effectiveDryRun, effectiveUseTestDb, isolation)
        }
        return await raceWithSandboxTimeout(
            Promise.resolve(vm.runInContext(wrapped, vmContextRef.current, { timeout: timeoutMs })),
            timeoutMs,
            activeTimers
        )
    }
}
