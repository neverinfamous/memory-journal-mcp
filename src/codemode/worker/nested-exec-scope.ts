/**
 * Nested Code Mode `executeCode` scope guardrails and argument/NL extraction helpers.
 * Worker-thread safe (no host DB or config-file imports).
 */

import * as vm from 'node:vm'
import type { ProjectRegistryEntry } from '../../types/index.js'
import { transformAutoReturn } from '../auto-return.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import { validateSandboxCode } from '../security.js'

function findRegistryKey(
    name: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    if (registry === undefined) return undefined
    const lower = name.trim().toLowerCase()
    if (lower === '') return undefined
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === lower) return key
    }
    const slug = lower.replace(/_/g, '-')
    const slugMatches = Object.keys(registry).filter(
        (key) => key.toLowerCase().replace(/_/g, '-') === slug
    )
    if (slugMatches.length === 1) return slugMatches[0]

    const pathMatches = Object.entries(registry)
        .filter(([, entry]) => {
            const p = typeof entry.path === 'string' ? entry.path : ''
            const base = p.split(/[/\\]/).filter(Boolean).pop() ?? ''
            return base.toLowerCase() === lower
        })
        .map(([key]) => key)
    return pathMatches.length === 1 ? pathMatches[0] : undefined
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function collectNestedScopeRecords(argRec: Record<string, unknown>): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [argRec]
    for (const key of ['metadata', 'context', 'params'] as const) {
        const nested = argRec[key]
        if (isPlainRecord(nested)) records.push(nested)
    }
    return records
}

function parseProjectNumberCandidate(
    rawProj: unknown,
    registry: Record<string, ProjectRegistryEntry> | undefined
): number | null {
    if (typeof rawProj === 'number') {
        return Number.isInteger(rawProj) && rawProj > 0 ? rawProj : null
    }
    if (typeof rawProj === 'string') {
        const trimmed = rawProj.trim()
        const numMatch = /^(?:#|p-)?([1-9]\d*)$/i.exec(trimmed)
        if (numMatch?.[1] !== undefined) {
            return Number.parseInt(numMatch[1], 10)
        }
        const matchedKey = findRegistryKey(trimmed, registry)
        const regProj = matchedKey !== undefined ? registry?.[matchedKey]?.project_number : undefined
        return typeof regProj === 'number' && Number.isInteger(regProj) && regProj > 0
            ? regProj
            : null
    }
    return null
}

function isProjectStringValue(val: unknown): val is string {
    if (typeof val !== 'string') return false
    const trimmed = val.trim()
    return trimmed !== '' && !/^(?:#|p-)?\d+$/i.test(trimmed)
}

function validateWorkspaceAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string,
    canonPinned: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const wsKeys = [
        'workspace_id',
        'workspaceId',
        'workspace',
        'target_workspace_id',
        'targetWorkspaceId',
        'project_name',
        'projectName',
    ] as const
    for (const rec of records) {
        for (const key of wsKeys) {
            const raw = rec[key]
            if (typeof raw !== 'string') continue
            const trimmed = raw.trim()
            if (trimmed === '' || trimmed === '*') continue
            const canonArg = findRegistryKey(trimmed, registry) ?? trimmed
            if (canonArg.toLowerCase() !== canonPinned.toLowerCase()) {
                return {
                    error: `Workspace '${trimmed}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                }
            }
        }
        const rawProject = rec['project']
        if (isProjectStringValue(rawProject)) {
            const trimmed = rawProject.trim()
            if (trimmed !== '*') {
                const canonArg = findRegistryKey(trimmed, registry) ?? trimmed
                if (canonArg.toLowerCase() !== canonPinned.toLowerCase()) {
                    return {
                        error: `Workspace '${trimmed}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            }
        }
    }
    return null
}

function validateRepoAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string,
    canonPinned: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const repoKeys = ['repo', 'repo_name', 'repoName', 'repository'] as const
    for (const rec of records) {
        for (const key of repoKeys) {
            const rawRepo = rec[key]
            if (typeof rawRepo !== 'string' || rawRepo.trim() === '') continue
            const trimmedRepo = rawRepo.trim()
            const repoSlug = trimmedRepo.split(/[/\\]/).filter(Boolean).pop() ?? trimmedRepo
            const matchedRepoKey =
                findRegistryKey(trimmedRepo, registry) ?? findRegistryKey(repoSlug, registry)
            if (matchedRepoKey !== undefined) {
                if (matchedRepoKey.toLowerCase() !== canonPinned.toLowerCase()) {
                    return {
                        error: `Repository '${trimmedRepo}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            } else if (
                repoSlug.toLowerCase() !== pinnedWorkspace.toLowerCase() &&
                repoSlug.toLowerCase() !== canonPinned.toLowerCase()
            ) {
                return {
                    error: `Repository '${trimmedRepo}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                }
            }
        }
    }
    return null
}

function validateProjectNumberAliases(
    records: Record<string, unknown>[],
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    canonPinned: string | undefined,
    registry: Record<string, ProjectRegistryEntry> | undefined
): { error: string } | null {
    const projKeys = ['project_number', 'projectNumber', 'project_id', 'projectId', 'project'] as const
    for (const rec of records) {
        for (const key of projKeys) {
            const rawProj = rec[key]
            if (rawProj === undefined || rawProj === null || rawProj === '') continue
            if (key === 'project' && isProjectStringValue(rawProj)) continue
            const parsedProj = parseProjectNumberCandidate(rawProj, registry)
            if (parsedProj === null) {
                const projDesc =
                    typeof rawProj === 'string' ||
                    typeof rawProj === 'number' ||
                    typeof rawProj === 'boolean'
                        ? String(rawProj)
                        : (JSON.stringify(rawProj) ?? 'invalid')
                return { error: `Invalid project_number '${projDesc}' in nested executeCode` }
            }
            if (pinnedProjectNumber !== undefined && parsedProj !== pinnedProjectNumber) {
                return {
                    error: `project_number ${String(parsedProj)} conflicts with pinned session project_number ${String(pinnedProjectNumber)}`,
                }
            }
            if (pinnedWorkspace?.toLowerCase() === 'default') {
                const defaultRegProj = registry?.['default']?.project_number
                if (parsedProj !== pinnedProjectNumber && parsedProj !== defaultRegProj) {
                    return {
                        error: `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            } else if (pinnedWorkspace !== undefined && registry !== undefined && canonPinned !== undefined) {
                const owners = Object.entries(registry)
                    .filter(([, entry]) => entry.project_number === parsedProj)
                    .map(([ownerKey]) => ownerKey)
                if (
                    owners.length > 0 &&
                    !owners.some((k) => k.toLowerCase() === canonPinned.toLowerCase())
                ) {
                    return {
                        error: `project_number ${String(parsedProj)} conflicts with pinned session workspace '${pinnedWorkspace}'`,
                    }
                }
            }
        }
    }
    return null
}

/**
 * Validates that nested `mj.executeCode` / `executeCode` arguments do not drift outside the
 * outer session's pinned `workspace_id` or `project_number`.
 */
export function validateNestedExecScope(
    argRec: Record<string, unknown> | undefined,
    pinnedWorkspace: string | undefined,
    pinnedProjectNumber: number | undefined,
    projectRegistryRaw: unknown
): { error: string } | null {
    if (argRec === undefined) return null
    const registry = readProjectRegistryPayload(projectRegistryRaw)
    const records = collectNestedScopeRecords(argRec)
    const canonPinned =
        pinnedWorkspace !== undefined
            ? findRegistryKey(pinnedWorkspace, registry) ?? pinnedWorkspace
            : undefined

    if (pinnedWorkspace !== undefined && canonPinned !== undefined) {
        const wsErr = validateWorkspaceAliases(records, pinnedWorkspace, canonPinned, registry)
        if (wsErr !== null) return wsErr
        const repoErr = validateRepoAliases(records, pinnedWorkspace, canonPinned, registry)
        if (repoErr !== null) return repoErr
    }

    return validateProjectNumberAliases(
        records,
        pinnedWorkspace,
        pinnedProjectNumber,
        canonPinned,
        registry
    )
}

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
    const hasEntryText =
        typeof Reflect.get(arg, 'content') === 'string' ||
        typeof Reflect.get(arg, 'text') === 'string' ||
        typeof Reflect.get(arg, 'description') === 'string' ||
        typeof Reflect.get(arg, 'title') === 'string'
    return hasEntryText ? null : ''
}

/**
 * Converts a plain natural-language prompt passed into nested `executeCode` into a technical note payload.
 */
export function naturalLanguageEntry(
    codeToExec: string
): { title: string; content: string; entry_type: string } | undefined {
    const trimmed = codeToExec.trim()
    const isNaturalPrompt =
        /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(
            trimmed
        ) && !/\b(const|let|var|function|return|await|import|export)\b/.test(trimmed)
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

export type RunIsolatedNestedFn = (
    wrapped: string,
    nestedReadonly: boolean,
    nestedDryRun: boolean
) => Promise<unknown>

export interface SandboxExecutorOptions {
    shimMj: Record<string, unknown>
    vmContextRef: { current?: vm.Context }
    timeoutMs: number
    readonlyMode: boolean | undefined
    dryRunMode: boolean | undefined
    pinnedWorkspaceRaw: unknown
    pinnedProjectRaw: unknown
    projectRegistryRaw: unknown
    runIsolatedNestedCode: RunIsolatedNestedFn
}

/**
 * Builds the sandboxed nested `executeCode` dispatcher enforcing pinned scope,
 * readonly/dryRun invariants, and code-security checks before `vm.runInContext`.
 */
export function createSandboxExecutor(
    options: SandboxExecutorOptions
): (arg: unknown) => Promise<unknown> {
    const {
        shimMj,
        vmContextRef,
        timeoutMs,
        readonlyMode,
        dryRunMode,
        pinnedWorkspaceRaw,
        pinnedProjectRaw,
        projectRegistryRaw,
        runIsolatedNestedCode,
    } = options
    const pinnedWorkspace =
        typeof pinnedWorkspaceRaw === 'string' &&
        pinnedWorkspaceRaw.trim() !== '' &&
        pinnedWorkspaceRaw.trim() !== '*'
            ? pinnedWorkspaceRaw.trim()
            : undefined
    const pinnedProjectNumber =
        typeof pinnedProjectRaw === 'number' &&
        Number.isInteger(pinnedProjectRaw) &&
        pinnedProjectRaw > 0
            ? pinnedProjectRaw
            : undefined

    const invokeCreateEntry = (payload: unknown): unknown => {
        const coreGroup = shimMj['core']
        if ((typeof coreGroup === 'object' && coreGroup !== null) || typeof coreGroup === 'function') {
            const fn = Reflect.get(coreGroup, 'createEntry') as unknown
            if (typeof fn === 'function') return (fn as (a: unknown) => unknown)(payload)
        }
        return undefined
    }

    return async (arg: unknown): Promise<unknown> => {
        const isPlainRec = (val: unknown): val is Record<string, unknown> =>
            typeof val === 'object' && val !== null && !Array.isArray(val)
        const argRec = isPlainRec(arg) ? arg : undefined
        const argReadonly = argRec?.['readonly'] === true
        const argDryRun = argRec?.['dry_run'] === true || argRec?.['dryRun'] === true
        const scopeErr = validateNestedExecScope(
            argRec,
            pinnedWorkspace,
            pinnedProjectNumber,
            projectRegistryRaw
        )
        if (scopeErr !== null) {
            return {
                success: false,
                error: scopeErr.error,
                code: 'VALIDATION_ERROR',
            }
        }
        const effectiveReadonly = readonlyMode === true || argReadonly

        const codeToExec = readExecutableCode(arg)
        if (codeToExec === null) {
            if (effectiveReadonly) {
                return {
                    success: false,
                    error: 'Write operations are disabled in readonly mode',
                    code: 'PERMISSION_DENIED',
                }
            }
            if (argDryRun || dryRunMode === true) {
                return {
                    success: false,
                    error: 'dry_run is not supported for synthesized entry writes inside nested execute_code',
                    code: 'VALIDATION_ERROR',
                }
            }
            return invokeCreateEntry(arg)
        }
        if (codeToExec === '') {
            return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }
        }
        const natural = naturalLanguageEntry(codeToExec)
        if (natural !== undefined) {
            if (effectiveReadonly) {
                return {
                    success: false,
                    error: 'Write operations are disabled in readonly mode',
                    code: 'PERMISSION_DENIED',
                }
            }
            if (argDryRun || dryRunMode === true) {
                return {
                    success: false,
                    error: 'dry_run is not supported for synthesized entry writes inside nested execute_code',
                    code: 'VALIDATION_ERROR',
                }
            }
            return invokeCreateEntry(natural)
        }
        const validation = validateSandboxCode(codeToExec)
        if (!validation.valid) {
            return {
                success: false,
                error: validation.errors.join('; '),
                code: 'SECURITY_VIOLATION',
            }
        }
        if (vmContextRef.current !== undefined) {
            const transformed = transformAutoReturn(codeToExec)
            const wrapped = `(async () => {\n${transformed}\n})()`
            const effectiveDryRun = dryRunMode === true || argDryRun
            if ((effectiveReadonly && readonlyMode !== true) || (effectiveDryRun && dryRunMode !== true)) {
                return runIsolatedNestedCode(wrapped, effectiveReadonly, effectiveDryRun)
            }
            return (await vm.runInContext(wrapped, vmContextRef.current, { timeout: timeoutMs })) as unknown
        }
        return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }
    }
}
