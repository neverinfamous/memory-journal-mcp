import type { ToolContext } from '../../../types/index.js'

/** [INTENT] M4: vector cleanup is non-critical after a committed delete; surface failures as warnings. */
export function safeDeleteVectors(db: ToolContext['db'], ids: number[]): string[] {
    const warnings: string[] = []
    for (const id of ids) {
        try {
            db.deleteVector(id)
        } catch (err) {
            warnings.push(
                `Vector cleanup failed for entry ${String(id)}: ${err instanceof Error ? err.message : String(err)}`
            )
        }
    }
    return warnings
}

export function vectorWarningField(warnings: string[]): { warning?: string } {
    return warnings.length > 0 ? { warning: warnings.join('; ') } : {}
}

/**
 * [INVARIANT] C2: `workspace_id: '*'` updates scoped by project_number may only touch
 * entries owned by that project. Returns the offending entry IDs.
 */
export function findWildcardProjectMismatches(
    db: ToolContext['db'],
    updates: readonly { entry_id: number; workspace_id?: string | undefined; project_number?: number | undefined }[],
    rootWorkspaceId: string | undefined,
    rootProjectNumber: number | undefined
): number[] {
    return updates
        .filter((u) => {
            const ws = u.workspace_id ?? rootWorkspaceId
            const pn = u.project_number ?? rootProjectNumber
            if (ws !== '*' || pn === undefined) return false
            return db.getEntryById(u.entry_id, '*')?.projectNumber !== pn
        })
        .map((u) => u.entry_id)
}
