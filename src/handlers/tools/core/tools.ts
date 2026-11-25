import type { ErrorResponse } from '../../../types/error-types.js'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import {
    buildCreateEntryInput,
    executeGetEntryById,
    indexCreatedEntry,
    recordTeamShareOutcome,
    resolveAndApplyCreateLinks,
} from './create-entry-helpers.js'
import { resolveWorkspaceId, resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { logger } from '../../../utils/logger.js'
import { isRecord } from '../../../utils/type-guards.js'
import { probeMatchingTeamEntry } from '../search/helpers.js'
import { assertCanonicalFallbackToolAllowed } from '../team/helpers.js'

import {
    CreateEntrySchema,
    CreateEntrySchemaMcp,
    CreateEntryOutputSchema,
    GetEntryByIdSchemaMcp,
    EntryByIdOutputSchema,
    GetRecentEntriesSchema,
    GetRecentEntriesSchemaMcp,
    GetEntryHistorySchema,
    GetEntryHistorySchemaMcp,
    GetEntryHistoryOutputSchema,
    TagsListOutputSchema,
    GetRecentEntriesOutputSchema,
    ListTagsSchema,
    ListTagsSchemaMcp,
} from './schemas.js'
import { coerceSignificanceAlias } from '../schemas.js'
import { linkRequestedRelationships } from '../relationship-linking.js'
import { resolveEntryAnchors } from './staleness-tools.js'
import { getDiagnosticTools } from './diagnostic-tools.js'

function resolveCreateEntryScope(
    input: ReturnType<typeof CreateEntrySchema.parse>,
    config: ToolContext['config']
): { wsId: string; projectNumber: number } | { errorResponse: Record<string, unknown> } {
    if (input.workspace_id?.trim() === '*') {
        return {
            errorResponse: {
                success: false,
                error: "workspace_id '*' is a read-only wildcard and cannot be used to create an entry. Pass a specific workspace_id or project_number.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Pass the repository name, such as "memory-journal-mcp", or a project_number.',
                recoverable: true,
            },
        }
    }
    const resolved = resolveProjectContext(
        { workspace_id: input.workspace_id, project_number: input.project_number },
        config
    )
    const projectNumber = resolved.projectNumber
    if (projectNumber === undefined || projectNumber === null || projectNumber <= 0) {
        return {
            errorResponse: {
                success: false,
                error: 'Missing or unresolvable project_number. Entry creation blocked because no valid project could be determined for this entry.',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'To find your project_number, call list_projects (or mj.admin.listProjects()), read memory://agent-context/<repo-name> via read_resource (e.g. read_resource("memory-journal-mcp", "memory://agent-context/memory-journal-mcp")), or inspect memory://briefing/<project-name>. Avoid bare memory://agent-id in multi-project setups. Then pass project_number explicitly in your request.',
                recoverable: true,
            },
        }
    }
    return { wsId: resolved.workspaceId, projectNumber }
}

function notifyRecentEntriesSubscription(context: ToolContext): void {
    if (!context.config?.subscriptionManager) return
    void context.config.subscriptionManager
        .notifyResourceUpdated('memory://recent')
        .catch((err: unknown) => {
            logger.debug('Failed to notify resource updated', { error: err })
        })
}

async function executeCreateEntry(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    const { db, progress } = context
    const paramsCopy: unknown = isRecord(params) ? { ...params } : params
    coerceSignificanceAlias(paramsCopy)
    const input = CreateEntrySchema.parse(paramsCopy)
    const scope = resolveCreateEntryScope(input, context.config)
    if ('errorResponse' in scope) return scope.errorResponse
    if ((input.relationships !== undefined && input.relationships.length > 0) || input.auto_link === true) {
        assertCanonicalFallbackToolAllowed('link_entries', 'relationships', context, false)
    }
    const { wsId, projectNumber } = scope

    await sendProgress(progress, 0, 2, 'Creating entry...')
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
    const entryInput = buildCreateEntryInput(input, {
        projectNumber,
        workspaceId: wsId,
        issueUrl: resolvedIssueUrl,
        anchors: resolvedAnchors,
    })
    const createdEntry = db.createEntry(entryInput)
    const id = createdEntry.id

    const relationshipWarnings = linkRequestedRelationships(
        db,
        id,
        input.relationships,
        wsId,
        projectNumber
    )
    const vectorWarning = await indexCreatedEntry(context, progress, createdEntry)
    notifyRecentEntriesSubscription(context)

    // [INVARIANT] M2: stamp the team mirror with its personal origin (team-only column, migration 020).
    const teamShare = input.share_with_team
        ? await recordTeamShareOutcome(
              context,
              { ...entryInput, originPersonalId: id },
              relationshipWarnings
          )
        : { sharedWithTeam: false }
    const suggestedLinks = await resolveAndApplyCreateLinks({
        context,
        createdEntry,
        input,
        wsId,
        projectNumber,
        relationshipWarnings,
    })
    const allWarnings = [
        ...(vectorWarning !== undefined ? [vectorWarning] : []),
        ...relationshipWarnings,
    ]
    return {
        success: true,
        id,
        entry: createdEntry,
        ...(allWarnings.length > 0 ? { warning: allWarnings.join('; ') } : {}),
        ...(teamShare.sharedWithTeam
            ? { sharedWithTeam: true, ...(teamShare.author !== undefined ? { author: teamShare.author } : {}) }
            : {}),
        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
        ...(suggestedLinks.length > 0 ? { suggested_links: suggestedLinks } : {}),
    }
}

function executeGetRecentEntries(
    params: unknown,
    context: ToolContext
): Record<string, unknown> | ErrorResponse {
    try {
        const input = GetRecentEntriesSchema.parse(params)
        const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
        const projectNumber = alignedProjectFilter(
            wsId,
            input.project_number,
            activeProjectRegistry(context.config?.projectRegistry)
        )
        const result = context.db.getRecentEntries(
            input.limit,
            input.is_personal,
            input.sort_by,
            input.cursor,
            input.include_archived,
            wsId,
            projectNumber,
            input.offset
        )
        return {
            success: true,
            entries: result.entries,
            count: result.entries.length,
            next_cursor: result.nextCursor,
            hasMore: !!result.nextCursor,
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

function executeGetEntryHistory(
    params: unknown,
    context: ToolContext
): Record<string, unknown> | ErrorResponse {
    const { db } = context
    try {
        const input = GetEntryHistorySchema.parse(params)
        let wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
        const current = db.getEntryById(input.entry_id, wsId)
        if (current?.workspaceId !== undefined && (wsId === '*' || wsId === 'default')) {
            wsId = current.workspaceId
        }
        if (
            !current ||
            (input.project_number !== undefined && current.projectNumber !== input.project_number)
        ) {
            const matchingTeamEntry =
                !current &&
                probeMatchingTeamEntry(
                    context,
                    input.entry_id,
                    wsId,
                    input.project_number,
                    'team_get_entry_by_id'
                )
            return {
                success: false,
                error: `Entry ${String(input.entry_id)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                ...(matchingTeamEntry
                    ? {
                          suggestion: `No personal entry #${String(input.entry_id)} was found in workspace '${wsId}', but team entry #${String(input.entry_id)} exists in the team database. Call team_get_entry_by_id (or mj.team.teamGetEntryById / mj.team.getEntryById) instead.`,
                      }
                    : {}),
                recoverable: true,
            }
        }

        const rawHistory = db.getEntryHistory(input.entry_id, wsId)
        const history = rawHistory.map((rev) => ({
            revisionId: rev.revisionNumber,
            entryId: rev.entryId,
            content: rev.contentSnapshot,
            createdAt: rev.changedAt,
        }))

        return {
            success: true,
            id: input.entry_id,
            current,
            history,
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

function executeListTags(
    params: unknown,
    context: ToolContext
): Record<string, unknown> | ErrorResponse {
    try {
        const input = ListTagsSchema.parse(params ?? {})
        const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
        const effectiveProjectFilter = alignedProjectFilter(
            wsId,
            input.project_number,
            activeProjectRegistry(context.config?.projectRegistry)
        )
        const tags = context.db
            .listTags(wsId, effectiveProjectFilter)
            .map((t) => ({ name: t.name, count: t.usageCount ?? 0 }))
        return { success: true, tags, count: tags.length }
    } catch (err) {
        return formatHandlerError(err)
    }
}

function buildCreateEntryTool(context: ToolContext): ToolDefinition {
    return {
        name: 'create_entry',
        title: 'Create Entry',
        description:
            'Create a new journal entry. Content must be well-structured markdown ' +
            'using ## section headers. Select the most accurate entry_type (e.g., retrospective, personal_reflection, technical_note). ' +
            'For session summaries, use entry_type "retrospective" ' +
            'with tag "session-summary" and structure content as: ' +
            '## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. ' +
            'REQUIRED: You MUST include project_number. Extract this by querying memory://agent-context/{+repo} (or memory://briefing/{+repo} at session start). ' +
            'REQUIRED: You MUST include impact_score, trust_score, and validation_status. ' +
            'REQUIRED: Pass relationships: [{ targetId, relationType }] to link the entry to a session summary or related entry.',
        group: 'core',
        inputSchema: CreateEntrySchemaMcp,
        outputSchema: CreateEntryOutputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
        handler: async (params: unknown) => {
            try {
                return await executeCreateEntry(params, context)
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}

export function getCoreTools(context: ToolContext): ToolDefinition[] {
    return [
        buildCreateEntryTool(context),
        {
            name: 'get_entry_by_id',
            title: 'Get Entry by ID',
            description: 'Retrieve a specific entry by its ID',
            group: 'core',
            inputSchema: GetEntryByIdSchemaMcp,
            outputSchema: EntryByIdOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    return executeGetEntryById(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_recent_entries',
            title: 'Get Recent Entries',
            description: 'Get the most recent journal entries',
            group: 'core',
            inputSchema: GetRecentEntriesSchemaMcp,
            outputSchema: GetRecentEntriesOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeGetRecentEntries(params, context),
        },
        {
            name: 'get_entry_history',
            title: 'Get Entry Revision History',
            description: 'Retrieve the revision history of an entry (last 10 edits).',
            group: 'core',
            inputSchema: GetEntryHistorySchemaMcp,
            outputSchema: GetEntryHistoryOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeGetEntryHistory(params, context),
        },
        {
            name: 'list_tags',
            title: 'List Tags',
            description: 'List all unique tags used across all entries',
            group: 'core',
            inputSchema: ListTagsSchemaMcp,
            outputSchema: TagsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeListTags(params, context),
        },
        ...getDiagnosticTools(context),
    ]
}
