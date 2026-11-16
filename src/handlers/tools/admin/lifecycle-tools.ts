
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAutoPruneScope } from '../../../utils/workspace-resolver.js'
import { RunAutoPruneSchema, RunAutoPruneSchemaMcp, RunAutoPruneOutputSchema } from './schemas.js'
import { runAutoPrune } from '../../../server/auto-prune.js'


function resolveLifecyclePruneScope(
    parsed: ReturnType<typeof RunAutoPruneSchema.parse>,
    config: ToolContext['config']
): { workspaceId: string; projectNumber?: number } {
    const explicitWs = parsed.workspace_id?.trim()
    const explicitProj = parsed.project_number
    if (explicitWs === '*') {
        return {
            workspaceId: '*',
            ...(explicitProj !== undefined ? { projectNumber: explicitProj } : {}),
        }
    }
    const targetWs =
        explicitWs !== undefined && explicitWs !== ''
            ? explicitWs
            : explicitProj === undefined
              ? config?.defaultWorkspaceId
              : undefined
    const targetProj =
        explicitProj ?? (explicitWs === undefined ? config?.defaultProjectNumber : undefined)
    return resolveAutoPruneScope(targetWs, targetProj, config?.projectRegistry, {
        runtime: config?.runtime,
    })
}

async function executeRunAutoPrune(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, config } = context
    const parsed = RunAutoPruneSchema.parse(params)
    const archiveDays = parsed.archive_older_than_days ?? config?.archiveOlderThanDays ?? 0
    const pruneDays = parsed.prune_older_than_days ?? config?.pruneOlderThanDays ?? 0
    const hardDeleteDays = parsed.hard_delete_older_than_days ?? config?.hardDeleteOlderThanDays ?? 0
    const threshold = parsed.importance_threshold ?? config?.pruneImportanceThreshold ?? 0.15
    const pruneScope = resolveLifecyclePruneScope(parsed, config)
    const excludeTags = config?.pruneExcludeTags

    const pruneResult = await runAutoPrune(db, {
        archiveOlderThanDays: archiveDays,
        pruneOlderThanDays: pruneDays,
        hardDeleteOlderThanDays: hardDeleteDays,
        importanceThreshold: threshold,
        dryRun: parsed.dry_run,
        ...(excludeTags !== undefined ? { excludeTags } : {}),
        workspaceId: pruneScope.workspaceId,
        ...(pruneScope.projectNumber !== undefined ? { projectNumber: pruneScope.projectNumber } : {}),
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
}

export function getLifecycleTools(context: ToolContext): ToolDefinition[] {
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
                    return await executeRunAutoPrune(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            }
        }
    ]
}
