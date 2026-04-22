/**
 * Team Admin Tools - 3 tools
 *
 * Tools: team_update_entry, team_delete_entry, team_merge_tags
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor } from './helpers.js'
import {
    TeamUpdateEntrySchema,
    TeamUpdateEntrySchemaMcp,
    TeamDeleteEntrySchema,
    TeamDeleteEntrySchemaMcp,
    TeamMergeTagsSchema,
    TeamMergeTagsSchemaMcp,
    TeamUpdateOutputSchema,
    TeamDeleteOutputSchema,
    TeamMergeTagsOutputSchema,
} from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAdminTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_update_entry',
            title: 'Update Team Entry',
            description: 'Update a team entry (content, type, or tags). Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamUpdateEntrySchemaMcp,
            outputSchema: TeamUpdateOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, content, entry_type, tags, project_number } =
                        TeamUpdateEntrySchema.parse(params)

                    // Verify entry exists and belongs to the project (if project_number is specified)
                    const existing = teamDb.getEntryById(entry_id)
                    if (!existing || (project_number !== undefined && existing.projectNumber !== project_number)) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${project_number}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)

                    const currentUser = resolveAuthenticatedAuthor()

                    if (author && author !== currentUser) {
                        return {
                            success: false,
                            error: `Permission Denied: Only the original author ("${author}") can modify this team entry.`,
                            code: 'PERMISSION_DENIED',
                            category: 'auth',
                            suggestion: 'You can only update entries that you authored.',
                            recoverable: false,
                        }
                    }

                    const updated = teamDb.updateEntry(entry_id, {
                        content,
                        entryType: entry_type,
                        tags,
                    })

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
                'Soft-delete a team entry (marks as deleted, preservable). Requires TEAM_DB_PATH.',
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

                    const { entry_id, project_number } = TeamDeleteEntrySchema.parse(params)

                    // Verify entry exists and belongs to project (if project_number is specified)
                    const existing = teamDb.getEntryById(entry_id)
                    if (!existing || (project_number !== undefined && existing.projectNumber !== project_number)) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${project_number}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)

                    const currentUser = resolveAuthenticatedAuthor()

                    if (author && author !== currentUser) {
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
            name: 'team_merge_tags',
            title: 'Merge Team Tags',
            description:
                'Merge a source tag into a target tag in the team database. All entries with the source tag will be re-tagged with the target tag. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamMergeTagsSchemaMcp,
            outputSchema: TeamMergeTagsOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
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
