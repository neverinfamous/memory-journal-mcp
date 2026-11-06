/**
 * Omitted workspace means the `default` workspace.
 * `*` is the only scope that reads or writes every workspace.
 */
export function effectiveWorkspace(workspaceId: string | undefined): string {
    if (workspaceId === undefined || workspaceId.length === 0) return 'default'
    return workspaceId
}

