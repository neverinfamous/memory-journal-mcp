/**
 * Team Core Tools - 4 tools
 *
 * Tools: team_create_entry, team_get_entry_by_id, team_get_recent, team_list_tags
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAuthor } from '../../../utils/security-utils.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { TEAM_DB_NOT_CONFIGURED, batchFetchAuthors, fetchAuthor } from './helpers.js'
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
    const { teamDb, github } = context

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
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const input = TeamCreateEntrySchema.parse(params)
                    const author = input.author ?? resolveAuthor()

                    const resolvedIssueUrl = resolveIssueUrl(
                        github,
                        input.issue_number,
                        input.issue_url
                    )

                    const entry = teamDb.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: false,
                        significanceType: input.significance_type ?? null,
                        autoContext: JSON.stringify({ author }),
                        projectNumber: input.project_number,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: resolvedIssueUrl,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                    })

                    teamDb.executeRawQuery('UPDATE memory_journal SET author = ? WHERE id = ?', [
                        author,
                        entry.id,
                    ])
                    teamDb.flushSave()

                    return {
                        success: true,
                        entry: { ...entry, author },
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
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { entry_id, include_relationships } =
                        TeamGetEntryByIdSchema.parse(params)
                    const entry = teamDb.getEntryById(entry_id)

                    if (!entry) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found`,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)
                    const enrichedEntry = { ...entry, author }

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
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { limit } = TeamGetRecentSchema.parse(params)
                    const entries = teamDb.getRecentEntries(limit)

                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
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
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const tags = teamDb.listTags()
                    return { success: true, tags, count: tags.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
