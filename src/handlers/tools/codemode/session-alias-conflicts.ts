import { ValidationError } from '../../../types/errors.js'
import { isRecord } from '../../../utils/type-guards.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { findCanonicalRegistryKey } from '../../../utils/workspace-resolver.js'
import type { ToolContext } from '../../../types/index.js'
import type { ExecuteCodeInput } from './payload-synthesizer.js'

type ProjectRegistry = NonNullable<ToolContext['config']>['projectRegistry']

const MUTATING_SYNTHESIS_METHOD_RE =
    /\bmj\s*\.\s*(?:[a-zA-Z_$][\w$]*\s*\.\s*)?(?:team_?)?(?:batch_?)?(?:create|update|delete|restore|merge|link|unlink|backup|cleanup|import|rebuild|add|remove|register|consolidate|run_?auto_?prune|save_?memory|mark_?anchors|close_?github|move_?kanban|set_?|append_?)[A-Za-z0-9_]*(?:\s*\)|\s*\(|\s*\|\|)/i

export function isSynthesizedMutatingCode(code: string): boolean {
    return MUTATING_SYNTHESIS_METHOD_RE.test(code)
}

export function readonlySynthesisBlockedResult(): { earlyReturn: Record<string, unknown> } {
    return {
        earlyReturn: {
            success: false,
            error: 'Cannot synthesize or recover mutating Code Mode operations in read-only mode.',
            code: 'PERMISSION_DENIED',
            category: 'authorization',
            recoverable: false,
            project_id: undefined,
            executionTimeMs: 0,
        },
    }
}

function conflictError(error: string): { errorResponse: Record<string, unknown> } {
    return {
        errorResponse: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
            project_id: undefined,
            executionTimeMs: 0,
        },
    }
}

export function validateReadonlyAliasConflicts(input: ExecuteCodeInput, rawParams: unknown): void {
    const rawRec = isRecord(rawParams) ? rawParams : input
    const vals: boolean[] = []
    for (const k of ['readonly', 'readOnly', 'read_only'] as const) {
        const v = rawRec[k] ?? input[k]
        if (typeof v === 'boolean') vals.push(v)
    }
    if (vals.length > 1 && vals.some((v) => v !== vals[0])) {
        throw new ValidationError("Conflicting values provided for 'readonly', 'readOnly', or 'read_only'.")
    }
}

function resolveNonConflictingStringAlias(
    rec: Record<string, unknown>,
    keys: readonly string[],
    label: string
): { value: string | undefined } | { errorResponse: Record<string, unknown> } {
    const nonBlank: string[] = []
    for (const k of keys) {
        const v = rec[k]
        if (v === undefined || v === null) continue
        if (typeof v !== 'string') {
            return conflictError(`Invalid non-string value for '${k}'.`)
        }
        const trimmed = v.trim()
        if (trimmed !== '') nonBlank.push(trimmed)
    }
    if (nonBlank.length > 1 && nonBlank.some((v) => v !== nonBlank[0])) {
        return conflictError(`Conflicting values provided for ${label} aliases.`)
    }
    return { value: nonBlank[0] }
}

function canonicalProjectAliasComparable(val: unknown): string | undefined {
    if (typeof val === 'number') {
        return Number.isSafeInteger(val) && val > 0 ? String(val) : String(val)
    }
    if (typeof val === 'string') {
        const trimmed = val.trim()
        if (trimmed === '') return undefined
        const pos = parseCanonicalPositiveInt(trimmed)
        return pos !== undefined ? String(pos) : trimmed
    }
    return undefined
}

function resolveLookupProjectNum(
    registry: ProjectRegistry,
    name: string
): number | undefined {
    if (registry === undefined) return undefined
    const key = findCanonicalRegistryKey(name, registry)
    if (key !== undefined && Object.hasOwn(registry, key)) {
        return registry[key]?.project_number
    }
    if (/[/\\]/.test(name)) {
        const leaf = name.split(/[/\\]/).filter(Boolean).pop()
        const leafKey = leaf !== undefined ? findCanonicalRegistryKey(leaf, registry) : undefined
        if (leafKey !== undefined && Object.hasOwn(registry, leafKey)) {
            return registry[leafKey]?.project_number
        }
    }
    return undefined
}

export interface TopLevelScopeAliases {
    workspaceInput: string | undefined
    repoInput: string | undefined
    projectInput: number | string | undefined
}

export function resolveTopLevelScopeAliases(
    input: ExecuteCodeInput,
    effectiveRegistry: ProjectRegistry
): TopLevelScopeAliases | { errorResponse: Record<string, unknown> } {
    const rec: Record<string, unknown> = input
    const wsRes = resolveNonConflictingStringAlias(
        rec,
        ['workspace_id', 'workspaceId', 'workspace'],
        "'workspace_id'"
    )
    if ('errorResponse' in wsRes) return wsRes

    const repoRes = resolveNonConflictingStringAlias(
        rec,
        ['repo', 'repo_name', 'repoName', 'repository'],
        "'repo'"
    )
    if ('errorResponse' in repoRes) return repoRes

    const numKeys = ['project_number', 'projectNumber', 'project_id', 'projectId'] as const
    const numDefined: { raw: number | string; norm: string }[] = []
    for (const k of numKeys) {
        const v = rec[k]
        if (v === undefined || v === null) continue
        if (typeof v !== 'number' && typeof v !== 'string') {
            return conflictError(`Invalid value for '${k}'.`)
        }
        const norm = canonicalProjectAliasComparable(v)
        if (norm !== undefined) numDefined.push({ raw: v, norm })
    }
    if (numDefined.length > 1 && numDefined.some((d) => d.norm !== numDefined[0]?.norm)) {
        return conflictError("Conflicting values provided for 'project_number' / 'project_id' aliases.")
    }

    const nameRes = resolveNonConflictingStringAlias(
        rec,
        ['project_name', 'projectName', 'project'],
        "'project_name'"
    )
    if ('errorResponse' in nameRes) return nameRes

    let projectInput: number | string | undefined = numDefined[0]?.raw
    if (nameRes.value !== undefined) {
        const resolvedKey = findCanonicalRegistryKey(nameRes.value, effectiveRegistry)
        if (wsRes.value !== undefined && wsRes.value !== '*' && resolvedKey !== undefined) {
            const wsKey = findCanonicalRegistryKey(wsRes.value, effectiveRegistry) ?? wsRes.value
            if (wsKey.toLowerCase() !== resolvedKey.toLowerCase()) {
                return conflictError(
                    `Project alias '${nameRes.value}' conflicts with workspace_id '${wsRes.value}'.`
                )
            }
        }
        const resolvedNum = resolveLookupProjectNum(effectiveRegistry, nameRes.value)
        if (numDefined[0] !== undefined && resolvedNum !== undefined) {
            const firstNum = parseCanonicalPositiveInt(numDefined[0].norm)
            if (firstNum !== undefined && firstNum !== resolvedNum) {
                return conflictError(
                    `Project alias '${nameRes.value}' (project #${String(resolvedNum)}) conflicts with project_number '${numDefined[0].norm}'.`
                )
            }
        }
        projectInput ??= resolvedNum ?? nameRes.value
    }

    return {
        workspaceInput: wsRes.value,
        repoInput: repoRes.value,
        projectInput,
    }
}
