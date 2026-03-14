/**
 * Team Tool Group - 3 tools
 *
 * Tools: team_create_entry, team_get_recent, team_search
 *
 * Requires TEAM_DB_PATH to be configured. All tools return structured
 * errors when the team database is not available.
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { resolveAuthor } from '../../utils/security-utils.js'
import { resolveIssueUrl } from '../../utils/github-helpers.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES, MAX_CONTENT_LENGTH, EntryOutputSchema, relaxedNumber } from './schemas.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'



// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema for team entry creation */
const TeamCreateEntrySchema = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
    entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    project_number: z.number().optional(),
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    author: z.string().optional(),
})

/** Relaxed schema for MCP SDK */
const TeamCreateEntrySchemaMcp = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
    entry_type: z.string().optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    significance_type: z.string().optional(),
    project_number: relaxedNumber().optional(),
    project_owner: z.string().optional(),
    issue_number: relaxedNumber().optional(),
    issue_url: z.string().optional(),
    pr_number: relaxedNumber().optional(),
    pr_url: z.string().optional(),
    pr_status: z.string().optional(),
    author: z.string().optional(),
})

const TeamGetRecentSchema = z.object({
    limit: z.number().max(500).optional().default(10),
})

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
const TeamGetRecentSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(10),
})

const TeamSearchSchema = z.object({
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(500).optional().default(10),
})

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
const TeamSearchSchemaMcp = z.object({
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber().optional().default(10),
})

// ============================================================================
// Output Schemas
// ============================================================================

const TeamEntryOutputSchema = EntryOutputSchema.extend({
    author: z.string().nullable().optional(),
})

const TeamCreateOutputSchema = z.object({
    success: z.boolean().optional(),
    entry: TeamEntryOutputSchema.optional(),
    author: z.string().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

const TeamEntriesListOutputSchema = z.object({
    entries: z.array(TeamEntryOutputSchema).optional(),
    count: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

// ============================================================================
// Constants
// ============================================================================

const TEAM_DB_NOT_CONFIGURED =
    'Team database not configured. Set TEAM_DB_PATH environment variable to enable team collaboration.'

/**
 * Batch-fetch author names for a list of entry IDs.
 * Returns a Map<entryId, author> for O(1) lookups.
 */
function batchFetchAuthors(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entryIds: number[]
): Map<number, string | null> {
    const authorMap = new Map<number, string | null>()
    if (entryIds.length === 0) return authorMap

    const placeholders = entryIds.map(() => '?').join(',')
    const result = teamDb.executeRawQuery(
        `SELECT id, author FROM memory_journal WHERE id IN (${placeholders})`,
        entryIds
    )
    if (result[0]) {
        for (const row of result[0].values) {
            authorMap.set(row[0] as number, (row[1] as string) ?? null)
        }
    }
    return authorMap
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamTools(context: ToolContext): ToolDefinition[] {
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

                    // Auto-populate issueUrl if issue_number provided
                    const resolvedIssueUrl = resolveIssueUrl(github, input.issue_number, input.issue_url)

                    const entry = teamDb.createEntry({
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        isPersonal: false, // Team entries are always project-level
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

                    // Batch-fetch authors (single query instead of N+1)
                    const authorMap = batchFetchAuthors(teamDb, entries.map((e) => e.id))
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
            name: 'team_search',
            title: 'Search Team Entries',
            description:
                'Search entries in the team database by text and/or tags. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamSearchSchemaMcp,
            outputSchema: TeamEntriesListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { query, tags, limit } = TeamSearchSchema.parse(params)

                    let entries
                    if (query) {
                        entries = teamDb.searchEntries(query, { limit })
                    } else {
                        entries = teamDb.getRecentEntries(limit)
                    }

                    // Filter by tags if provided (batch query instead of N+1)
                    if (tags && tags.length > 0) {
                        const entryIds = entries.map((e) => e.id)
                        if (entryIds.length > 0) {
                            const placeholders = entryIds.map(() => '?').join(',')
                            const tagResult = teamDb.executeRawQuery(
                                `SELECT et.entry_id, t.name FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id IN (${placeholders})`,
                                entryIds
                            )
                            const entryTagMap = new Map<number, string[]>()
                            if (tagResult[0]) {
                                for (const row of tagResult[0].values) {
                                    const entryId = row[0] as number
                                    const tagName = row[1] as string
                                    const existing = entryTagMap.get(entryId) ?? []
                                    existing.push(tagName)
                                    entryTagMap.set(entryId, existing)
                                }
                            }
                            entries = entries.filter((e) => {
                                const entryTags = entryTagMap.get(e.id) ?? []
                                return tags.some((t: string) => entryTags.includes(t))
                            })
                        }
                    }

                    // Batch-fetch authors (single query instead of N+1)
                    const authorMap = batchFetchAuthors(teamDb, entries.map((e) => e.id))
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
    ]
}
