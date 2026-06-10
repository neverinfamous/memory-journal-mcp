/**
 * Core Tool Group - 6 tools
 *
 * Tools: create_entry, get_entry_by_id, get_recent_entries,
 *        create_entry_minimal, test_simple, list_tags
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../utils/security-utils.js'
import { autoIndexEntry } from '../../utils/vector-index-helpers.js'
import { resolveIssueUrl } from '../../utils/github-helpers.js'
import { getAuthContext } from '../../auth/auth-context.js'
import { hasScope, SCOPES } from '../../auth/scopes.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { logger } from '../../utils/logger.js'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    MAX_CONTENT_LENGTH,
    EntryOutputSchema,
    EntriesListOutputSchema,
    RelationshipOutputSchema,
    ImportanceBreakdownSchema,
    relaxedNumber,
    MAX_QUERY_LIMIT,
    coerceSignificanceAlias,
    StrictProjectNumberSchema,
    TagOutputSchema,
    EntryHistoryListOutputSchema,
} from './schemas.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
export const CreateEntrySchema = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
    entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
    tags: z.array(z.string().max(100)).max(50).optional().default([]),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    auto_context: z.boolean().optional().default(true),
    project_number: StrictProjectNumberSchema,
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.enum(['queued', 'in_progress', 'completed']).optional(),
    share_with_team: z.boolean().optional().default(false),
})

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
export const CreateEntrySchemaMcp = z.object({
    content: z.string().optional(),
    entry_type: z
        .string()
        .optional()
        .default('personal_reflection')
        .describe('Choose the most accurate type. Do NOT default to personal_reflection.'),
    tags: z
        .array(z.string().max(100))
        .max(50)
        .optional()
        .default([])
        .describe(
            'MANDATORY: Provide at least one tag. Use activity (bug-fix, release), domain (security, architecture), or tool group tags.'
        ),
    is_personal: z.boolean().optional().default(true),
    significance_type: z
        .string()
        .optional()
        .describe(
            'Mark milestone completions, architecture decisions, and releases with a significance_type.'
        ),
    project_number: relaxedNumber(),
    project_owner: z.string().optional(),
    issue_number: relaxedNumber().optional(),
    issue_url: z.string().optional(),
    pr_number: relaxedNumber().optional(),
    pr_url: z.string().optional(),
    pr_status: z.string().optional(),
    workflow_run_id: relaxedNumber().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.string().optional(),
    share_with_team: z.boolean().optional().default(false),
})

const GetEntryByIdSchema = z.object({
    entry_id: z.number().int(),
    include_relationships: z.boolean().optional().default(true),
})

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
const GetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
    include_relationships: z.boolean().optional().default(true),
})

const GetEntryHistorySchema = z.object({
    entry_id: z.number().int(),
})

const GetEntryHistorySchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
})

const GetRecentEntriesSchema = z.object({
    limit: z.number().min(1).max(MAX_QUERY_LIMIT).optional().default(5),
    cursor: z.string().optional().describe('Cursor for pagination'),
    is_personal: z.boolean().optional(),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
})

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
const GetRecentEntriesSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(5),
    cursor: z.string().optional().describe('Cursor for pagination'),
    is_personal: z.boolean().optional(),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
})

const CreateEntryMinimalSchema = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
})

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
const CreateEntryMinimalSchemaMcp = z.object({
    content: z.string().optional(),
})

const TestSimpleSchema = z.object({
    message: z.string().optional().default('Hello'),
})

// ============================================================================
// Output Schemas
// ============================================================================

const CreateEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: EntryOutputSchema.optional(),
        sharedWithTeam: z.boolean().optional(),
        author: z.string().optional(),
        teamError: z.string().optional(),
        indexStatus: z.string().optional(),
        enrichmentStatus: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const EntryByIdOutputSchema = z
    .object({
        entry: EntryOutputSchema.optional(),
        relationships: z.array(RelationshipOutputSchema).optional(),
        importance: z.number().nullable().optional(),
        importanceBreakdown: ImportanceBreakdownSchema.optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const TestSimpleOutputSchema = z
    .object({
        success: z.boolean().optional(),
        message: z.string(),
    })
    .extend(ErrorFieldsMixin.shape)

const TagsListOutputSchema = z
    .object({
        tags: z.array(TagOutputSchema).optional(),
        count: z.number().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Tool Definitions
// ============================================================================

export function getCoreTools(context: ToolContext): ToolDefinition[] {
    const { db, teamDb, vectorManager } = context
    return [
        {
            name: 'create_entry',
            title: 'Create Journal Entry',
            description:
                'Create a new personal journal entry. MANDATORY: After creating, always attempt to causally link new entries to prior context (evolves_from, implements, blocked_by, resolved) using link_entries.',
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

                    if (params !== null && typeof params === 'object' && 'auto_context' in params) {
                        context.config?.runtime?.metrics?.recordDeprecationWarning(
                            'Agent recently used deprecated auto_context field in create_entry. This field is ignored.'
                        )
                    }

                    const input = CreateEntrySchema.parse(params)

                    const projectNumber = input.project_number
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }

                    // The user's provided issueUrl (if any)
                    const initialIssueUrl = input.issue_url

                    let entry = db.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        significanceType: input.significance_type ?? null,
                        autoContext: !input.auto_context
                            ? JSON.stringify({ disabled: true })
                            : undefined,
                        projectNumber: projectNumber,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: initialIssueUrl,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status,
                    })

                    // Share with team if requested
                    let sharedWithTeam = false
                    let author: string | undefined
                    let teamEntryId: number | undefined
                    let teamError: string | undefined
                    if (input.share_with_team && teamDb) {
                        try {
                            const authCtx = getAuthContext()
                            const hasTeamScope = hasScope(
                                authCtx?.claims?.scopes ?? [],
                                SCOPES.TEAM
                            )
                            const envAuthor = process.env['TEAM_AUTHOR']?.trim()
                            const codemodeBypass =
                                context.config?.codemodeInternalFullAccess === true
                            if (!hasTeamScope && !envAuthor && !codemodeBypass) {
                                throw new Error(
                                    'Insufficient scope: team scope is required to share entries with the team'
                                )
                            }
                            author = resolveAuthenticatedAuthor()
                            const teamEntry = teamDb.createEntry({
                                content: input.content,
                                entryType: input.entry_type,
                                tags: input.tags,
                                isPersonal: false,
                                significanceType: input.significance_type ?? null,
                                autoContext: JSON.stringify({ author }),
                                projectNumber: projectNumber,
                                projectOwner: input.project_owner,
                                issueNumber: input.issue_number,
                                issueUrl: initialIssueUrl,
                                prNumber: input.pr_number,
                                prUrl: input.pr_url,
                                prStatus: input.pr_status,
                                workflowRunId: input.workflow_run_id,
                                workflowName: input.workflow_name,
                                workflowStatus: input.workflow_status,
                                author,
                            })
                            teamEntryId = teamEntry.id
                            teamDb.flushSave()
                            if (context.config?.subscriptionManager) {
                                void context.config.subscriptionManager.notifyResourceUpdated('memory://team/recent')
                                void context.config.subscriptionManager.notifyResourceUpdated('memory://briefing')
                            }
                            sharedWithTeam = true
                        } catch (error) {
                            logger.error(
                                'Failed to share entry with team DB, retaining personal entry',
                                {
                                    module: 'TOOL',
                                    operation: 'create-entry',
                                    error: error instanceof Error ? error.message : String(error),
                                }
                            )
                            teamError = error instanceof Error ? error.message : String(error)
                        }
                    }

                    // Auto-populate issueUrl if issue_number provided without issueUrl
                    let enrichmentStatus = 'complete'
                    if (input.issue_number !== undefined && !input.issue_url) {
                        try {
                            const resolvedUrl = await resolveIssueUrl(
                                context,
                                projectNumber,
                                input.issue_number,
                                input.issue_url
                            )
                            if (resolvedUrl) {
                                const updatedEntry = db.updateEntry(entry.id, {
                                    issueUrl: resolvedUrl,
                                })
                                if (updatedEntry) {
                                    entry = updatedEntry
                                }
                                if (teamDb && teamEntryId !== undefined) {
                                    teamDb.updateEntry(teamEntryId, { issueUrl: resolvedUrl })
                                }
                            } else {
                                enrichmentStatus = 'failed'
                            }
                        } catch (err: unknown) {
                            logger.error('Failed to resolve issue url synchronously', {
                                error: String(err),
                            })
                            enrichmentStatus = 'failed: ' + String(err)
                        }
                    }

                    // Auto-index to vector store for semantic search synchronously
                    // to ensure index status is accurately reported to the client.
                    // This is done after team DB share to prevent async embeddings from surviving a rollback.
                    const indexStatus = await autoIndexEntry(vectorManager, entry.id, entry.content)

                    return {
                        success: true,
                        entry,
                        indexStatus,
                        enrichmentStatus,
                        ...(sharedWithTeam ? { sharedWithTeam: true, author } : {}),
                        ...(teamError ? { teamError } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_entry_by_id',
            title: 'Get Entry by ID',
            description: 'Get a specific journal entry by ID with full details',
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
                    const { entry_id, include_relationships } = GetEntryByIdSchema.parse(params)
                    const entry = db.getEntryById(entry_id)
                    if (!entry) {
                        return {
                            success: false,
                            error: `Entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and try again',
                            recoverable: true,
                        }
                    }
                    const { score: importance, breakdown: importanceBreakdown } =
                        db.calculateImportance(entry_id)
                    const result: Record<string, unknown> = {
                        success: true,
                        entry,
                        importance,
                        importanceBreakdown,
                    }
                    if (include_relationships) {
                        result['relationships'] = db.getRelationships(entry_id)
                    }
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_entry_history',
            title: 'Get Entry History',
            description: 'Get the revision history for a specific journal entry',
            group: 'core',
            inputSchema: GetEntryHistorySchemaMcp,
            outputSchema: EntryHistoryListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { entry_id } = GetEntryHistorySchema.parse(params)
                    // Check if entry exists first
                    const entry = db.getEntryByIdIncludeDeleted(entry_id)
                    if (!entry) {
                        return {
                            success: false,
                            error: `Entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and try again',
                            recoverable: true,
                        }
                    }
                    const revisions = db.getEntryHistory(entry_id)
                    return { success: true, revisions, count: revisions.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_recent_entries',
            title: 'Get Recent Entries',
            description: 'Get recent journal entries',
            group: 'core',
            inputSchema: GetRecentEntriesSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { limit, cursor, is_personal, sort_by } = GetRecentEntriesSchema.parse(params)
                    const result = db.getRecentEntries(limit, is_personal, sort_by, cursor)
                    return { success: true, entries: result.entries, count: result.entries.length, degraded: false, next_cursor: result.nextCursor }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'create_entry_minimal',
            title: 'Create Entry (Minimal)',
            description: 'Minimal entry creation without context or tags',
            group: 'core',
            inputSchema: CreateEntryMinimalSchemaMcp,
            outputSchema: CreateEntryOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const { content } = CreateEntryMinimalSchema.parse(params)
                    const entry = db.createEntry({ content })

                    // Auto-index to vector store for semantic search synchronously
                    const indexStatus = await autoIndexEntry(vectorManager, entry.id, entry.content)

                    return { success: true, entry, indexStatus }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'test_simple',
            title: 'Test Simple',
            description: 'Simple test tool that just returns a message',
            group: 'core',
            inputSchema: TestSimpleSchema,
            outputSchema: TestSimpleOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { message } = TestSimpleSchema.parse(params)
                    return { success: true, message: `Test response: ${message}` }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_briefing',
            title: 'Get Briefing',
            description: 'Get the exact markdown string for the session briefing. Same as reading memory://briefing resource.',
            group: 'core',
            inputSchema: z.object({
                 repo_name: z.string().optional().describe('Optional repository name')
            }),
            outputSchema: z.object({
                 success: z.boolean().optional(),
                 markdown: z.string().optional(),
                 error: z.string().optional()
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = z.object({ repo_name: z.string().optional() }).parse(params)
                    
                    const resourceContext = {
                        db: context.db,
                        teamDb: context.teamDb,
                        vectorManager: context.vectorManager,
                        filterConfig: context.config?.filterConfig,
                        github: context.github ?? null,
                        scheduler: null,
                        briefingConfig: context.config?.briefingConfig,
                        runtime: context.config?.runtime
                    }

                    const { buildBriefingData } = await import('../resources/core/briefing/index.js')
                    const result = await buildBriefingData(resourceContext, input.repo_name)

                    return { success: true, markdown: String(result.data) }
                } catch (err) {
                    return formatHandlerError(err)
                }
            }
        },
        {
            name: 'list_tags',
            title: 'List Tags',
            description:
                'List all available tags. Tags are auto-formatted to kebab-case. Returns only name and count. Does not return orphan tags with zero usage.',
            group: 'core',
            inputSchema: z.object({}).strict(),
            outputSchema: TagsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (_params: unknown) => {
                try {
                    const rawTags = db.listTags()
                    const tags = rawTags.map((t) => ({ name: t.name, count: t.usageCount }))
                    return { success: true, tags, count: tags.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
