import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { buildCreateEntryInput, shareCreatedEntryWithTeam } from './create-entry-helpers.js'
import { resolveWorkspaceId, resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { MemoryJournalMcpError } from '../../../types/errors.js'
import { logger } from '../../../utils/logger.js'

import {
    CreateEntrySchema,
    CreateEntrySchemaMcp,
    CreateEntryOutputSchema,
    GetEntryByIdSchema,
    GetEntryByIdSchemaMcp,
    EntryByIdOutputSchema,
    GetRecentEntriesSchema,
    GetRecentEntriesSchemaMcp,
    GetEntryHistorySchema,
    GetEntryHistorySchemaMcp,
    GetEntryHistoryOutputSchema,
    TagsListOutputSchema,
    TestSimpleSchema,
    TestSimpleOutputSchema,
} from './schemas.js'
import { EntryOutputSchema, coerceSignificanceAlias } from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { linkRequestedRelationships } from '../relationship-linking.js'
import { resolveEntryAnchors } from './staleness-tools.js'

/** Delay between steps of the `trigger_progress` demo tool. */
const PROGRESS_DEMO_STEP_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


export function getCoreTools(context: ToolContext): ToolDefinition[] {
    const { db, progress } = context

    return [
        {
            name: 'create_entry',
            title: 'Create Entry',
            description:
                'Create a new journal entry. Content must be well-structured markdown ' +
                'using ## section headers. Select the most accurate entry_type (e.g., retrospective, personal_reflection, technical_note). ' +
                'For session summaries, use entry_type "retrospective" ' +
                'with tag "session-summary" and structure content as: ' +
                '## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. ' +
                'REQUIRED: You MUST include project_number. Extract this by querying memory://agent-id. ' +
                'REQUIRED: You MUST include impact_score, trust_score, and validation_status. ' +
                'REQUIRED: You MUST use related_to to anchor the entry to a session summary or nearby context.',
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
                    coerceSignificanceAlias(params)
                    const input = CreateEntrySchema.parse(params)
                    if (input.workspace_id === '*') {
                        return {
                            success: false,
                            error: "workspace_id '*' is a read-only wildcard and cannot be used to create an entry. Pass a specific workspace_id or project_number.",
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Pass the repository name, such as "memory-journal-mcp", or a project_number.',
                            recoverable: true,
                        }
                    }

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

                    if (projectNumber === undefined || projectNumber === null || projectNumber <= 0) {
                        return {
                            success: false,
                            error: 'Missing or unresolvable project_number. Entry creation blocked because no valid project could be determined for this entry.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'To find your project_number, call list_projects (or mj.core.listProjects()), read the memory://agent-id resource via read_resource (e.g. read_resource("memory-journal-mcp", "memory://agent-id")), or inspect memory://briefing/<project-name>. Then pass project_number explicitly in your request.',
                            recoverable: true,
                        }
                    }

                    // Optional progress for long operations
                    await sendProgress(progress, 0, 2, 'Creating entry...')

                    const resolvedIssueUrl = await resolveIssueUrl(
                        context,
                        projectNumber,
                        input.issue_number,
                        input.issue_url
                    )

                    const resolvedAnchors = resolveEntryAnchors(
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
                        wsId
                    )

                    // Vectorize entry
                    let vectorWarning: string | undefined
                    if (context.vectorManager) {
                        try {
                            await sendProgress(progress, 1, 2, 'Generating embeddings...')
                            await context.vectorManager.addEntry(createdEntry)
                        } catch (e) {
                            // Soft fail: continue notifications & team share, attach vector indexing warning
                            vectorWarning = `Vector indexing failed: ${e instanceof Error ? e.message : String(e)}`
                            await sendProgress(
                                progress,
                                2,
                                2,
                                'Entry created (Vector indexing disabled)'
                            )
                        }
                    }

                    if (!vectorWarning) {
                        await sendProgress(progress, 2, 2, 'Entry created successfully')
                    }

                    if (context.config?.subscriptionManager) {
                        void context.config.subscriptionManager
                            .notifyResourceUpdated('memory://recent')
                            .catch((err: unknown) => {
                                logger.debug('Failed to notify resource updated', { error: err })
                            })
                    }
                    const finalEntry = createdEntry

                    let sharedWithTeam = false
                    let author: string | undefined

                    if (input.share_with_team) {
                        if (!context.teamDb) {
                            relationshipWarnings.push(
                                'Team sharing skipped: team database is not configured (set TEAM_DB_PATH).'
                            )
                        } else {
                            author = shareCreatedEntryWithTeam(context, entryInput)
                            sharedWithTeam = author !== undefined
                            if (!sharedWithTeam) {
                                relationshipWarnings.push(
                                    'Team sharing skipped: author identity could not be resolved.'
                                )
                            }
                        }
                    }

                    return {
                        success: true,
                        id,
                        entry: finalEntry,
                        ...(vectorWarning ? { error: vectorWarning } : {}),
                        ...(sharedWithTeam ? { sharedWithTeam, author } : {}),
                        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
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
                    const input = GetEntryByIdSchema.parse(params)
                    let wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const entry = db.getEntryById(input.entry_id, wsId)
                    if (entry?.workspaceId !== undefined && (wsId === '*' || wsId === 'default')) {
                        wsId = entry.workspaceId
                    }
                    if (!entry) {
                        return {
                            success: false,
                            error: `Entry ${String(input.entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID exists and you have access to it',
                            recoverable: true,
                        }
                    }

                    const result: Record<string, unknown> = { success: true, entry }

                    if (input.include_relationships) {
                        const relationships = db.getRelationships(input.entry_id, wsId)
                        result['relationships'] = relationships
                    }

                    const importance = db.calculateImportance(input.entry_id, wsId)
                    result['importance'] = importance.score
                    result['importanceBreakdown'] = importance.breakdown

                    return result
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
            outputSchema: z.object({ success: z.boolean().optional(), entries: z.array(EntryOutputSchema).optional(), count: z.number().optional(), next_cursor: z.string().optional(), hasMore: z.boolean().optional() }).extend(ErrorFieldsMixin.shape), // Output schema inline for array wrap
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = GetRecentEntriesSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const result = db.getRecentEntries(input.limit, input.is_personal, input.sort_by, input.cursor, input.include_archived, wsId, input.project_number, input.offset)
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
            },
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
            handler: (params: unknown) => {
                try {
                    const input = GetEntryHistorySchema.parse(params)
                    let wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const current = db.getEntryById(input.entry_id, wsId)
                    if (current?.workspaceId !== undefined && (wsId === '*' || wsId === 'default')) {
                        wsId = current.workspaceId
                    }
                    if (!current) {
                        return {
                            success: false,
                            error: `Entry ${String(input.entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: true,
                        }
                    }

                    const rawHistory = db.getEntryHistory(input.entry_id, wsId)
                    const history = rawHistory.map(rev => ({
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
            },
        },
        {
            name: 'list_tags',
            title: 'List Tags',
            description: 'List all unique tags used across all entries',
            group: 'core',
            inputSchema: z.object({
                project_number: z.coerce.number().int().optional(),
                workspace_id: z.string().optional(),
            }),
            outputSchema: TagsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = z
                        .object({
                            project_number: z.coerce.number().int().optional(),
                            workspace_id: z.string().optional(),
                        })
                        .parse(params ?? {})
                    const wsId = resolveWorkspaceId(
                        input.workspace_id,
                        input.project_number,
                        context.config
                    )
                    const tags = db
                        .listTags(wsId)
                        .map((t) => ({ name: t.name, count: t.usageCount ?? 0 }))
                    return { success: true, tags, count: tags.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },

        // ==================================================================
        // Utility/Debug Tools
        // ==================================================================
        {
            name: 'test_simple',
            title: 'Test Simple Echo',
            description: 'A simple echo tool for testing connection and basic parameter parsing.',
            group: 'core',
            inputSchema: TestSimpleSchema, // Exact string mapping
            outputSchema: TestSimpleOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = TestSimpleSchema.parse(params)
                    return {
                        success: true,
                        message: `Echo: ${input.message}`,
                        timestamp: new Date().toISOString(),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'trigger_progress',
            title: 'Test Progress Notifications',
            description: 'Triggers a sequence of progress notifications to verify the transport layer supports them.',
            group: 'core',
            inputSchema: z.object({}).strict(),
            outputSchema: z.object({ success: z.boolean(), message: z.string() }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async () => {
                try {
                    await sendProgress(progress, 0, 3, 'Starting operation...')
                    await sleep(PROGRESS_DEMO_STEP_DELAY_MS)
                    await sendProgress(progress, 1, 3, 'Processing step 1...')
                    await sleep(PROGRESS_DEMO_STEP_DELAY_MS)
                    await sendProgress(progress, 2, 3, 'Processing step 2...')
                    await sleep(PROGRESS_DEMO_STEP_DELAY_MS)
                    await sendProgress(progress, 3, 3, 'Operation complete')
                    return { success: true, message: 'Progress notifications completed successfully' }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'test_error_handling',
            title: 'Test Error Handling',
            description: 'Throws a specific type of error to verify the server formats and returns them correctly over MCP.',
            group: 'core',
            inputSchema: z.object({
                error_type: z.enum(['zod', 'type', 'database', 'generic', 'memory_journal']),
                message: z.string().optional().default('Test error message'),
            }),
            outputSchema: z.object({}).extend(ErrorFieldsMixin.shape), // Note: Error will bypass normal schema and be formatted
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = z.object({
                        error_type: z.enum(['zod', 'type', 'database', 'generic', 'memory_journal']),
                        message: z.string().optional().default('Test error message'),
                    }).parse(params)

                    // Helper to simulate database errors which SQLite often throws as raw Error objects
                    if (input.error_type === 'database') {
                        const err = new Error(`SQLITE_CONSTRAINT: ${input.message}`)
                        Object.defineProperty(err, 'code', { value: 'SQLITE_CONSTRAINT', enumerable: true })
                        throw err
                    }

                    if (input.error_type === 'type') {
                        throw new TypeError(input.message)
                    }

                    if (input.error_type === 'memory_journal') {
                        throw new MemoryJournalMcpError(
                            input.message,
                            'TEST_ERROR',
                            'internal'
                        )
                    }

                    if (input.error_type === 'zod') {
                        // Force a zod error
                        z.object({ required_field: z.string() }).parse({})
                    }

                    throw new Error(input.message)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
