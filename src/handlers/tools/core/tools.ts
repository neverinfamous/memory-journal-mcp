import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveAuthor } from '../../../utils/security-utils.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'

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


export function getCoreTools(context: ToolContext): ToolDefinition[] {
    const { db, progress } = context

    return [
        {
            name: 'create_entry',
            title: 'Create Entry',
            description:
                'Create a new journal entry. Content must be well-structured markdown ' +
                'using ## section headers. For session summaries, use entry_type "retrospective" ' +
                'with tag "session-summary" and structure content as: ' +
                '## Accomplished, ## Unfinished / Blocked, ## Context for Next Session. ' +
                'REQUIRED: You MUST include project_number. Extract this from the Workspaces section of your session briefing.',
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

                    const wsId = resolveWorkspaceId(input.workspace_id, projectNumber, context.config)

                    // Optional progress for long operations
                    await sendProgress(progress, 0, 2, 'Creating entry...')

                    const resolvedIssueUrl = await resolveIssueUrl(
                        context,
                        projectNumber,
                        input.issue_number,
                        input.issue_url
                    )

                    const createdEntry = db.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        significanceType: input.significance_type,
                        projectNumber: projectNumber,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: resolvedIssueUrl,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status as 'queued' | 'in_progress' | 'completed' | undefined,
                        autoContext: input.auto_context,
                        workspaceId: wsId,
                        impactScore: input.impact_score,
                        trustScore: input.trust_score,
                        validationStatus: input.validation_status,
                    })
                    const id = createdEntry.id

                    // Vectorize entry
                    try {
                        const entry = db.getEntryById(id, wsId)
                        if (entry) {
                            await sendProgress(progress, 1, 2, 'Generating embeddings...')
                            await context.vectorManager?.addEntry(entry)
                        }
                    } catch (e) {
                        // Soft fail: return success but warn vector indexing failed
                        // Usually implies disabled or unavailable embedding model
                        await sendProgress(
                            progress,
                            2,
                            2,
                            'Entry created (Vector indexing disabled)'
                        )
                        return {
                            success: true,
                            id,
                            error: `Vector indexing failed: ${e instanceof Error ? e.message : String(e)}`,
                        }
                    }

                    await sendProgress(progress, 2, 2, 'Entry created successfully')

                    if (context.config?.subscriptionManager) {
                        void context.config.subscriptionManager.notifyResourceUpdated(
                            'memory://recent'
                        )
                    }
                    const finalEntry = db.getEntryById(id, wsId) ?? undefined

                    let sharedWithTeam = false
                    let author: string | undefined

                    if (input.share_with_team && context.teamDb) {
                        const authCtx = getAuthContext()
                        if (authCtx?.authenticated) {
                            const claims = authCtx.claims
                            const email = typeof claims?.['email'] === 'string' ? claims['email'] : undefined
                            const prefName = typeof claims?.['preferred_username'] === 'string' ? claims['preferred_username'] : undefined
                            const subject = typeof claims?.['subject'] === 'string' ? claims['subject'] : undefined
                            author = claims?.sub ?? email ?? prefName ?? subject ?? resolveAuthor()
                        } else {
                            author = resolveAuthor()
                        }

                        if (author && author !== 'unknown') {
                            context.teamDb.createEntry({
                                content: input.content,
                                entryType: input.entry_type,
                                tags: input.tags,
                                isPersonal: false,
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
                                workflowStatus: input.workflow_status as 'queued' | 'in_progress' | 'completed' | undefined,
                                author: author,
                                workspaceId: wsId,
                                impactScore: input.impact_score,
                                trustScore: input.trust_score,
                                validationStatus: input.validation_status,
                            })
                            context.teamDb.flushSave()
                            sharedWithTeam = true
                        }
                    }

                    return { success: true, id, entry: finalEntry, ...(sharedWithTeam ? { sharedWithTeam, author } : {}) }
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
                    const entry = db.getEntryById(input.entry_id)
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

                    const result: Record<string, unknown> = {
                        success: true,
                        entry,
                    }

                    if (input.include_relationships) {
                        const relationships = db.getRelationships(input.entry_id)
                        result['relationships'] = relationships
                    }

                    const importance = db.calculateImportance(input.entry_id)
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
                    const wsId = resolveWorkspaceId(input.workspace_id, undefined, context.config)
                    const result = db.getRecentEntries(input.limit, input.is_personal, input.sort_by, input.cursor, input.include_archived, wsId)
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
                    const current = db.getEntryById(input.entry_id)
                    if (!current) {
                        return {
                            success: false,
                            error: `Entry ${String(input.entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: true,
                        }
                    }

                    const rawHistory = db.getEntryHistory(input.entry_id)
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
            inputSchema: z.object({}).strict(), // No arguments required
            outputSchema: TagsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: () => {
                try {
                    const tags = db.listTags().map((t) => ({ name: t.name, count: t.usageCount ?? 0 }))
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
                await sendProgress(progress, 0, 3, 'Starting operation...')
                // Wait 500ms
                await new Promise((resolve) => setTimeout(resolve, 500))
                await sendProgress(progress, 1, 3, 'Processing step 1...')
                await new Promise((resolve) => setTimeout(resolve, 500))
                await sendProgress(progress, 2, 3, 'Processing step 2...')
                await new Promise((resolve) => setTimeout(resolve, 500))
                await sendProgress(progress, 3, 3, 'Operation complete')
                return { success: true, message: 'Progress notifications completed successfully' }
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
            handler: async (params: unknown) => {
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
                        const { MemoryJournalMcpError } = await import('../../../types/errors.js')
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

// Ensure z is imported for inline outputSchemas (get_recent_entries, etc)
import { z } from 'zod'
