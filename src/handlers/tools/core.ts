/**
 * Core Tool Group - 6 tools
 *
 * Tools: create_entry, get_entry_by_id, get_recent_entries,
 *        create_entry_minimal, test_simple, list_tags
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    EntryOutputSchema,
    EntriesListOutputSchema,
    RelationshipOutputSchema,
    ImportanceBreakdownSchema,
    TagOutputSchema,
} from './schemas.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
const CreateEntrySchema = z.object({
    content: z.string().min(1).max(50000),
    entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    auto_context: z.boolean().optional().default(true),
    project_number: z.number().optional(),
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.enum(['queued', 'in_progress', 'completed']).optional(),
})

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
const CreateEntrySchemaMcp = z.object({
    content: z.string().min(1).max(50000),
    entry_type: z.string().optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.string().optional(),
    auto_context: z.boolean().optional().default(true),
    project_number: z.number().optional(),
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.string().optional(),
    workflow_run_id: z.number().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.string().optional(),
})

const GetEntryByIdSchema = z.object({
    entry_id: z.number(),
    include_relationships: z.boolean().optional().default(true),
})

const GetRecentEntriesSchema = z.object({
    limit: z.number().optional().default(5),
    is_personal: z.boolean().optional(),
})

const CreateEntryMinimalSchema = z.object({
    content: z.string().min(1).max(50000),
})

const TestSimpleSchema = z.object({
    message: z.string().optional().default('Hello'),
})

// ============================================================================
// Output Schemas
// ============================================================================

const CreateEntryOutputSchema = z.object({
    success: z.boolean().optional(),
    entry: EntryOutputSchema.optional(),
    error: z.string().optional(),
})

const EntryByIdOutputSchema = z.object({
    entry: EntryOutputSchema.optional(),
    relationships: z.array(RelationshipOutputSchema).optional(),
    importance: z.number().nullable().optional(),
    importanceBreakdown: ImportanceBreakdownSchema.optional(),
    error: z.string().optional(),
})

const TestSimpleOutputSchema = z.object({
    message: z.string(),
})

const TagsListOutputSchema = z.object({
    tags: z.array(TagOutputSchema).optional(),
    count: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
})

// ============================================================================
// Tool Definitions
// ============================================================================

export function getCoreTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager, github } = context
    return [
        {
            name: 'create_entry',
            title: 'Create Journal Entry',
            description:
                'Create a new journal entry with context and tags (v2.1.0: GitHub Actions support)',
            group: 'core',
            inputSchema: CreateEntrySchemaMcp,
            outputSchema: CreateEntryOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    const input = CreateEntrySchema.parse(params)

                    // Auto-populate issueUrl if issue_number provided without issueUrl
                    let resolvedIssueUrl = input.issue_url
                    if (input.issue_number !== undefined && !input.issue_url && github) {
                        const cachedRepo = github.getCachedRepoInfo()
                        if (cachedRepo?.owner && cachedRepo?.repo) {
                            resolvedIssueUrl = `https://github.com/${cachedRepo.owner}/${cachedRepo.repo}/issues/${String(input.issue_number)}`
                        }
                    }

                    const entry = db.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: input.is_personal,
                        significanceType: input.significance_type ?? null,
                        projectNumber: input.project_number,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: resolvedIssueUrl,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status,
                    })

                    // Auto-index to vector store for semantic search (fire-and-forget)
                    if (vectorManager) {
                        vectorManager.addEntry(entry.id, entry.content).catch(() => {
                            // Non-critical failure, entry already saved to DB
                        })
                    }

                    return { success: true, entry }
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
            inputSchema: GetEntryByIdSchema,
            outputSchema: EntryByIdOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const { entry_id, include_relationships } = GetEntryByIdSchema.parse(params)
                    const entry = db.getEntryById(entry_id)
                    if (!entry) {
                        return { success: false, error: `Entry ${String(entry_id)} not found` }
                    }
                    const { score: importance, breakdown: importanceBreakdown } =
                        db.calculateImportance(entry_id)
                    const result: Record<string, unknown> = {
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
            name: 'get_recent_entries',
            title: 'Get Recent Entries',
            description: 'Get recent journal entries',
            group: 'core',
            inputSchema: GetRecentEntriesSchema,
            outputSchema: EntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const { limit, is_personal } = GetRecentEntriesSchema.parse(params)
                    const entries = db.getRecentEntries(limit, is_personal)
                    return { entries, count: entries.length }
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
            inputSchema: CreateEntryMinimalSchema,
            outputSchema: CreateEntryOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    const { content } = CreateEntryMinimalSchema.parse(params)
                    const entry = db.createEntry({ content })

                    // Auto-index to vector store for semantic search (fire-and-forget)
                    if (vectorManager) {
                        vectorManager.addEntry(entry.id, entry.content).catch(() => {
                            // Non-critical failure, entry already saved to DB
                        })
                    }

                    return { success: true, entry }
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
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const { message } = TestSimpleSchema.parse(params)
                    return { message: `Test response: ${message}` }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'list_tags',
            title: 'List Tags',
            description: 'List all available tags',
            group: 'core',
            inputSchema: z.object({}),
            outputSchema: TagsListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (_params: unknown) => {
                try {
                    const rawTags = db.listTags()
                    const tags = rawTags.map((t) => ({ name: t.name, count: t.usageCount }))
                    return { tags, count: tags.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
