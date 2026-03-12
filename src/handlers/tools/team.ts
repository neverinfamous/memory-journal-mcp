/**
 * Team Tool Group - 3 tools
 *
 * Tools: team_create_entry, team_get_recent, team_search
 *
 * Requires TEAM_DB_PATH to be configured. All tools return structured
 * errors when the team database is not available.
 */

import { z } from 'zod'
import { execFileSync } from 'node:child_process'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerErrorResponse } from '../../utils/error-helpers.js'
import { sanitizeAuthor } from '../../utils/security-utils.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES, EntryOutputSchema, relaxedNumber } from './schemas.js'
import { ErrorResponseFields } from './error-response-fields.js'

// ============================================================================
// Author Detection
// ============================================================================

/**
 * Resolve the author name for team entries.
 * Priority: TEAM_AUTHOR env > git config user.name > 'unknown'
 */
function resolveAuthor(): string {
    // 1. Explicit env var
    const envAuthor = process.env['TEAM_AUTHOR']?.trim().replace(/"/g, '')
    if (envAuthor) return sanitizeAuthor(envAuthor)

    // 2. Git config
    try {
        const gitUser = execFileSync('git', ['config', 'user.name'], {
            encoding: 'utf-8',
            timeout: 3000,
        })
            .trim()
            .replace(/"/g, '')
        if (gitUser) return sanitizeAuthor(gitUser)
    } catch {
        // Git not available or not configured
    }

    return 'unknown'
}

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema for team entry creation */
const TeamCreateEntrySchema = z.object({
    content: z.string().min(1).max(50000),
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
    content: z.string().min(1).max(50000),
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
}).extend(ErrorResponseFields.shape)

const TeamEntriesListOutputSchema = z.object({
    entries: z.array(TeamEntryOutputSchema).optional(),
    count: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
}).extend(ErrorResponseFields.shape)

// ============================================================================
// Constants
// ============================================================================

const TEAM_DB_NOT_CONFIGURED =
    'Team database not configured. Set TEAM_DB_PATH environment variable to enable team collaboration.'

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
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const input = TeamCreateEntrySchema.parse(params)
                    const author = input.author ?? resolveAuthor()

                    // Auto-populate issueUrl if issue_number provided
                    let resolvedIssueUrl = input.issue_url
                    if (input.issue_number !== undefined && !input.issue_url && github) {
                        const cachedRepo = github.getCachedRepoInfo()
                        if (cachedRepo?.owner && cachedRepo?.repo) {
                            resolvedIssueUrl = `https://github.com/${cachedRepo.owner}/${cachedRepo.repo}/issues/${String(input.issue_number)}`
                        }
                    }

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

                    // Write author to the dedicated column
                    const rawDb = teamDb.getRawDb()
                    rawDb.run('UPDATE memory_journal SET author = ? WHERE id = ?', [
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
                    return formatHandlerErrorResponse(err)
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
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { limit } = TeamGetRecentSchema.parse(params)
                    const entries = teamDb.getRecentEntries(limit)

                    // Enrich entries with author column
                    const rawDb = teamDb.getRawDb()
                    const enriched = entries.map((e) => {
                        const authorResult = rawDb.exec(
                            'SELECT author FROM memory_journal WHERE id = ?',
                            [e.id]
                        )
                        const author = (authorResult[0]?.values[0]?.[0] as string) ?? null
                        return { ...e, author }
                    })

                    return { entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
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
            annotations: { readOnlyHint: true, idempotentHint: true },
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

                    // Filter by tags if provided
                    if (tags && tags.length > 0) {
                        entries = entries.filter((e) => {
                            const entryTags = teamDb.getTagsForEntry(e.id)
                            return tags.some((t) => entryTags.includes(t))
                        })
                    }

                    // Enrich with author
                    const rawDb = teamDb.getRawDb()
                    const enriched = entries.map((e) => {
                        const authorResult = rawDb.exec(
                            'SELECT author FROM memory_journal WHERE id = ?',
                            [e.id]
                        )
                        const author = (authorResult[0]?.values[0]?.[0] as string) ?? null
                        return { ...e, author }
                    })

                    return { entries: enriched, count: enriched.length }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
    ]
}
