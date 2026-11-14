
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAutoPruneScope } from '../../../utils/workspace-resolver.js'
import { RunAutoPruneSchema, RunAutoPruneSchemaMcp, RunAutoPruneOutputSchema } from './schemas.js'
import { runAutoPrune } from '../../../server/auto-prune.js'


export function getLifecycleTools(context: ToolContext): ToolDefinition[] {
    const { db } = context
    return [
        {
            name: 'run_auto_prune',
            title: 'Run Auto Prune',
            description: 'Manually trigger the autonomous pruning and cleanup routines. This evaluates entry importance, archives old entries, and hard-deletes stale softly-deleted ones.',
            group: 'admin',
            inputSchema: RunAutoPruneSchemaMcp,
            outputSchema: RunAutoPruneOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const parsed = RunAutoPruneSchema.parse(params)

                    const archiveDays =
                        parsed.archive_older_than_days ??
                        context.config?.archiveOlderThanDays ??
                        0
                    const pruneDays =
                        parsed.prune_older_than_days ??
                        context.config?.pruneOlderThanDays ??
                        0
                    const hardDeleteDays =
                        parsed.hard_delete_older_than_days ??
                        context.config?.hardDeleteOlderThanDays ??
                        0
                    const threshold =
                        parsed.importance_threshold ??
                        context.config?.pruneImportanceThreshold ??
                        0.15

                    const explicitWs = parsed.workspace_id?.trim()
                    const explicitProj = parsed.project_number
                    let pruneScope: { workspaceId: string; projectNumber?: number }
                    if (explicitWs === '*') {
                        pruneScope = {
                            workspaceId: '*',
                            ...(explicitProj !== undefined ? { projectNumber: explicitProj } : {}),
                        }
                    } else {
                        const targetWs =
                            explicitWs !== undefined && explicitWs !== ''
                                ? explicitWs
                                : explicitProj === undefined
                                  ? context.config?.defaultWorkspaceId
                                  : undefined
                        const targetProj =
                            explicitProj ??
                            (explicitWs === undefined ? context.config?.defaultProjectNumber : undefined)
                        pruneScope = resolveAutoPruneScope(
                            targetWs,
                            targetProj,
                            context.config?.projectRegistry,
                            { runtime: context.config?.runtime }
                        )
                    }

                    const excludeTags = context.config?.pruneExcludeTags
                    const pruneResult = await runAutoPrune(db, {
                        archiveOlderThanDays: archiveDays,
                        pruneOlderThanDays: pruneDays,
                        hardDeleteOlderThanDays: hardDeleteDays,
                        importanceThreshold: threshold,
                        dryRun: parsed.dry_run,
                        ...(excludeTags !== undefined ? { excludeTags } : {}),
                        workspaceId: pruneScope.workspaceId,
                        ...(pruneScope.projectNumber !== undefined
                            ? { projectNumber: pruneScope.projectNumber }
                            : {}),
                    })

                    if (pruneResult.aborted === true) {
                        return {
                            success: false,
                            error: 'Safety backup failed and no rows were changed.',
                            code: 'INTERNAL_ERROR',
                            category: 'internal',
                            recoverable: true,
                            archivedCount: pruneResult.archivedCount,
                            prunedCount: pruneResult.prunedCount,
                            hardDeletedCount: pruneResult.hardDeletedCount,
                            dryRun: parsed.dry_run,
                        }
                    }

                    return {
                        success: true,
                        archivedCount: pruneResult.archivedCount,
                        prunedCount: pruneResult.prunedCount,
                        hardDeletedCount: pruneResult.hardDeletedCount,
                        backupFile: pruneResult.backupFile || undefined,
                        dryRun: parsed.dry_run,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            }
        }
    ]
}
