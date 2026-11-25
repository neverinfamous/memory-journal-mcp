import { loadProjectRegistryFromConfig } from './workspace-resolver.js'
import type { ProjectRegistryEntry } from '../types/index.js'
import {
    concreteWorkspace,
    exactRegistryKey,
    workspacesForProject,
    uniqueWorkspaceForProject,
    workspaceForProject,
    pairStoredScope,
    alignedProjectFilter,
    type ProjectRegistry,
} from './workspace-registry-match.js'

export {
    concreteWorkspace,
    exactRegistryKey,
    workspacesForProject,
    uniqueWorkspaceForProject,
    workspaceForProject,
    pairStoredScope,
    alignedProjectFilter,
    type ProjectRegistry,
}

export function activeProjectRegistry(
    registry?: Record<string, ProjectRegistryEntry>
): Record<string, ProjectRegistryEntry> | undefined
export function activeProjectRegistry(registry?: ProjectRegistry): ProjectRegistry | undefined
export function activeProjectRegistry(registry?: ProjectRegistry): ProjectRegistry | undefined {
    return registry ?? loadProjectRegistryFromConfig()
}
