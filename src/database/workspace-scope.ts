/**
 * Omitted workspace means the `default` workspace.
 * `*` is the only scope that reads or writes every workspace.
 */
export function effectiveWorkspace(workspaceId: string | undefined): string {
    const trimmed = workspaceId?.trim()
    if (trimmed === undefined || trimmed.length === 0) return 'default'
    return trimmed
}

