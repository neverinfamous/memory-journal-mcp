/**
 * Team Admin CRUD Tools - 4 tools
 *
 * Tools: team_update_entry, team_delete_entry, team_restore_entry, team_merge_tags
 */

import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { logger } from '../../../../utils/logger.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import { alignedProjectFilter } from '../../../../utils/write-scope.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, triggerTeamNotifications, resolveTeamProjectNumber } from '../helpers.js'
import { checkSingleTeamOwnership, missingProjectNumberResponse } from './batch-delete-helpers.js'
import {
    TeamUpdateEntrySchema,
    TeamUpdateEntrySchemaMcp,
    TeamDeleteEntrySchema,
    TeamDeleteEntrySchemaMcp,
    TeamRestoreEntrySchema,
    TeamRestoreEntrySchemaMcp,
    TeamMergeTagsSchema,
    TeamMergeTagsSchemaMcp,
    TeamUpdateOutputSchema,
    TeamDeleteOutputSchema,
    TeamRestoreOutputSchema,
    TeamMergeTagsOutputSchema,
} from '../schemas.js'
import { coerceSignificanceAlias } from '../../schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAdminCrudTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_update_entry',
            title: 'Update Team Entry',
            description:
                'Update a team entry. When updating content, preserve the existing markdown ' +
                'structure (## section headers). Do NOT restructure or add new top-level sections ' +
                'unless explicitly requested. Pass expected_version for optimistic locking. ' +
                'Pass null to clear a metadata field. Supports content, type, tags, and ' +
                '11 metadata fields. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamUpdateEntrySchemaMcp,
            outputSchema: TeamUpdateOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    coerceSignificanceAlias(params)

                    const input = TeamUpdateEntrySchema.parse(params)
                    let wsId =
                        input.workspace_id === '*'
                            ? '*'
                            : resolveWriteWorkspaceId(
                                  input.workspace_id,
                                  input.project_number,
                                  context.config
                              )

                    // Verify entry exists
                    let existing = teamDb.getEntryById(input.entry_id, wsId)
                    if (
                        !existing &&
                        input.workspace_id === undefined &&
                        input.project_number === undefined
                    ) {
                        existing = teamDb.getEntryById(input.entry_id, '*')
                        if (existing?.workspaceId !== undefined) {
                            wsId = existing.workspaceId
                        }
                    }
                    if (!existing) {
                        return {
                            success: false,
                            error: `Team entry ${String(input.entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and try again',
                            recoverable: true,
                        }
                    }

                    if (
                        input.workspace_id === '*' &&
                        input.project_number !== undefined &&
                        existing.projectNumber !== input.project_number
                    ) {
                        return {
                            success: false,
                            error: `Team entry ${String(input.entry_id)} not found in project ${String(input.project_number)}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number',
                            recoverable: true,
                        }
                    }

                    // [INVARIANT] Existing entries keep their stored workspace; never re-infer scope from content/tags or pass '*' to the write resolver.
                    wsId = resolveWriteWorkspaceId(
                        input.workspace_id === undefined || input.workspace_id === '*'
                            ? existing.workspaceId
                            : input.workspace_id,
                        input.project_number,
                        context.config
                    )
                    const projectNumber = resolveTeamProjectNumber(
                        context,
                        wsId,
                        input.project_number ?? existing.projectNumber
                    )
                    if (projectNumber === undefined || projectNumber === null) {
                        return missingProjectNumberResponse()
                    }

                    const author = fetchAuthor(teamDb, input.entry_id)
                    const denied = checkSingleTeamOwnership(teamDb, context, input.entry_id, 'modify')
                    if (denied !== null) return denied

                    const updated = teamDb.updateEntry(input.entry_id, {
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        significanceType: input.significance_type,
                        projectNumber: projectNumber,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: input.issue_url,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status,
                        isArchived: input.is_archived,
                        expectedVersion: input.expected_version,
                        autoContext: input.auto_context,
                        workspaceId: wsId,
                        impactScore: input.impact_score,
                        trustScore: input.trust_score,
                        validationStatus: input.validation_status,
                        sessionId: input.session_id,
                    })

                    if (!updated) {
                        return {
                            success: false,
                            error: `Team entry ${String(input.entry_id)} not found or not updated`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and workspace_id.',
                            recoverable: true,
                        }
                    }

                    let indexError: string | undefined
                    if (context.teamVectorManager !== undefined && input.content !== undefined) {
                        try {
                            await context.teamVectorManager.addEntry(updated)
                        } catch (indexErr) {
                            indexError = indexErr instanceof Error ? indexErr.message : String(indexErr)
                        }
                    }

                    triggerTeamNotifications(context)

                    return {
                        success: true,
                        entry: { ...updated, author },
                        ...(indexError !== undefined ? { indexError } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_delete_entry',
            title: 'Delete Team Entry',
            description:
                'Soft-delete a team entry (marks as deleted, preservable via team_restore_entry). Returns success: false for nonexistent entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamDeleteEntrySchemaMcp,
            outputSchema: TeamDeleteOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, project_number, expected_version, workspace_id } = TeamDeleteEntrySchema.parse(params)

                    let wsId =
                        workspace_id === '*'
                            ? '*'
                            : resolveWriteWorkspaceId(workspace_id, project_number, context.config)
                    let existing = teamDb.getEntryByIdIncludeDeleted(entry_id, wsId)
                    if (
                        !existing &&
                        workspace_id === undefined &&
                        project_number === undefined
                    ) {
                        existing = teamDb.getEntryByIdIncludeDeleted(entry_id, '*')
                        if (existing?.workspaceId !== undefined) {
                            wsId = existing.workspaceId
                        }
                    }

                    const projectNumber =
                        project_number ??
                        existing?.projectNumber ??
                        resolveTeamProjectNumber(context, wsId, project_number)
                    if (projectNumber === undefined || projectNumber === null) {
                        return missingProjectNumberResponse()
                    }
                    wsId = resolveWriteWorkspaceId(
                        workspace_id === undefined || workspace_id === '*'
                            ? existing?.workspaceId
                            : workspace_id,
                        projectNumber,
                        context.config
                    )

                    // Verify entry exists and belongs to project (if projectNumber is specified)
                    if (existing?.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${projectNumber}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    if (expected_version !== undefined && existing.version !== expected_version) {
                        return {
                            success: false,
                            error: `Concurrency conflict: Expected version ${expected_version} but found ${existing.version}. Please get the latest entry before deleting.`,
                            code: 'CONCURRENCY_ERROR',
                            category: 'validation',
                            suggestion: 'Get the latest entry and use its version',
                            recoverable: true
                        }
                    }

                    const denied = checkSingleTeamOwnership(teamDb, context, entry_id, 'delete')
                    if (denied !== null) return denied

                    const deleted = teamDb.deleteEntry(entry_id, false, wsId)
                    if (!deleted) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry id and workspace_id.',
                            recoverable: true,
                        }
                    }
                    try {
                        teamDb.deleteVector(entry_id)
                    } catch (vecErr) {
                        logger.warning('Team delete vector cleanup failed', {
                            entryId: entry_id,
                            error: vecErr instanceof Error ? vecErr.message : String(vecErr),
                        })
                    }

                    triggerTeamNotifications(context)

                    return {
                        success: true,
                        message: `Team entry ${String(entry_id)} soft-deleted`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_restore_entry',
            title: 'Restore Team Entry',
            description: 'Restore a soft-deleted team entry. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamRestoreEntrySchemaMcp,
            outputSchema: TeamRestoreOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

                    const { entry_id, project_number, workspace_id } = TeamRestoreEntrySchema.parse(params)

                    let wsId =
                        workspace_id === '*'
                            ? '*'
                            : resolveWriteWorkspaceId(workspace_id, project_number, context.config)
                    let existing = teamDb.getEntryByIdIncludeDeleted(entry_id, wsId)
                    if (
                        !existing &&
                        workspace_id === undefined &&
                        project_number === undefined
                    ) {
                        existing = teamDb.getEntryByIdIncludeDeleted(entry_id, '*')
                        if (existing?.workspaceId !== undefined) {
                            wsId = existing.workspaceId
                        }
                    }
                    const projectNumber =
                        project_number ??
                        existing?.projectNumber ??
                        resolveTeamProjectNumber(context, wsId, project_number)
                    if (projectNumber === undefined || projectNumber === null) {
                        return missingProjectNumberResponse()
                    }
                    wsId = resolveWriteWorkspaceId(
                        workspace_id === undefined || workspace_id === '*'
                            ? existing?.workspaceId
                            : workspace_id,
                        projectNumber,
                        context.config
                    )

                    // Verify entry exists and belongs to project (if projectNumber is specified)
                    if (existing?.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${projectNumber}`,
                        }
                    }

                    const success = teamDb.restoreEntry(entry_id, wsId)
                    if (!success) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Team entry ${String(entry_id)} not found or not deleted`,
                        }
                    }

                    triggerTeamNotifications(context)

                    return { success: true, entryId: entry_id }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_merge_tags',
            title: 'Merge Team Tags',
            description:
                'Merge a source tag into a target tag in the team database. All entries with the source tag will be re-tagged with the target tag. Only updates non-deleted entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamMergeTagsSchemaMcp,
            outputSchema: TeamMergeTagsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
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

                    const wsId =
                        workspace_id === '*'
                            ? '*'
                            : resolveWriteWorkspaceId(workspace_id, project_number, context.config)
                    const scopedProject =
                        wsId === '*'
                            ? project_number
                            : resolveTeamProjectNumber(context, wsId, project_number)
                    const result = teamDb.mergeTags(
                        source_tag,
                        target_tag,
                        wsId,
                        alignedProjectFilter(
                            wsId,
                            scopedProject ?? undefined,
                            context.config?.projectRegistry
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
        },
    ]
}
