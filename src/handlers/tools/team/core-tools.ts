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
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
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
import { coerceSignificanceAlias } from '../schemas.js'
import { parseFlagContext } from '../../../types/auto-context.js'

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
                'Create an entry in the team database for sharing with collaborators. ' +
                'ONLY use when explicitly requested by the user. Default to personal create_entry instead. ' +
                'Content must be well-structured markdown using ## section headers. Select the most accurate entry_type (e.g., retrospective, technical_note). ' +
                'For session summaries, use entry_type "retrospective" with tag "session-summary" and ' +
                'structure content as: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session. ' +
                'REQUIRED: You MUST include project_number. ' +
                'REQUIRED: You MUST include impact_score, trust_score, and validation_status. ' +
                'REQUIRED: You MUST use related_to to anchor the entry to a session summary or nearby context. ' +
                'Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamCreateEntrySchemaMcp,
            outputSchema: TeamCreateOutputSchema,
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

                    const input = TeamCreateEntrySchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)

                    const projectNumber = input.project_number ?? context.config?.defaultProjectNumber
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: "Missing project_number. You MUST include it. Please retry your tool call. You can find the correct project_number in your Briefing under the Workspaces section (e.g., 'adamic (#16)' means project_number: 16).",
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }

                    // SEC-2.3: Bind authorship to the authenticated principal when OAuth is active.
                    // Hard-reject if caller supplies a mismatched author — prevents impersonation.
                    const authCtx = getAuthContext()
                    let author: string
                    if (authCtx?.authenticated) {
                        const claims = authCtx.claims
                        const email =
                            typeof claims?.['email'] === 'string' ? claims['email'] : undefined
                        const prefName =
                            typeof claims?.['preferred_username'] === 'string'
                                ? claims['preferred_username']
                                : undefined
                        const subject =
                            typeof claims?.['subject'] === 'string' ? claims['subject'] : undefined
                        const authId =
                            claims?.sub ?? email ?? prefName ?? subject ?? resolveAuthor()

                        if (input.author !== undefined && input.author !== authId) {
                            return {
                                success: false,
                                error: `Author mismatch: supplied author "${input.author}" does not match authenticated principal "${authId}". Omit the author field to use your identity automatically.`,
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion:
                                    'Omit the author field to use your authenticated identity automatically.',
                                recoverable: false,
                            }
                        }
                        author = authId
                    } else {
                        if (input.author !== undefined) {
                            author = input.author
                        } else {
                            const systemAuthor = resolveAuthor()
                            if (systemAuthor === 'unknown') {
                                return {
                                    success: false,
                                    error: 'Identity cannot be resolved securely. In non-OAuth environments, you must set the TEAM_AUTHOR environment variable to claim an identity.',
                                    code: 'PERMISSION_DENIED',
                                    category: 'auth',
                                    suggestion:
                                        'Set the TEAM_AUTHOR environment variable or enable OAuth.',
                                    recoverable: false,
                                }
                            }
                            author = systemAuthor
                        }
                    }

                    const resolvedIssueUrl = await resolveIssueUrl(
                        context,
                        projectNumber,
                        input.issue_number,
                        input.issue_url
                    )

                    const entry = teamDb.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: false,
                        significanceType: input.significance_type ?? null,
                        projectNumber: projectNumber,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: resolvedIssueUrl,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        author,
                        autoContext: input.auto_context,
                        workspaceId: wsId,
                        impactScore: input.impact_score,
                        trustScore: input.trust_score,
                        validationStatus: input.validation_status,
                    })

                    teamDb.flushSave()

                    if (context.config?.subscriptionManager) {
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://team/recent')
                        // Broad stroke briefing update trigger
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://briefing')
                    }

                    const parsedFlagMetadata =
                        entry.entryType === 'flag' ? parseFlagContext(entry.autoContext) : undefined

                    return {
                        success: true,
                        entry: { ...entry, author, flagMetadata: parsedFlagMetadata },
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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, include_relationships, project_number, workspace_id } =
                        TeamGetEntryByIdSchema.parse(params)
                    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    const projectNumber = project_number
                    const entry = teamDb.getEntryById(entry_id, wsId)

                    if (
                        !entry ||
                        (projectNumber !== undefined && entry.projectNumber !== projectNumber)
                    ) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found or does not belong to project ${projectNumber}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)
                    const parsedFlagMetadata =
                        entry.entryType === 'flag' ? parseFlagContext(entry.autoContext) : undefined
                    const enrichedEntry = { ...entry, author, flagMetadata: parsedFlagMetadata }

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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { limit, cursor, sort_by, project_number, workspace_id } = TeamGetRecentSchema.parse(params)
                    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    const projectNumber = project_number
                    const result = teamDb.searchEntries('', {
                        limit,
                        cursor,
                        sortBy: sort_by,
                        projectNumber: projectNumber,
                        workspaceId: wsId,
                    })

                    const entries = result.entries
                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const enriched = entries.map((e) => ({
                        ...e,
                        author: authorMap.get(e.id) ?? null,
                        flagMetadata:
                            e.entryType === 'flag' ? parseFlagContext(e.autoContext) : undefined,
                    }))

                    return { entries: enriched, count: enriched.length, next_cursor: result.nextCursor }
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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
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

