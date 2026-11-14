import type { ToolHandlerConfig } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'

/**
 * Resolve the workspace for a write operation (create/update/import).
 * The wildcard workspace '*' is only valid for reads and is rejected here.
 */
export function resolveWriteWorkspaceId(
    explicitWorkspaceId: string | undefined,
    projectNumber: number | undefined,
    config?: ToolHandlerConfig,
    content?: string,
    tags?: string[]
): string {
    if (explicitWorkspaceId?.trim() === '*') {
        throw new ValidationError(
            "workspace_id '*' is a read-only wildcard and cannot be used for write operations. Specify a concrete workspace_id or project_number."
        )
    }
    return resolveWorkspaceId(explicitWorkspaceId, projectNumber, config, content, tags)
}
