/**
 * Team Core Tools - 4 tools
 *
 * Tools: team_create_entry, team_get_entry_by_id, team_get_recent, team_list_tags
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveTeamCreateAuthor } from './admin-tools/batch-create-helpers.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { resolveWorkspaceId, resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter, pairStoredScope } from '../../../utils/write-scope.js'
import {
    TEAM_DB_ERROR_RESPONSE,
    batchFetchAuthors,
    fetchAuthor,
    missingTeamProjectNumberError,
    triggerTeamNotifications,
    resolveTeamProjectNumber,
} from './helpers.js'
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
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { linkRequestedRelationships } from '../relationship-linking.js'

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
                'structure content as: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. ' +
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

                    const input = TeamCreateEntrySchema.parse(params)
                    if (input.workspace_id === '*') {
                        return {
                            success: false,
                            error: "workspace_id '*' is a read-only wildcard and cannot be used to create a team entry. Pass a specific workspace_id or project_number.",
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Pass the repository name or a project_number.',
                            recoverable: true,
                        }
                    }
                    const resolved = resolveProjectContext(
                        {
                            workspace_id: input.workspace_id,
                            project_number: input.project_number,
                        },
                        context.config
                    )
                    const paired = pairStoredScope(
                        resolved.workspaceId,
                        input.project_number ?? resolved.projectNumber,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )
                    const wsId = paired.workspaceId ?? resolved.workspaceId
                    const projectNumber = paired.projectNumber

                    if (projectNumber === undefined || projectNumber === null || projectNumber <= 0) {
                        return {
                            success: false,
                            error: 'Missing or unresolvable project_number. Team entry creation blocked because no valid project could be determined for this entry.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'To find your project_number, call list_projects (or mj.core.listProjects()), read memory://agent-context/<repo-name> via read_resource (e.g. read_resource("memory-journal-mcp", "memory://agent-context/memory-journal-mcp")), or inspect memory://briefing/<project-name>. Avoid bare memory://agent-id in multi-project setups. Then pass project_number explicitly in your request.',
                            recoverable: true,
                        }
                    }

                    const authorResult = resolveTeamCreateAuthor(
                        input.author,
                        teamDb,
                        context.config,
                        wsId
                    )
                    if ('errorResponse' in authorResult) {
                        return authorResult.errorResponse
                    }
                    const { author } = authorResult

                    // Optional progress for long operations
                    await sendProgress(progress, 0, 2, 'Creating team entry...')

                    const resolvedIssueUrl = await resolveIssueUrl(
                        context,
                        projectNumber,
                        input.issue_number,
                        input.issue_url,
                        wsId
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
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status,
                        author,
                        autoContext: input.auto_context,
                        workspaceId: wsId,
                        impactScore: input.impact_score,
                        trustScore: input.trust_score,
                        validationStatus: input.validation_status,
                        sessionId: input.session_id,
                        ...(input.anchors !== undefined
                            ? {
                                  anchors: input.anchors.map((a) => ({
                                      anchorPath: a.anchor_path,
                                      anchorType: a.anchor_type,
                                      ...(a.status !== undefined ? { status: a.status } : {}),
                                  })),
                              }
                            : {}),
                    })

                    const relationshipWarnings = linkRequestedRelationships(
                        teamDb,
                        entry.id,
                        input.relationships,
                        wsId,
                        projectNumber
                    )

                    teamDb.flushSave()

                    const indexStatus = await autoIndexEntry(context.teamVectorManager, teamDb, entry.id, wsId)

                    triggerTeamNotifications(context)

                    const warnings: string[] = [
                        ...(indexStatus === 'failed'
                            ? [`Entry #${String(entry.id)} was saved but vector indexing failed.`]
                            : []),
                        ...relationshipWarnings,
                    ]

                    return {
                        success: indexStatus !== 'failed',
                        entry: { ...entry, author },
                        author,
                        vectorIndex: indexStatus,
                        ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
                        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
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
                    const projectNumber = resolveTeamProjectNumber(
                        context,
                        wsId,
                        project_number,
                        workspace_id
                    )
                    if (projectNumber === undefined || projectNumber === null) {
                        return missingTeamProjectNumberError()
                    }

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

                    if (entry.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} does not belong to project ${String(projectNumber)}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const effectiveWsId = entry.workspaceId ?? wsId
                    const author = fetchAuthor(teamDb, entry_id)
                    const result: Record<string, unknown> = {
                        success: true,
                        entry: { ...entry, author },
                    }

                    if (include_relationships) {
                        const rawRels = teamDb.getRelationships(entry_id, effectiveWsId)
                        const peerIds = [
                            ...new Set(
                                rawRels.map((rel) =>
                                    rel.fromEntryId === entry_id ? rel.toEntryId : rel.fromEntryId
                                )
                            ),
                        ]
                        const peersMap =
                            peerIds.length > 0 && typeof teamDb.getEntriesByIds === 'function'
                                ? teamDb.getEntriesByIds(peerIds, effectiveWsId)
                                : new Map(
                                      peerIds
                                          .map((id) => [id, teamDb.getEntryById(id, effectiveWsId)] as const)
                                          .filter((pair): pair is readonly [number, NonNullable<typeof entry>] => pair[1] !== null && pair[1] !== undefined)
                                  )
                        result['relationships'] = rawRels.filter((rel) => {
                            const peerId =
                                rel.fromEntryId === entry_id ? rel.toEntryId : rel.fromEntryId
                            const peer = peersMap.get(peerId)
                            return (
                                peer !== undefined &&
                                peer.projectNumber === entry.projectNumber &&
                                (effectiveWsId === '*' || peer.workspaceId === effectiveWsId)
                            )
                        })
                    }

                    const importance = teamDb.calculateImportance(entry_id, effectiveWsId)
                    if (importance !== null) result['importance'] = importance

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

                    const { limit, cursor, sort_by, project_number, workspace_id, include_archived } =
                        TeamGetRecentSchema.parse(params)
                    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    const projectNumber = resolveTeamProjectNumber(
                        context,
                        wsId,
                        project_number,
                        workspace_id
                    )
                    if (projectNumber == null) {
                        return {
                            success: false,
                            error: 'Missing project_number. Cross-tenant queries without project_number are not allowed.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify a project_number or workspace_id.',
                            recoverable: true,
                        }
                    }
                    const result = teamDb.searchEntries('', {
                        limit,
                        cursor,
                        sortBy: sort_by,
                        projectNumber: projectNumber,
                        workspaceId: wsId,
                        includeArchived: include_archived,
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
            inputSchema: z.object({
                project_number: relaxedNumber()
                    .optional()
                    .describe('Numeric project ID to filter tags by.'),
                workspace_id: z
                    .string()
                    .optional()
                    .describe('Optional workspace isolation identifier (e.g. "alpha").'),
            }),
            outputSchema: TeamTagsListOutputSchema,
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

                    const input = z
                        .object({
                            project_number: StrictProjectNumberSchema.optional(),
                            workspace_id: z.string().optional(),
                        })
                        .strict()
                        .parse(params ?? {})
                    const wsId = resolveWorkspaceId(
                        input.workspace_id,
                        input.project_number,
                        context.config
                    )
                    const resolvedProject = alignedProjectFilter(
                        wsId,
                        input.project_number,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )
                    if (wsId === '*' && resolvedProject === undefined) {
                        return missingTeamProjectNumberError(
                            'Missing project_number. Wildcard workspace_id "*" requires an explicit project_number.'
                        )
                    }
                    const rawTags = teamDb.listTags(wsId, resolvedProject)
                    const tags = rawTags.map((t) => ({ name: t.name, count: t.usageCount }))
                    return { success: true, tags, count: tags.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}

