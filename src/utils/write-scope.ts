import { ValidationError } from '../types/errors.js'
import { loadProjectRegistryFromConfig } from './workspace-resolver.js'
import type { ProjectRegistryEntry } from '../types/index.js'

export type ProjectRegistry = Record<string, Pick<ProjectRegistryEntry, 'project_number'>>

export function activeProjectRegistry(registry?: ProjectRegistry): ProjectRegistry | undefined {
    return registry ?? loadProjectRegistryFromConfig()
}

/** A workspace name that can own a row. `*`, `default`, and blanks stay unscoped. */
export function concreteWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'default') return undefined
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

export function workspaceForProject(
    projectNumber: number,
    registry: ProjectRegistry | undefined
): string | undefined {
    if (registry === undefined) return undefined
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number === projectNumber) return key
    }
    return undefined
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
    const concrete = concreteWorkspace(workspaceId)
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
 * A read filter uses the registry project of an explicit workspace.
 * `*` and `default` keep the requested number.
 */
export function alignedProjectFilter(
    workspaceId: string,
    requested: number | undefined,
    registry: ProjectRegistry | undefined
): number | undefined {
    if (requested === undefined) return undefined
    const concrete = concreteWorkspace(workspaceId)
    if (concrete === undefined) return requested
    const key = exactRegistryKey(concrete, registry)
    const registryProject = key !== undefined ? registry?.[key]?.project_number : undefined
    if (registryProject === undefined) return requested
    return registryProject
}
