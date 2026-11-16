/**
 * Team Merge Tags Tool
 */

import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../../utils/write-scope.js'
import { TEAM_DB_ERROR_RESPONSE, triggerTeamNotifications, resolveTeamProjectNumber } from '../helpers.js'
import {
    TeamMergeTagsSchema,
    TeamMergeTagsSchemaMcp,
    TeamMergeTagsOutputSchema,
} from '../schemas.js'

export function createTeamMergeTagsTool(context: ToolContext): ToolDefinition {
    const { teamDb } = context

    return {
        name: 'team_merge_tags',
        title: 'Merge Team Tags',
        description:
            'Merge a source tag into a target tag in the team database. All entries with the source tag will be re-tagged with the target tag. Only updates non-deleted entries. Requires TEAM_DB_PATH.',
        group: 'team',
        inputSchema: TeamMergeTagsSchemaMcp,
        outputSchema: TeamMergeTagsOutputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false,
        },
        capabilities: {
            requiresAdminScope: true,
        },
        handler: (params: unknown) => {
            try {
                if (!teamDb) {
                    return { ...TEAM_DB_ERROR_RESPONSE }
                }

                const { source_tag, target_tag, project_number, workspace_id } =
                    TeamMergeTagsSchema.parse(params)

                if (workspace_id?.trim() === '*') {
                    throw new ValidationError(
                        "Wildcard workspace_id '*' is not supported for team_merge_tags. Specify a concrete workspace_id."
                    )
                }

                if (source_tag === target_tag) {
                    return {
                        success: false,
                        error: 'Source and target tags must be different',
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        suggestion: 'Provide two different tag names',
                        recoverable: true,
                    }
                }

                const wsId = resolveWriteWorkspaceId(workspace_id, project_number, context.config)
                const scopedProject = resolveTeamProjectNumber(
                    context,
                    wsId,
                    project_number,
                    workspace_id
                )
                const result = teamDb.mergeTags(
                    source_tag,
                    target_tag,
                    wsId,
                    alignedProjectFilter(
                        wsId,
                        scopedProject ?? undefined,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )
                )

                triggerTeamNotifications(context)

                return {
                    success: true,
                    message: `Merged tag "${source_tag}" into "${target_tag}". Updated ${String(result.entriesUpdated)} entries.`,
                    entriesUpdated: result.entriesUpdated,
                    sourceDeleted: result.sourceDeleted,
                }
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}
