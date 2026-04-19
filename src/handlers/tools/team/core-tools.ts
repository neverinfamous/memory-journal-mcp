/**
 * Team Core Tools - 4 tools
 *
 * Tools: team_create_entry, team_get_entry_by_id, team_get_recent, team_list_tags
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAuthor } from '../../../utils/security-utils.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { TEAM_DB_ERROR_RESPONSE, batchFetchAuthors, fetchAuthor } from './helpers.js'
import {
    TeamCreateEntrySchema,
    TeamCreateEntrySchemaMcp,
    TeamGetRecentSchema,
    TeamGetRecentSchemaMcp,
    TeamGetEntryByIdSchema,
    TeamGetEntryByIdSchemaMcp,
    TeamCreateOutputSchema,
    TeamEntriesListOutputSchema,
    TeamEntryDetailOutputSchema,
    TeamTagsListOutputSchema,
} from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamCoreTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_create_entry',
            title: 'Create Team Entry',
            description:
                'Create an entry in the team database for sharing with collaborators. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamCreateEntrySchemaMcp,
            outputSchema: TeamCreateOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = TeamCreateEntrySchema.parse(params)

                    // SEC-2.3: Bind authorship to the authenticated principal when OAuth is active.
                    // Hard-reject if caller supplies a mismatched author — prevents impersonation.
                    const authCtx = getAuthContext()
                    let author: string
                    if (authCtx?.authenticated) {
                        const claims = authCtx.claims
                        const email = typeof claims?.['email'] === 'string' ? claims['email'] : undefined
                        const prefName = typeof claims?.['preferred_username'] === 'string' ? claims['preferred_username'] : undefined
                        const subject = typeof claims?.['subject'] === 'string' ? claims['subject'] : undefined
                        const authId = claims?.sub ?? email ?? prefName ?? subject ?? resolveAuthor()

                        if (input.author !== undefined && input.author !== authId) {
                            return {
                                success: false,
                                error: `Author mismatch: supplied author "${input.author}" does not match authenticated principal "${authId}". Omit the author field to use your identity automatically.`,
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'Omit the author field to use your authenticated identity automatically.',
                                recoverable: false,
                            }
                        }
                        author = authId
                    } else {
                        if (input.author !== undefined) {
                            return {
                                success: false,
                                error: `Claiming authorship ("${input.author}") is disabled in non-OAuth environments. Omit the author field to use the system default identity.`,
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'Omit the author field to proceed using the system default identity.',
                                recoverable: false,
                            }
                        }
                        const systemAuthor = resolveAuthor()
                        if (systemAuthor === 'unknown') {
                            return {
                                success: false,
                                error: 'Identity cannot be resolved securely. In non-OAuth environments, you must set the TEAM_AUTHOR environment variable to claim an identity.',
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'Set the TEAM_AUTHOR environment variable or enable OAuth.',
                                recoverable: false,
                            }
                        }
                        author = systemAuthor
                    }

                    const resolvedIssueUrl = await resolveIssueUrl(
                        context,
                        input.project_number,
                        input.issue_number,
                        input.issue_url
                    )

                    const entry = teamDb.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: false,
                        significanceType: input.significance_type ?? null,
                        projectNumber: input.project_number,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: resolvedIssueUrl,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        author,
                    })

                    teamDb.flushSave()

                    return {
                        success: true,
                        entry: { ...entry, autoContext: undefined, author },
                        author,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_get_entry_by_id',
            title: 'Get Team Entry by ID',
            description:
                'Get a specific team entry by ID with full details including relationships and importance score. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamGetEntryByIdSchemaMcp,
            outputSchema: TeamEntryDetailOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, include_relationships, project_number } = TeamGetEntryByIdSchema.parse(params)
                    const entry = teamDb.getEntryById(entry_id)

                    if (entry?.projectNumber !== project_number) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found or does not belong to project ${project_number}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)
                    const enrichedEntry = { ...entry, autoContext: undefined, author }

                    const result: Record<string, unknown> = {
                        success: true,
                        entry: enrichedEntry,
                    }

                    if (include_relationships) {
                        const relationships = teamDb.getRelationships(entry_id)
                        result['relationships'] = relationships
                    }

                    const importance = teamDb.calculateImportance(entry_id)
                    result['importance'] = importance

                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_get_recent',
            title: 'Get Recent Team Entries',
            description: 'Get recent entries from the team database. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamGetRecentSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { limit, sort_by, project_number } = TeamGetRecentSchema.parse(params)
                    const entries = teamDb.searchEntries('', {
                        limit,
                        sortBy: sort_by,
                        projectNumber: project_number,
                    })

                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
                        autoContext: undefined,
                        author: authorMap.get(e.id) ?? null,
                    }))

                    return { entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_list_tags',
            title: 'List Team Tags',
            description:
                'List all tags used in the team database with usage counts. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: z.object({}).strict(),
            outputSchema: TeamTagsListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (_params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const rawTags = teamDb.listTags()
                    const tags = rawTags.map((t) => ({ name: t.name, count: t.usageCount }))
                    return { success: true, tags, count: tags.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
