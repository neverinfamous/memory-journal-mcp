import type { ToolHandlerConfig } from '../../../types/index.js'
import {
    resolveProjectContext,
    resolveWorkspaceFromFilePath,
} from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'

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
 * [INVARIANT] C4: only lock `wsId` onto `ImportOptions` when the caller explicitly names a
 * workspace, supplies a project number owned by a registered workspace, or targets a registered
 * repository directory; otherwise leave `wsId` undefined so each file keeps its frontmatter scope.
 */
export function resolveImportScope(
    input: { workspace_id?: string | undefined; project_number?: number | undefined; source_dir: string },
    config: ToolHandlerConfig | undefined
): { wsId: string | undefined; effectiveProjectNum: number | undefined } {
    const dirMatch =
        input.workspace_id === undefined && input.project_number === undefined
            ? resolveWorkspaceFromFilePath(input.source_dir, config)
            : undefined
    const explicitWs = input.workspace_id?.trim()
    const hasExplicitWs = explicitWs !== undefined && explicitWs !== ''
    const projectOwner =
        !hasExplicitWs && dirMatch === undefined && input.project_number !== undefined
            ? uniqueWorkspaceForProject(input.project_number, activeProjectRegistry(config?.projectRegistry))
            : undefined
    if (!hasExplicitWs && dirMatch === undefined && input.project_number === undefined) {
        return { wsId: undefined, effectiveProjectNum: undefined }
    }
    const requestedProject = input.project_number ?? dirMatch?.projectNumber
    const resolved = resolveProjectContext(
        {
            workspace_id: input.workspace_id ?? dirMatch?.workspaceId ?? projectOwner,
            project_number: requestedProject,
        },
        config
    )
    const shouldLockWs = hasExplicitWs || dirMatch !== undefined || projectOwner !== undefined
    return {
        wsId: shouldLockWs ? resolved.workspaceId : undefined,
        effectiveProjectNum:
            resolved.projectNumber ?? (input.workspace_id === undefined ? requestedProject : undefined),
    }
}
