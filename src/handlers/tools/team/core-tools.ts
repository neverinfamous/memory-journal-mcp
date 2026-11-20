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
import { sanitizeAuthor } from '../../../utils/security-utils.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { resolveEntryAnchors } from '../core/staleness-tools.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { encodeCursor } from '../../../database/sqlite-adapter/entries/search/cursor.js'
import { resolveWorkspaceId, resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter, pairStoredScope } from '../../../utils/write-scope.js'
import {
    TEAM_DB_ERROR_RESPONSE,
    batchFetchAuthors,
    executeTeamGetEntryById,
    missingTeamProjectNumberError,
    triggerTeamNotifications,
    resolveTeamProjectNumber,
} from './helpers.js'
import {
    TeamCreateEntrySchema,
    TeamCreateEntrySchemaMcp,
    TeamGetRecentSchema,
    TeamGetRecentSchemaMcp,
    TeamGetEntryByIdSchemaMcp,
    TeamCreateOutputSchema,
    TeamEntriesListOutputSchema,
    TeamEntryDetailOutputSchema,
    TeamTagsListOutputSchema,
} from './schemas.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { linkRequestedRelationships } from '../relationship-linking.js'

const TeamListTagsSchemaMcp = z.object({
    project_number: relaxedNumber()
        .optional()
        .describe('Numeric project ID to filter tags by.'),
    workspace_id: z
        .string()
        .optional()
        .describe('Optional workspace isolation identifier (e.g. "alpha").'),
})

const TeamListTagsSchema = z
    .object({
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().optional(),
    })
    .strict()

type TeamDbInstance = NonNullable<ToolContext['teamDb']>
type TeamCreateInput = z.infer<typeof TeamCreateEntrySchema>

function resolveTeamCreateScopeAndAuthor(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamCreateInput
): { wsId: string; projectNumber: number; author: string } | { errorResponse: Record<string, unknown> } {
    if (input.workspace_id?.trim() === '*') {
        return {
            errorResponse: {
                success: false,
                error: "workspace_id '*' is a read-only wildcard and cannot be used to create a team entry. Pass a specific workspace_id or project_number.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Pass the repository name or a project_number.',
                recoverable: true,
            },
        }
    }
    const resolved = resolveProjectContext(
        { workspace_id: input.workspace_id, project_number: input.project_number },
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
            errorResponse: {
                success: false,
                error: 'Missing or unresolvable project_number. Team entry creation blocked because no valid project could be determined for this entry.',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'To find your project_number, call list_projects (or mj.core.listProjects()), read memory://agent-context/<repo-name> via read_resource (e.g. read_resource("memory-journal-mcp", "memory://agent-context/memory-journal-mcp")), or inspect memory://briefing/<project-name>. Avoid bare memory://agent-id in multi-project setups. Then pass project_number explicitly in your request.',
                recoverable: true,
            },
        }
    }
    const authorResult = resolveTeamCreateAuthor(input.author, teamDb, context.config, wsId)
    if ('errorResponse' in authorResult) return authorResult
    return { wsId, projectNumber, author: authorResult.author }
}

function buildTeamEntryPayload(
    input: TeamCreateInput,
    wsId: string,
    projectNumber: number,
    author: string,
    resolvedIssueUrl: string | undefined,
    resolvedAnchors: Awaited<ReturnType<typeof resolveEntryAnchors>>
): Parameters<TeamDbInstance['createEntry']>[0] {
    return {
        content: input.content,
        entryType: input.entry_type,
        tags: input.tags,
        isPersonal: false,
        significanceType: input.significance_type ?? null,
        projectNumber,
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
        ...(resolvedAnchors !== undefined ? { anchors: resolvedAnchors } : {}),
    }
}

async function executeTeamCreateEntry(
    context: ToolContext,
    teamDb: TeamDbInstance,
    params: unknown
): Promise<Record<string, unknown>> {
    const input = TeamCreateEntrySchema.parse(params)
    const scope = resolveTeamCreateScopeAndAuthor(context, teamDb, input)
    if ('errorResponse' in scope) return scope.errorResponse
    const { wsId, projectNumber, author } = scope

    // Optional progress for long operations
    await sendProgress(context.progress, 0, 2, 'Creating team entry...')
    const resolvedIssueUrl = await resolveIssueUrl(
        context,
        projectNumber,
        input.issue_number,
        input.issue_url,
        wsId
    )
    const resolvedAnchors = await resolveEntryAnchors(
        input.anchors,
        input.auto_context,
        wsId,
        context
    )
    const entry = teamDb.createEntry(
        buildTeamEntryPayload(input, wsId, projectNumber, author, resolvedIssueUrl, resolvedAnchors)
    )

    const relationshipWarnings = linkRequestedRelationships(
        teamDb,
        entry.id,
        input.relationships,
        wsId,
        projectNumber
    )
    teamDb.flushSave()
    const indexStatus = await autoIndexEntry(context.teamVectorManager, teamDb, entry, wsId)
    triggerTeamNotifications(context)

    const warnings: string[] = [
        ...(indexStatus === 'failed'
            ? [`Entry #${String(entry.id)} was saved but vector indexing failed.`]
            : []),
        ...relationshipWarnings,
    ]
    const safeAuthor = sanitizeAuthor(author)
    return {
        success: true,
        entry: { ...entry, author: safeAuthor },
        author: safeAuthor,
        vectorIndex: indexStatus,
        ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
    }
}

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
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return await executeTeamCreateEntry(context, teamDb, params)
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
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamGetEntryById(context, teamDb, params)
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

                    const {
                        limit,
                        cursor,
                        offset,
                        sort_by,
                        project_number,
                        workspace_id,
                        include_archived,
                    } = TeamGetRecentSchema.parse(params)
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
                            suggestion:
                                "🛠️ AUTONOMOUS HEALING: Specify a concrete registered workspace_id and project_number. Team DB enforces per-project tenant isolation and rejects workspace_id: '*'; for global audits, iterate Object.entries((await mj.admin.listProjects({})).projects) and call mj.team.teamGetRecent({ workspace_id, project_number, limit: 200 }) per project.",
                            recoverable: true,
                        }
                    }
                    const effectiveCursor =
                        cursor ?? (offset > 0 ? encodeCursor({ offset }) : undefined)
                    const result = teamDb.searchEntries('', {
                        limit,
                        cursor: effectiveCursor,
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
                        source: 'team' as const,
                    }))

                    return {
                        success: true,
                        entries: enriched,
                        count: enriched.length,
                        next_cursor: result.nextCursor,
                    }
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
            inputSchema: TeamListTagsSchemaMcp,
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

                    const input = TeamListTagsSchema.parse(params ?? {})
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

