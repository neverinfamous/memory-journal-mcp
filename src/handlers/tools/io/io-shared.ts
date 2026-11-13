import type { ToolHandlerConfig } from '../../../types/index.js'
import {
    resolveProjectContext,
    resolveWorkspaceFromFilePath,
} from '../../../utils/workspace-resolver.js'

/** Maximum size of a single markdown file accepted by the import tools. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

export function wildcardWriteRejection(workspaceId: string | undefined): Record<string, unknown> | undefined {
    if (workspaceId?.trim() !== '*') return undefined
    return {
        success: false,
        error: "workspace_id '*' cannot be used for a single-directory import or export.",
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

/**
 * Resolve the target workspace/project for a directory import.
 * [INVARIANT] C3: the requested/directory project is only used as a fallback when the caller
 * did not name a workspace — an explicit workspace (including 'default') never inherits a
 * foreign project number.
 */
export function resolveImportScope(
    input: { workspace_id?: string | undefined; project_number?: number | undefined; source_dir: string },
    config: ToolHandlerConfig | undefined
): { wsId: string; effectiveProjectNum: number | undefined } {
    const dirMatch =
        input.workspace_id === undefined && input.project_number === undefined
            ? resolveWorkspaceFromFilePath(input.source_dir, config)
            : undefined
    const requestedProject = input.project_number ?? dirMatch?.projectNumber
    const resolved = resolveProjectContext(
        {
            workspace_id: input.workspace_id ?? dirMatch?.workspaceId,
            project_number: requestedProject,
        },
        config
    )
    return {
        wsId: resolved.workspaceId,
        effectiveProjectNum:
            resolved.projectNumber ?? (input.workspace_id === undefined ? requestedProject : undefined),
    }
}
