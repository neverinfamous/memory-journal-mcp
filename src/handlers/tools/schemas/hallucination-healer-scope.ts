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
import { getActiveProjectRegistry } from '../../../codemode/normalizers/generic-field-aliases.js'
import {
    PASSED_VALIDATION_ALIASES,
    FAILED_VALIDATION_ALIASES,
    NONE_VALIDATION_ALIASES,
} from './constants-and-primitives.js'

/** Normalise `project_name` / string `project_number` aliases into numeric or workspace fields. */
export function normalizeProjectFields(
    obj: Record<string, unknown>,
    projectRegistry?: Record<string, ProjectRegistryEntry>
): boolean {
    let modified = false
    const registry = projectRegistry ?? getActiveProjectRegistry() ?? loadProjectRegistryFromConfig()

    if (obj['workspace_id'] === undefined && typeof obj['workspaceId'] === 'string') {
        obj['workspace_id'] = obj['workspaceId']
        delete obj['workspaceId']
        modified = true
    } else if (obj['workspace_id'] === undefined && typeof obj['workspace'] === 'string') {
        obj['workspace_id'] = obj['workspace']
        delete obj['workspace']
        modified = true
    }

    const existingWs =
        typeof obj['workspace_id'] === 'string' && obj['workspace_id'].trim() !== ''
            ? obj['workspace_id'].trim()
            : undefined
    const rawProjectProp =
        typeof obj['project'] === 'string' || typeof obj['project'] === 'number'
            ? obj['project']
            : undefined
    const rawProjName = obj['project_name'] ?? obj['projectName'] ?? rawProjectProp
    if (rawProjName !== undefined) {
        const strVal =
            typeof rawProjName === 'string' || typeof rawProjName === 'number'
                ? String(rawProjName).trim()
                : ''
        const num = Number(strVal)
        let conflicting = false
        if (!Number.isNaN(num) && strVal !== '') {
            if (typeof obj['project_number'] === 'number' && obj['project_number'] !== num) {
                conflicting = true
            } else if (!('project_number' in obj) || obj['project_number'] === undefined) {
                obj['project_number'] = num
            }
        } else if (strVal === '*') {
            conflicting = true
        } else if (strVal !== '') {
            const canonicalKey = findCanonicalRegistryKey(strVal, registry)
            const matchedWs =
                canonicalKey ?? (strVal.toLowerCase() === 'default' ? 'default' : undefined)
            if (matchedWs === undefined) {
                conflicting = true
            } else {
                const matchedProject =
                    canonicalKey !== undefined
                        ? registry?.[canonicalKey]?.project_number
                        : undefined
                if (
                    existingWs !== undefined &&
                    existingWs.toLowerCase() !== matchedWs.toLowerCase()
                ) {
                    conflicting = true
                } else if (
                    typeof obj['project_number'] === 'number' &&
                    matchedProject !== undefined &&
                    obj['project_number'] !== matchedProject
                ) {
                    conflicting = true
                } else if (existingWs === undefined) {
                    obj['workspace_id'] = matchedWs
                }
            }
        }
        if (!conflicting) {
            delete obj['project_name']
            delete obj['projectName']
            if (rawProjectProp !== undefined) delete obj['project']
            modified = true
        }
    }

    if ('project_number' in obj && typeof obj['project_number'] === 'string') {
        const cleaned = obj['project_number'].trim()
        let num = Number(cleaned)
        if (Number.isNaN(num) && /^p-?\d+$/i.test(cleaned)) {
            num = Number(cleaned.replace(/^p-?/i, ''))
        }
        if (!Number.isNaN(num) && cleaned !== '') {
            obj['project_number'] = num
            modified = true
        } else if (cleaned !== '' && cleaned !== '*') {
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
                modified = true
            }
        }
    }

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
