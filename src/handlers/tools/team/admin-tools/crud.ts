/**
 * Team Admin CRUD Tools - 4 tools
 *
 * Tools: team_update_entry, team_delete_entry, team_restore_entry, team_merge_tags
 */

import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../../utils/workspace-resolver.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, triggerTeamNotifications } from '../helpers.js'
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
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    coerceSignificanceAlias(params)

                    const input = TeamUpdateEntrySchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)

                    // Verify entry exists
                    const existing = teamDb.getEntryById(input.entry_id, wsId)
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

                    const projectNumber = input.project_number ?? existing.projectNumber
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }



                    const author = fetchAuthor(teamDb, input.entry_id)

                    const currentUser = resolveAuthenticatedAuthor()
                    const codemodeBypass = context.config?.codemodeInternalFullAccess === true

                    if (author && author !== currentUser && !codemodeBypass) {
                        return {
                            success: false,
                            error: `Permission Denied: Only the original author ("${author}") can modify this team entry.`,
                            code: 'PERMISSION_DENIED',
                            category: 'auth',
                            suggestion: 'You can only update entries that you authored.',
                            recoverable: false,
                        }
                    }

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
                    })

                    triggerTeamNotifications(context)

                    return {
                        success: true,
                        entry: { ...updated, author },
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
                'Soft-delete a team entry (marks as deleted, preservable). Calling with permanent: true on a previously soft-deleted entry works. Returns success: false for nonexistent entries. Requires TEAM_DB_PATH.',
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

                    const projectNumber = project_number
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }

                    // Verify entry exists and belongs to project (if projectNumber is specified)
                    const existing = teamDb.getEntryByIdIncludeDeleted(entry_id, workspace_id)
                    if (
                        !existing ||
                        (projectNumber !== undefined && existing.projectNumber !== projectNumber)
                    ) {
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

                    const author = fetchAuthor(teamDb, entry_id)

                    const currentUser = resolveAuthenticatedAuthor()
                    const codemodeBypass = context.config?.codemodeInternalFullAccess === true

                    if (author && author !== currentUser && !codemodeBypass) {
                        return {
                            success: false,
                            error: `Permission Denied: Only the original author ("${author}") can delete this team entry.`,
                            code: 'PERMISSION_DENIED',
                            category: 'auth',
                            suggestion: 'You can only delete entries that you authored.',
                            recoverable: false,
                        }
                    }

                    teamDb.deleteEntry(entry_id)
                    teamDb.deleteVector(entry_id)

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
                    
                    const projectNumber = project_number
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }

                    // Verify entry exists and belongs to project (if projectNumber is specified)
                    const existing = teamDb.getEntryByIdIncludeDeleted(entry_id, workspace_id)
                    if (!existing || (projectNumber !== undefined && existing.projectNumber !== projectNumber)) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${projectNumber}`,
                        }
                    }
                    
                    const success = teamDb.restoreEntry(entry_id)
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
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { source_tag, target_tag } = TeamMergeTagsSchema.parse(params)

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

                    const result = teamDb.mergeTags(source_tag, target_tag)

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
