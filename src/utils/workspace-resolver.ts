import type { ToolHandlerConfig } from '../types/index.js'

/**
 * Resolves the effective workspace ID from available context.
 * Priority: explicit workspace_id > project_number lookup > config default > 'default'
 */
export function resolveWorkspaceId(
    explicitWorkspaceId: string | undefined,
    projectNumber: number | undefined,
    config?: ToolHandlerConfig
): string {
    if (explicitWorkspaceId) return explicitWorkspaceId
    if (projectNumber !== undefined && projectNumber !== null && config?.projectRegistry) {
        for (const [key, entry] of Object.entries(config.projectRegistry)) {
            if (entry.project_number === projectNumber) return key
        }
    }
    return config?.defaultWorkspaceId ?? 'default'
}
