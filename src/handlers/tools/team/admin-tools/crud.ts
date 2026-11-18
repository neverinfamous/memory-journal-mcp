/**
 * Team Admin CRUD Tools - 4 tools
 *
 * Tools: team_update_entry, team_delete_entry, team_restore_entry, team_merge_tags
 */

import type { z } from 'zod'
import type { JournalEntry, ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { logger } from '../../../../utils/logger.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, triggerTeamNotifications } from '../helpers.js'
import { checkSingleTeamOwnership, missingProjectNumberResponse, type TeamDbInstance } from './batch-delete-helpers.js'
import { resolveTeamMutationProjectNumber } from './team-pk-scope-helpers.js'
import { createTeamMergeTagsTool } from './merge-tags-tool.js'
import {
    TeamUpdateEntrySchema,
    TeamUpdateEntrySchemaMcp,
    TeamDeleteEntrySchema,
    TeamDeleteEntrySchemaMcp,
    TeamRestoreEntrySchema,
    TeamRestoreEntrySchemaMcp,
    TeamUpdateOutputSchema,
    TeamDeleteOutputSchema,
    TeamRestoreOutputSchema,
} from '../schemas.js'

type TeamUpdateInput = z.infer<typeof TeamUpdateEntrySchema>

function resolveTeamUpdateScope(
    teamDb: TeamDbInstance,
    context: ToolContext,
    input: TeamUpdateInput
):
    | { wsId: string; projectNumber: number; existing: JournalEntry }
    | { errorResponse: Record<string, unknown> } {
    let wsId = resolveWriteWorkspaceId(input.workspace_id, input.project_number, context.config)
    const existing = teamDb.getEntryById(input.entry_id, wsId)
    if (!existing) {
        return {
            errorResponse: {
                success: false,
                error: `Team entry ${String(input.entry_id)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the team entry ID and try again',
                recoverable: true,
            },
        }
    }
    if (
        input.project_number !== undefined &&
        existing.projectNumber !== null &&
        existing.projectNumber !== undefined &&
        existing.projectNumber !== input.project_number
    ) {
        return {
            errorResponse: {
                success: false,
                error: `Team entry ${String(input.entry_id)} not found in project ${String(input.project_number)}`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the team entry ID and project number',
                recoverable: true,
            },
        }
    }
    // [INVARIANT] Existing entries keep their stored workspace; never re-infer scope from content/tags or pass '*' to the write resolver.
    wsId = resolveWriteWorkspaceId(
        input.workspace_id ?? existing.workspaceId,
        input.project_number,
        context.config
    )
    const projectNumber = resolveTeamMutationProjectNumber(
        context,
        wsId,
        input.project_number,
        input.workspace_id,
        existing.projectNumber
    )
    if (projectNumber === undefined || projectNumber === null) {
        return { errorResponse: missingProjectNumberResponse() }
    }
    if (
        existing.projectNumber !== null &&
        existing.projectNumber !== undefined &&
        existing.projectNumber !== projectNumber
    ) {
        return {
            errorResponse: {
                success: false,
                error: `Team entry ${String(input.entry_id)} not found in project ${String(projectNumber)}`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the team entry ID and project number',
                recoverable: true,
            },
        }
    }
    const denied = checkSingleTeamOwnership(teamDb, context, input.entry_id, 'modify', wsId)
    if (denied !== null) return { errorResponse: denied }
    return { wsId, projectNumber, existing }
}

async function executeTeamUpdateEntry(
    teamDb: TeamDbInstance,
    context: ToolContext,
    params: unknown
): Promise<Record<string, unknown>> {
    const input = TeamUpdateEntrySchema.parse(params)
    const scope = resolveTeamUpdateScope(teamDb, context, input)
    if ('errorResponse' in scope) return scope.errorResponse
    const { wsId, projectNumber } = scope
    const author = fetchAuthor(teamDb, input.entry_id)

    const updated = teamDb.updateEntry(input.entry_id, {
        content: input.content,
        entryType: input.entry_type,
        tags: input.tags,
        significanceType: input.significance_type,
        projectNumber,
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
    const needsVectorReindex =
        input.content !== undefined || input.tags !== undefined || input.entry_type !== undefined
    if (context.teamVectorManager !== undefined && needsVectorReindex) {
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
        ...(indexError !== undefined
            ? {
                  indexError,
                  vectorIndex: 'failed',
                  warning: `Team vector re-indexing failed: ${indexError}`,
              }
            : {}),
    }
}

function cleanupDeletedTeamVector(teamDb: TeamDbInstance, entryId: number): string | undefined {
    try {
        teamDb.deleteVector(entryId)
        return undefined
    } catch (vecErr) {
        const vecMessage = vecErr instanceof Error ? vecErr.message : String(vecErr)
        logger.warning('Team delete vector cleanup failed', { entryId, error: vecMessage })
        return `Vector index cleanup failed: ${vecMessage}`
    }
}

function executeTeamDeleteEntry(
    teamDb: TeamDbInstance,
    context: ToolContext,
    params: unknown
): Record<string, unknown> {
    const { entry_id, project_number, expected_version, workspace_id } =
        TeamDeleteEntrySchema.parse(params)

    let wsId = resolveWriteWorkspaceId(workspace_id, project_number, context.config)
    const existing = teamDb.getEntryByIdIncludeDeleted(entry_id, wsId)
    const projectNumber = resolveTeamMutationProjectNumber(
        context,
        wsId,
        project_number,
        workspace_id,
        existing?.projectNumber
    )
    if (projectNumber === undefined || projectNumber === null) {
        return missingProjectNumberResponse()
    }
    wsId = resolveWriteWorkspaceId(
        workspace_id ?? existing?.workspaceId,
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
            suggestion: 'Verify the team entry ID and project number, and try again',
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
            recoverable: true,
        }
    }

    const denied = checkSingleTeamOwnership(teamDb, context, entry_id, 'delete', wsId)
    if (denied !== null) return denied

    const deleted = teamDb.deleteEntry(entry_id, false, wsId)
    if (!deleted.success) {
        return {
            success: false,
            error: `Team entry ${String(entry_id)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the entry id and workspace_id.',
            recoverable: true,
        }
    }
    const deleteWarning = cleanupDeletedTeamVector(teamDb, entry_id)
    const warning = [deleted.warning, deleteWarning]
        .filter((item): item is string => item !== undefined)
        .join('; ')
    triggerTeamNotifications(context)

    return {
        success: true,
        message: `Team entry ${String(entry_id)} soft-deleted`,
        ...(warning !== '' ? { warning } : {}),
    }
}

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
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return await executeTeamUpdateEntry(teamDb, context, params)
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
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamDeleteEntry(teamDb, context, params)
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
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

                    const { entry_id, project_number, workspace_id } = TeamRestoreEntrySchema.parse(params)

                    let wsId = resolveWriteWorkspaceId(workspace_id, project_number, context.config)
                    const existing = teamDb.getEntryByIdIncludeDeleted(entry_id, wsId)
                    const projectNumber = resolveTeamMutationProjectNumber(
                        context,
                        wsId,
                        project_number,
                        workspace_id,
                        existing?.projectNumber
                    )
                    if (projectNumber === undefined || projectNumber === null) {
                        return missingProjectNumberResponse()
                    }
                    wsId = resolveWriteWorkspaceId(
                        workspace_id ?? existing?.workspaceId,
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

                    const denied = checkSingleTeamOwnership(teamDb, context, entry_id, 'restore', wsId)
                    if (denied !== null) return denied

                    const success = teamDb.restoreEntry(entry_id, wsId)
                    if (!success) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Team entry ${String(entry_id)} not found or not deleted`,
                        }
                    }

                    let indexStatus: string | undefined
                    let warning: string | undefined
                    const restored = teamDb.getEntryById(entry_id, wsId)
                    if (
                        context.teamVectorManager !== undefined &&
                        restored !== null &&
                        restored !== undefined
                    ) {
                        try {
                            await context.teamVectorManager.addEntry(restored)
                            indexStatus = 'success'
                        } catch (vecErr) {
                            indexStatus = 'failed'
                            warning = `Team vector re-indexing failed: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`
                        }
                    }

                    triggerTeamNotifications(context)

                    return {
                        success: true,
                        entryId: entry_id,
                        ...(indexStatus !== undefined ? { indexStatus } : {}),
                        ...(warning !== undefined ? { warning } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        createTeamMergeTagsTool(context),
    ]
}
