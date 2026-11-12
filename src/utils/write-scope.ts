import { ValidationError } from '../types/errors.js'
import { loadProjectRegistryFromConfig } from './workspace-resolver.js'
import type { ProjectRegistryEntry } from '../types/index.js'

export type ProjectRegistry = Record<string, Pick<ProjectRegistryEntry, 'project_number'>>

export function activeProjectRegistry(registry?: ProjectRegistry): ProjectRegistry | undefined {
    return registry ?? loadProjectRegistryFromConfig()
}

/** A named registry workspace. `*`, `default`, and blanks are not registry keys. */
export function concreteWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'default') return undefined
    return trimmed
}

/** Workspace stored on a row. `default` is a real workspace. Only `*` and blanks are unscoped. */
function persistedWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

export function exactRegistryKey(
    workspaceId: string,
    registry: ProjectRegistry | undefined
): string | undefined {
    if (registry === undefined) return undefined
    const lower = workspaceId.toLowerCase()
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === lower) return key
    }
    return undefined
}

export function workspacesForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string[] {
    if (registry === undefined) return []
    const matches: string[] = []
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number === projectNumber) matches.push(key)
    }
    return matches
}

export function uniqueWorkspaceForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string | undefined {
    const matches = workspacesForProject(projectNumber, registry)
    return matches.length === 1 ? matches[0] : undefined
}

export function workspaceForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string | undefined {
    const matches = workspacesForProject(projectNumber, registry)
    if (matches.length > 1) {
        throw new ValidationError(
            `project_number ${String(projectNumber)} is registered to more than one workspace.`,
            { projectNumber }
        )
    }
    return matches[0]
}

function suppliedProject(projectNumber: number | null | undefined): number | undefined {
    if (typeof projectNumber !== 'number' || Number.isNaN(projectNumber)) return undefined
    return projectNumber
}

/**
 * Keep a row on one workspace and that workspace's project.
 * A concrete workspace whose project number belongs to a different registered
 * workspace is rejected. An omitted number on a registered workspace is filled
 * from the registry.
 */
export function pairStoredScope(
    workspaceId: string | undefined,
    projectNumber: number | null | undefined,
    registry: ProjectRegistry | undefined
): { workspaceId: string | undefined; projectNumber: number | null | undefined } {
    const concrete = persistedWorkspace(workspaceId)
    const key = concrete !== undefined ? exactRegistryKey(concrete, registry) : undefined
    const registryProject = key !== undefined ? registry?.[key]?.project_number : undefined
    const supplied = suppliedProject(projectNumber)
    const owner = supplied !== undefined ? workspaceForProject(supplied, registry) : undefined

    if (
        concrete !== undefined &&
        owner !== undefined &&
        key?.toLowerCase() !== owner.toLowerCase()
    ) {
        throw new ValidationError(
            `project_number ${String(supplied)} belongs to workspace '${owner}', not '${concrete}'.`,
            { workspaceId: concrete, projectNumber: supplied }
        )
    }
    if (
        key !== undefined &&
        registryProject !== undefined &&
        supplied !== undefined &&
        supplied !== registryProject
    ) {
        throw new ValidationError(
            `workspace '${key}' uses project_number ${String(registryProject)}, not ${String(supplied)}.`,
            { workspaceId: key, projectNumber: supplied }
        )
    }

    const pairedProject = supplied ?? registryProject
    return {
        workspaceId: key ?? workspaceId,
        projectNumber: pairedProject ?? projectNumber,
    }
}

/**
 * A read filter keeps a requested project number when it belongs to that workspace.
 * `*` and `default` keep the requested number. A concrete workspace with a different
 * registry project is rejected.
 */
export function alignedProjectFilter(
    workspaceId: string,
    requested: number | undefined,
    registry: ProjectRegistry | undefined
): number | undefined {
    if (requested === undefined) return undefined
    const trimmed = workspaceId.trim()
    // `*` remains an admin read override. `default` is a stored workspace and is pair-checked.
    if (trimmed === '' || trimmed === '*') return requested
    const paired = pairStoredScope(trimmed, requested, registry)
    return typeof paired.projectNumber === 'number' ? paired.projectNumber : requested
}
