/**
 * Scope, Project Alias, and Score/Validation Healing Helpers
 */

import type { ProjectRegistryEntry } from '../../../types/index.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveProjectContext,
} from '../../../utils/workspace-resolver.js'
import { uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { getActiveProjectRegistry } from '../../../codemode/normalizers/generic-field-aliases.js'
import {
    PASSED_VALIDATION_ALIASES,
    FAILED_VALIDATION_ALIASES,
    NONE_VALIDATION_ALIASES,
} from './constants-and-primitives.js'

function normalizeWorkspaceAliasKeys(obj: Record<string, unknown>): boolean {
    if (obj['workspace_id'] === undefined && typeof obj['workspaceId'] === 'string') {
        obj['workspace_id'] = obj['workspaceId']
        delete obj['workspaceId']
        return true
    }
    if (obj['workspace_id'] === undefined && typeof obj['workspace'] === 'string') {
        obj['workspace_id'] = obj['workspace']
        delete obj['workspace']
        return true
    }
    return false
}

function resolveNamedProjectTarget(
    obj: Record<string, unknown>,
    strVal: string,
    existingWs: string | undefined,
    registry: Record<string, ProjectRegistryEntry> | undefined
): boolean {
    const num = parseCanonicalPositiveInt(strVal)
    if (num !== undefined) {
        if (obj['project_number'] !== undefined && obj['project_number'] !== num) {
            return true
        }
        if (existingWs !== undefined) {
            const wsKey = findCanonicalRegistryKey(existingWs, registry)
            const wsProject = wsKey !== undefined ? registry?.[wsKey]?.project_number : undefined
            if (wsProject !== undefined && wsProject !== num) return true
        }
        if (!('project_number' in obj) || obj['project_number'] === undefined) {
            obj['project_number'] = num
        }
        return false
    }
    if (strVal === '*') return true
    if (strVal === '') return false

    const canonicalKey = findCanonicalRegistryKey(strVal, registry)
    const matchedWs =
        canonicalKey ?? (strVal.toLowerCase() === 'default' ? 'default' : undefined)
    if (matchedWs === undefined) return true

    const matchedProject =
        canonicalKey !== undefined ? registry?.[canonicalKey]?.project_number : undefined
    if (existingWs !== undefined && existingWs.toLowerCase() !== matchedWs.toLowerCase()) {
        return true
    }
    if (
        obj['project_number'] !== undefined &&
        matchedProject !== undefined &&
        obj['project_number'] !== matchedProject
    ) {
        return true
    }
    if (existingWs === undefined) {
        obj['workspace_id'] = matchedWs
    }
    return false
}

function applyNamedProjectAlias(
    obj: Record<string, unknown>,
    registry: Record<string, ProjectRegistryEntry> | undefined
): boolean {
    let modified = false
    for (const aliasKey of ['project_name', 'projectName', 'project'] as const) {
        if (!(aliasKey in obj)) continue
        const rawVal = obj[aliasKey]
        if (typeof rawVal !== 'string' && typeof rawVal !== 'number') continue
        const existingWs =
            typeof obj['workspace_id'] === 'string' && obj['workspace_id'].trim() !== ''
                ? obj['workspace_id'].trim()
                : undefined
        const strVal = String(rawVal).trim()
        const conflicting = resolveNamedProjectTarget(obj, strVal, existingWs, registry)
        if (!conflicting) {
            Reflect.deleteProperty(obj, aliasKey)
            modified = true
        }
    }
    return modified
}

function normalizeStringProjectNumberField(
    obj: Record<string, unknown>,
    registry: Record<string, ProjectRegistryEntry> | undefined
): boolean {
    if (!('project_number' in obj) || typeof obj['project_number'] !== 'string') return false
    const cleaned = obj['project_number'].trim()
    const parsed = /^p-?\d+$/i.test(cleaned)
        ? parseCanonicalPositiveInt(cleaned.replace(/^p-?/i, ''))
        : parseCanonicalPositiveInt(cleaned)
    if (parsed !== undefined) {
        obj['project_number'] = parsed
        return true
    }
    if (cleaned === '' || cleaned === '*' || /^[0-9]/.test(cleaned) || /^p-?\d/i.test(cleaned)) return false

    const canonicalKey = findCanonicalRegistryKey(cleaned, registry)
    const matchedWs =
        canonicalKey ?? (cleaned.toLowerCase() === 'default' ? 'default' : undefined)
    if (
        matchedWs !== undefined &&
        (obj['workspace_id'] === undefined ||
            obj['workspace_id'] === null ||
            obj['workspace_id'] === '')
    ) {
        obj['workspace_id'] = matchedWs
        delete obj['project_number']
        return true
    }
    return false
}

/** Normalise `project_name` / string `project_number` aliases into numeric or workspace fields. */
export function normalizeProjectFields(
    obj: Record<string, unknown>,
    projectRegistry?: Record<string, ProjectRegistryEntry>
): boolean {
    const registry = projectRegistry ?? getActiveProjectRegistry() ?? loadProjectRegistryFromConfig()
    let modified = normalizeWorkspaceAliasKeys(obj)
    if (normalizeStringProjectNumberField(obj, registry)) modified = true
    if (applyNamedProjectAlias(obj, registry)) modified = true
    return modified
}

/** Fill in `workspace_id` / `project_number` from explicit scope or env without synthesizing `'default'`. */
export function inferWorkspaceAndProject(
    obj: Record<string, unknown>,
    projectRegistry?: Record<string, ProjectRegistryEntry>
): boolean {
    let modified = false
    const registry = projectRegistry ?? getActiveProjectRegistry() ?? loadProjectRegistryFromConfig()
    const rawWs = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'].trim() : undefined
    const wsId = rawWs !== undefined && rawWs !== '' ? rawWs : undefined
    const isDefaultWs = wsId?.toLowerCase() === 'default'
    const projNum =
        typeof obj['project_number'] === 'number' && !Number.isNaN(obj['project_number'])
            ? obj['project_number']
            : undefined

    // [INVARIANT] H2: only apply MCP_WORKSPACE_ID when neither workspace_id nor project_number
    // was explicitly supplied so an explicit project_number can resolve its own workspace.
    if (
        wsId === undefined &&
        projNum === undefined &&
        process.env['MCP_WORKSPACE_ID'] !== undefined &&
        process.env['MCP_WORKSPACE_ID'].trim() !== ''
    ) {
        obj['workspace_id'] = process.env['MCP_WORKSPACE_ID'].trim()
        modified = true
    }

    const effectiveWs = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'].trim() : undefined
    const hasConcreteWs =
        effectiveWs !== undefined && effectiveWs !== '' && effectiveWs.toLowerCase() !== 'default'
    if (projNum !== undefined && !hasConcreteWs && effectiveWs?.toLowerCase() !== 'default') {
        // [INVARIANT] H2: only look up registered workspaces for project_number; never fall back to disk CWD.
        const matchedWs = uniqueWorkspaceForProject(projNum, registry)
        if (matchedWs !== undefined && matchedWs !== 'default') {
            obj['workspace_id'] = matchedWs
            modified = true
        }
    } else if (projNum === undefined && hasConcreteWs && !isDefaultWs && effectiveWs !== '*') {
        const resolved = resolveProjectContext(
            { workspace_id: effectiveWs },
            registry !== undefined ? { projectRegistry: registry } : undefined
        )
        if (resolved.projectNumber !== undefined) {
            obj['project_number'] = resolved.projectNumber
            modified = true
        }
    }

    return modified
}

export function healValidationAndScoreFields(obj: Record<string, unknown>): boolean {
    let modified = false

    for (const numField of ['trust_score', 'impact_score'] as const) {
        if (numField in obj && typeof obj[numField] === 'string') {
            const n = Number(obj[numField])
            if (!Number.isNaN(n)) {
                obj[numField] = n
                modified = true
            }
        }
    }

    if (
        'validation_status' in obj &&
        obj['validation_status'] !== undefined &&
        obj['validation_status'] !== null
    ) {
        const rawVs = obj['validation_status']
        const vsStr =
            typeof rawVs === 'string'
                ? rawVs.trim().toLowerCase()
                : typeof rawVs === 'number' || typeof rawVs === 'boolean'
                  ? String(rawVs)
                  : ''
        if (rawVs === true || PASSED_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'passed'
            modified = true
        } else if (rawVs === false || FAILED_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'failed'
            modified = true
        } else if (NONE_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'none'
            modified = true
        } else if (typeof rawVs === 'string' && !['passed', 'none', 'failed'].includes(vsStr)) {
            obj['validation_status'] = 'none'
            modified = true
        }
    }

    return modified
}
