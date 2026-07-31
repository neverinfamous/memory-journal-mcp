/**
 * Team Core Tools - 4 tools
 *
 * Tools: team_create_entry, team_get_entry_by_id, team_get_recent, team_list_tags
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveAuthor } from '../../../utils/security-utils.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { resolveWorkspaceId, resolveProjectContext } from '../../../utils/workspace-resolver.js'
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
import type { RelationshipType } from '../../../types/index.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamCoreTools(context: ToolContext): ToolDefinition[] {
    const { teamDb, progress } = context

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
                    const resolved = resolveProjectContext(
                        {
                            workspace_id: input.workspace_id,
                            project_number: input.project_number,
                            content: input.content,
                            tags: input.tags
                        },
                        context.config
                    )
                    const wsId = resolved.workspaceId
                    const projectNumber = resolved.projectNumber

                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: 'Missing or unresolvable project_number. Team entry creation blocked because no valid project could be determined for this entry.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'To find your project_number, read the memory://agent-id resource via read_resource (e.g. read_resource("memory-journal-mcp", "memory://agent-id")), call mj.core.listProjects(), or inspect memory://briefing/<project-name>. Then pass project_number explicitly in your request.',
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

                    // Optional progress for long operations
                    await sendProgress(progress, 0, 2, 'Creating team entry...')

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
                        sessionId: input.session_id,
                    })

                    if (input.relationships && input.relationships.length > 0) {
                        for (const rel of input.relationships) {
                            try {
                                teamDb.linkEntries(entry.id, rel.targetId, rel.relationType as RelationshipType)
                            } catch {
                                // Ignore link failures if target doesn't exist
                            }
                        }
                    }

                    teamDb.flushSave()

                    if (context.config?.subscriptionManager) {
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://team/recent')
                        // Broad stroke briefing update trigger
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://briefing')
                    }

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
                    const wsId = workspace_id ? resolveWorkspaceId(workspace_id, project_number, context.config) : '*'
                    const projectNumber = project_number
                    const entry = teamDb.getEntryById(entry_id, wsId)

                    if (!entry) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and try again',
                            recoverable: true,
                        }
                    }

                    if (projectNumber !== undefined && entry.projectNumber !== undefined && entry.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} does not belong to project ${projectNumber}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)
                    const result: Record<string, unknown> = {
                        success: true,
                        entry: { ...entry, author },
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
                    const wsId = workspace_id ? resolveWorkspaceId(workspace_id, project_number, context.config) : undefined
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

