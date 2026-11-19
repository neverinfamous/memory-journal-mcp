/**
 * Worker-safe project registry state, alias resolution, and create-entry scope pairing helpers
 * extracted from `generic-field-aliases.ts` (Appendix A).
 */

import type { ProjectRegistryEntry } from '../../types/index.js'
import { resolveProjectContextWithRegistry } from '../../utils/workspace-resolver-pure.js'
import { findCanonicalRegistryKey, pairStoredScope } from '../../utils/workspace-registry-match.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { isRecord } from './shared-utils.js'

let activeProjectRegistry: Record<string, ProjectRegistryEntry> | undefined
let activeProjectRegistryBound = false
let fallbackRegistryLoader: (() => Record<string, ProjectRegistryEntry> | undefined) | undefined

export interface ActiveRegistrySnapshot {
    registry: Record<string, ProjectRegistryEntry> | undefined
    bound: boolean
}

export function setActiveProjectRegistry(
    registry: Record<string, ProjectRegistryEntry> | undefined
): void {
    activeProjectRegistry = registry
    activeProjectRegistryBound = registry !== undefined
}

export function captureActiveProjectRegistryState(): ActiveRegistrySnapshot {
    return { registry: activeProjectRegistry, bound: activeProjectRegistryBound }
}

export function restoreActiveProjectRegistryState(snapshot: ActiveRegistrySnapshot): void {
    activeProjectRegistry = snapshot.registry
    activeProjectRegistryBound = snapshot.bound
}

export function hasActiveProjectRegistry(): boolean {
    return activeProjectRegistryBound
}

export function setFallbackProjectRegistryLoader(
    loader: (() => Record<string, ProjectRegistryEntry> | undefined) | undefined
): void {
    fallbackRegistryLoader = loader
}

export function resolveEffectiveProjectRegistry():
    | Record<string, ProjectRegistryEntry>
    | undefined {
    return activeProjectRegistryBound ? activeProjectRegistry : fallbackRegistryLoader?.()
}

export function getActiveProjectRegistry(): Record<string, ProjectRegistryEntry> | undefined {
    return activeProjectRegistry
}

export function readProjectRegistryPayload(
    value: unknown
): Record<string, ProjectRegistryEntry> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const registry: Record<string, ProjectRegistryEntry> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (!isRecord(entry)) continue
        const pathValue = entry['path']
        const projectNumber = entry['project_number']
        const hasPath = typeof pathValue === 'string' && pathValue.trim() !== ''
        const hasProject =
            typeof projectNumber === 'number' &&
            Number.isSafeInteger(projectNumber) &&
            projectNumber > 0
        // [H6] Pathless / `owner/repo`-keyed registry entries are preserved (path: '') so
        // name -> project_number resolution keeps working inside the worker.
        if (!hasPath && !hasProject) continue
        const record: ProjectRegistryEntry = { path: hasPath ? pathValue : '' }
        if (hasProject) record.project_number = projectNumber
        registry[key] = record
    }
    return registry
}

export function aliasValidationError(error: string): { error: Record<string, unknown> } {
    return {
        error: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        },
    }
}

export type ProjectNameAliasResult = 'applied' | 'unregistered' | { conflict: string }

function formatScalarOrJson(val: unknown): string {
    return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
        ? String(val)
        : (JSON.stringify(val) ?? typeof val)
}

function canonicalAliasProject(rawVal: unknown): number | undefined {
    if (typeof rawVal === 'number') {
        return Number.isSafeInteger(rawVal) && rawVal > 0 ? rawVal : undefined
    }
    if (typeof rawVal === 'string') return parseCanonicalPositiveInt(rawVal)
    return undefined
}

function matchRegistryKeyOrLeaf(
    name: string,
    registry: Record<string, ProjectRegistryEntry> | undefined
): string | undefined {
    if (registry === undefined) return undefined
    const direct = findCanonicalRegistryKey(name, registry)
    if (direct !== undefined) return direct
    if (/[/\\]/.test(name)) {
        const leaf = name.split(/[/\\]/).filter(Boolean).pop()?.trim()
        if (leaf !== undefined && leaf !== '') {
            return findCanonicalRegistryKey(leaf, registry)
        }
    }
    return undefined
}

export function applyProjectNameAlias(
    rawVal: unknown,
    obj: Record<string, unknown>
): ProjectNameAliasResult {
    const existingProj = obj['project_number'] ?? obj['projectNumber']
    const num = canonicalAliasProject(rawVal)
    const strVal = typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : ''
    if (num !== undefined && strVal.trim() !== '') {
        if (existingProj !== undefined) {
            const existingNum = canonicalAliasProject(existingProj)
            if (existingNum !== num) {
                return {
                    conflict: `Project alias '${strVal.trim()}' conflicts with project_number '${formatScalarOrJson(existingProj)}'`,
                }
            }
            return 'applied'
        }
        obj['project_number'] = num
        return 'applied'
    }
    if (typeof rawVal !== 'string' || rawVal.trim() === '') return 'applied'
    const name = rawVal.trim()
    const registry = resolveEffectiveProjectRegistry()
    const matchedKey = matchRegistryKeyOrLeaf(name, registry)
    const existingWs = obj['workspace_id'] ?? obj['workspaceId'] ?? obj['workspace']
    if (typeof existingWs === 'string' && existingWs.trim() !== '') {
        const trimmedExisting = existingWs.trim()
        const canonicalExisting = matchRegistryKeyOrLeaf(trimmedExisting, registry) ?? trimmedExisting
        const expectedWs = matchedKey ?? name
        if (canonicalExisting.toLowerCase() !== expectedWs.toLowerCase()) {
            return {
                conflict: `Project alias '${name}' conflicts with workspace_id '${trimmedExisting}'`,
            }
        }
    }
    if (matchedKey === undefined || registry === undefined) return 'unregistered'
    const projectNumber = registry[matchedKey]?.project_number
    if (existingProj !== undefined && projectNumber !== undefined && Number(existingProj) !== projectNumber) {
        return {
            conflict: `Project alias '${name}' (project #${String(projectNumber)}) conflicts with project_number '${formatScalarOrJson(existingProj)}'`,
        }
    }
    if (projectNumber !== undefined && obj['project_number'] === undefined) {
        obj['project_number'] = projectNumber
    }
    if (obj['workspace_id'] === undefined) {
        obj['workspace_id'] = matchedKey
        obj['_alias_derived_workspace'] = true
    }
    return 'applied'
}

export function normalizeProjectAliases(
    obj: Record<string, unknown>
): { error: Record<string, unknown> } | undefined {
    if (obj['workspace_id'] === undefined) {
        if (typeof obj['workspaceId'] === 'string') {
            obj['workspace_id'] = obj['workspaceId']
        } else if (typeof obj['workspace'] === 'string') {
            obj['workspace_id'] = obj['workspace']
        }
    }
    Reflect.deleteProperty(obj, 'workspaceId')
    if (obj['workspace_id'] !== undefined) {
        Reflect.deleteProperty(obj, 'workspace')
    }
    if (obj['project_number'] === undefined && obj['projectNumber'] !== undefined) {
        obj['project_number'] = obj['projectNumber']
    }
    Reflect.deleteProperty(obj, 'projectNumber')
    for (const projAlias of ['project_name', 'projectName', 'project'] as const) {
        if (obj[projAlias] === undefined) continue
        const res = applyProjectNameAlias(obj[projAlias], obj)
        if (typeof res === 'object') {
            return aliasValidationError(res.conflict)
        }
        if (res === 'applied') {
            Reflect.deleteProperty(obj, projAlias)
        }
    }
    return undefined
}

export function resolveCreateEntryProjectContext(obj: Record<string, unknown>): void {
    if (obj['workspace_id'] === undefined && typeof obj['workspaceId'] === 'string') {
        obj['workspace_id'] = obj['workspaceId']
    }
    if (obj['project_number'] === undefined && obj['projectNumber'] !== undefined) {
        obj['project_number'] = obj['projectNumber']
    }
    let projNum =
        typeof obj['project_number'] === 'number' &&
        Number.isSafeInteger(obj['project_number']) &&
        obj['project_number'] > 0
            ? obj['project_number']
            : undefined
    if (typeof obj['project_number'] === 'string') {
        const cleaned = obj['project_number'].trim()
        const parsedNum = /^p-?\d+$/i.test(cleaned)
            ? parseCanonicalPositiveInt(cleaned.replace(/^p-?/i, ''))
            : parseCanonicalPositiveInt(cleaned)
        if (parsedNum !== undefined) {
            projNum = parsedNum
            obj['project_number'] = parsedNum
        } else if (cleaned !== '') {
            const preserved = obj['project_number']
            Reflect.deleteProperty(obj, 'project_number')
            if (applyProjectNameAlias(cleaned, obj) === 'applied') {
                projNum = typeof obj['project_number'] === 'number' ? obj['project_number'] : undefined
            } else {
                obj['project_number'] = preserved
            }
        } else {
            obj['project_number'] = cleaned
        }
    }
    // [INVARIANT] No content/tag/CWD guessing here: the host `secure-dispatcher` binds the
    // session scope first. Only validate/pair when workspace_id was explicitly provided.
    const wsRaw = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'] : undefined
    const wsTrimmed = wsRaw?.trim()
    const workspaceIsConcrete = wsTrimmed !== undefined && wsTrimmed !== '' && wsTrimmed !== '*'
    if (!workspaceIsConcrete) return
    const effectiveRegistry = resolveEffectiveProjectRegistry()
    const resolved = resolveProjectContextWithRegistry(
        {
            workspace_id: wsTrimmed,
            ...(projNum !== undefined ? { project_number: projNum } : {}),
        },
        effectiveRegistry !== undefined ? { projectRegistry: effectiveRegistry } : undefined,
        effectiveRegistry
    )
    if (projNum !== undefined) {
        pairStoredScope(wsTrimmed, projNum, effectiveRegistry)
    } else if (
        wsTrimmed.toLowerCase() !== 'default' &&
        obj['project_number'] === undefined &&
        resolved.projectNumber !== undefined
    ) {
        obj['project_number'] = resolved.projectNumber
    }
}
