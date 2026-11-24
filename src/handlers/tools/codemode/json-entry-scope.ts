/**
 * Scope inheritance and project/workspace normalization helpers for Code Mode JSON payload recovery.
 */

import {
    getActiveProjectRegistry,
    hasActiveProjectRegistry,
    resolveEffectiveProjectRegistry,
} from '../../../codemode/normalizers/project-alias-helpers.js'
import { findCanonicalRegistryKey, loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'

/** Resolves `project_number` / aliases from a JSON recovery payload record. */
export function readProjectNumber(target: Record<string, unknown>): number | string | undefined {
    const raw =
        target['project_number'] ??
        target['projectNumber'] ??
        target['project_id'] ??
        target['projectId'] ??
        target['project_name'] ??
        target['projectName'] ??
        target['project']
    if (typeof raw === 'number') {
        if (Number.isSafeInteger(raw) && raw > 0) return raw
        return Number.isFinite(raw) ? raw : String(raw)
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
        const trimmed = raw.trim()
        const parsed = /^p-?\d+$/i.test(trimmed)
            ? parseCanonicalPositiveInt(trimmed.replace(/^p-?/i, ''))
            : parseCanonicalPositiveInt(trimmed)
        if (parsed !== undefined) return parsed
        return trimmed
    }
    return undefined
}

/** Maps a `repo` / `owner/repo` value onto a registered workspace key; never copies it verbatim. */
export function resolveRepoWorkspace(repo: unknown): string | undefined {
    if (typeof repo !== 'string' || repo.trim() === '') return undefined
    const trimmed = repo.trim()
    const registry = hasActiveProjectRegistry()
        ? getActiveProjectRegistry()
        : (resolveEffectiveProjectRegistry() ?? loadProjectRegistryFromConfig())
    if (registry === undefined) return undefined
    const exactMatch = findCanonicalRegistryKey(trimmed, registry)
    if (exactMatch !== undefined) return exactMatch
    const name = trimmed.split(/[/\\]/).filter(Boolean).pop()?.trim() ?? ''
    if (name === '') return undefined
    return findCanonicalRegistryKey(name, registry)
}

/** Resolves explicit workspace or registered repo workspace from a JSON recovery payload record. */
export function readWorkspaceId(target: Record<string, unknown>): string | undefined {
    const raw = target['workspace_id'] ?? target['workspaceId'] ?? target['workspace']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
    return resolveRepoWorkspace(
        target['repo'] ?? target['repo_name'] ?? target['repoName'] ?? target['repository']
    )
}

/**
 * Resolves compatible `(workspaceId, projectNumber)` scope inherited from outer wrapper onto target,
 * forwarding explicit `'default'` outer `project_number` only onto `'default'` / unspecified targets.
 */
export function resolveCompatibleInheritedScope(
    target: Record<string, unknown>,
    original: Record<string, unknown>,
    allowDefaultProjForward = false
): { workspaceId?: string; projectNumber?: number | string } {
    const targetWs = readWorkspaceId(target)
    const origWs = original !== target ? readWorkspaceId(original) : undefined
    const targetProj = readProjectNumber(target)
    const origProj = original !== target ? readProjectNumber(original) : undefined

    const workspaceId = targetWs ?? (targetProj === undefined ? origWs : undefined)
    const compatibleWs = targetWs === undefined || targetWs.toLowerCase() === origWs?.toLowerCase()
    const origIsDefault = origWs?.toLowerCase() === 'default'
    const targetIsDefault = targetWs?.toLowerCase() === 'default'
    const origIsDefaultWithoutTargetWs = targetWs === undefined && origIsDefault
    const allowOrigProj =
        targetProj === undefined &&
        origProj !== undefined &&
        compatibleWs &&
        (!targetIsDefault || origIsDefault) &&
        (!origIsDefaultWithoutTargetWs || allowDefaultProjForward)

    return {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(targetProj !== undefined
            ? { projectNumber: targetProj }
            : allowOrigProj
              ? { projectNumber: origProj }
              : {}),
    }
}

/** Populates missing `workspace_id` / `project_number` fields on recovered dispatch parameter maps. */
export function assignMissingScope(
    params: Record<string, unknown>,
    target: Record<string, unknown>,
    original: Record<string, unknown>
): void {
    const hasWsParam = params['workspace_id'] !== undefined || params['workspaceId'] !== undefined
    const hasProjParam = params['project_number'] !== undefined || params['projectNumber'] !== undefined
    const effectiveTarget =
        hasWsParam || hasProjParam
            ? {
                  ...target,
                  ...(hasWsParam ? { workspace_id: params['workspace_id'] ?? params['workspaceId'] } : {}),
                  ...(hasProjParam ? { project_number: params['project_number'] ?? params['projectNumber'] } : {}),
              }
            : target
    const scope = resolveCompatibleInheritedScope(effectiveTarget, original)
    if (!hasWsParam && scope.workspaceId !== undefined) {
        params['workspace_id'] = scope.workspaceId
    }
    if (!hasProjParam && scope.projectNumber !== undefined) {
        params['project_number'] = scope.projectNumber
    }
}

/** True when `use_test_db` or `useTestDb` is explicitly enabled on target or outer wrapper. */
export function hasUseTestDbFlag(
    target: Record<string, unknown>,
    original?: Record<string, unknown>
): boolean {
    return (
        target['use_test_db'] === true ||
        target['useTestDb'] === true ||
        original?.['use_test_db'] === true ||
        original?.['useTestDb'] === true
    )
}

/** Return the first non-blank trimmed string from candidate values. */
export function firstNonBlankString(...values: unknown[]): string | undefined {
    for (const val of values) {
        if (typeof val === 'string' && val.trim() !== '') return val.trim()
    }
    return undefined
}

/** Return first defined property value matching `keys` on `primary` then `fallback`. */
export function firstDefinedAlias(
    primary: Record<string, unknown>,
    fallback: Record<string, unknown> | undefined,
    keys: readonly string[]
): unknown {
    for (const k of keys) if (primary[k] !== undefined) return primary[k]
    if (fallback !== undefined) for (const k of keys) if (fallback[k] !== undefined) return fallback[k]
    return undefined
}

/** Keys that explicitly discriminate a structured Code Mode command vs plain entry fields. */
export const STRUCTURED_DISCRIMINATOR_KEYS = [
    'action', 'operation', 'op', 'tool', 'method', 'function',
] as const

function recordHasDiscriminator(rec: Record<string, unknown>): boolean {
    return STRUCTURED_DISCRIMINATOR_KEYS.some((k) => rec[k] !== undefined)
}

/** True when `record` or its nested `payload`/`entry`/`input` wrapper declares a command/tool discriminator. */
export function hasStructuredDiscriminator(record: Record<string, unknown>): boolean {
    if (recordHasDiscriminator(record)) return true
    for (const wrapKey of ['payload', 'entry', 'input'] as const) {
        const inner = record[wrapKey]
        if (isRecord(inner) && recordHasDiscriminator(inner)) return true
    }
    return false
}
