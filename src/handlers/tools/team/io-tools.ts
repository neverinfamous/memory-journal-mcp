/**
 * Team IO Tools — 2 tools
 *
 * Tools: team_export_markdown, team_import_markdown
 *
 * Team equivalents of export_markdown and import_markdown that operate
 * on the team database and preserve the author field.
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'

import { resolveAuthor } from '../../../utils/security-utils.js'
import { exportEntriesToMarkdown } from '../../../markdown/index.js'
import { importMarkdownEntries } from '../../../markdown/index.js'
import type { ExportableEntry } from '../../../markdown/index.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { batchFetchAuthors } from './helpers.js'
import {
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    DATE_MIN_SENTINEL,
    DATE_MAX_SENTINEL,
    relaxedNumber,
} from '../schemas.js'

// ============================================================================
// Schemas
// ============================================================================

const TeamExportMarkdownSchema = z.object({
    output_dir: z.string().min(1),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(500).optional().default(100),
})

const TeamExportMarkdownSchemaMcp = z.object({
    output_dir: z.string().describe('Target directory for .md files'),
    start_date: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max entries to export (default: 100, max: 500)'),
})

const TeamExportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        exported_count: z.number().optional(),
        output_dir: z.string().optional(),
        files: z.array(z.string()).optional(),
        skipped: z.number().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const TeamImportMarkdownSchema = z.object({
    source_dir: z.string().min(1),
    dry_run: z.boolean().optional().default(false),
    limit: z.number().max(500).optional().default(100),
})

const TeamImportMarkdownSchemaMcp = z.object({
    source_dir: z.string().describe('Directory containing .md files to import'),
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('Parse and validate without writing to database'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max files to process (default: 100, max: 500)'),
})

const TeamImportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        created: z.number().optional(),
        updated: z.number().optional(),
        skipped: z.number().optional(),
        errors: z.array(z.object({ file: z.string(), error: z.string() })).optional(),
        dry_run: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamIoTools(context: ToolContext): ToolDefinition[] {
    const { teamDb, progress } = context

    if (!teamDb) {
        return [
            {
                name: 'team_export_markdown',
                title: 'Team Export to Markdown',
                description: 'Export team entries as frontmattered Markdown files',
                group: 'team',
                inputSchema: TeamExportMarkdownSchemaMcp,
                outputSchema: TeamExportMarkdownOutputSchema,
                annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
                handler: () => ({
                    success: false,
                    error: 'Team collaboration is not configured. Set TEAM_DB_PATH to enable.',
                }),
            },
            {
                name: 'team_import_markdown',
                title: 'Team Import from Markdown',
                description: 'Import frontmattered Markdown files into the team journal',
                group: 'team',
                inputSchema: TeamImportMarkdownSchemaMcp,
                outputSchema: TeamImportMarkdownOutputSchema,
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                    openWorldHint: true,
                },
                handler: () => ({
                    success: false,
                    error: 'Team collaboration is not configured. Set TEAM_DB_PATH to enable.',
                }),
            },
        ]
    }

    return [
        {
            name: 'team_export_markdown',
            title: 'Team Export to Markdown',
            description:
                'Export team journal entries as individual frontmattered Markdown files (.md). ' +
                'Includes author field in frontmatter. Files can be re-imported via team_import_markdown.',
            group: 'team',
            inputSchema: TeamExportMarkdownSchemaMcp,
            outputSchema: TeamExportMarkdownOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = TeamExportMarkdownSchema.parse(params)

                    // Determine allowed roots from project registry and CWD
                    const allowedRoots = [process.cwd()]
                    if (context.config?.projectRegistry) {
                        for (const entry of Object.values(context.config.projectRegistry)) {
                            allowedRoots.push(entry.path)
                        }
                    }



                    await sendProgress(progress, 0, 3, 'Fetching team entries...')

                    const limit = input.limit ?? 100
                    let entries
                    if (input.start_date || input.end_date) {
                        const startDate = input.start_date ?? DATE_MIN_SENTINEL
                        const endDate = input.end_date ?? DATE_MAX_SENTINEL
                        entries = teamDb.searchByDateRange(startDate, endDate, {
                            tags: input.tags,
                            limit,
                        })
                    } else {
                        entries = teamDb.getRecentEntries(limit)
                    }

                    await sendProgress(
                        progress,
                        1,
                        3,
                        `Exporting ${String(entries.length)} team entries...`
                    )

                    // Batch-fetch authors from team DB (author column is not on JournalEntry)
                    const entryIds = entries.map((e) => e.id)
                    const authorMap = batchFetchAuthors(teamDb, entryIds)

                    // Map to ExportableEntry with resolved author
                    const exportable: ExportableEntry[] = entries.map((e) => ({
                        id: e.id,
                        content: e.content,
                        entryType: e.entryType,
                        timestamp: e.timestamp,
                        tags: e.tags,
                        significance: e.significanceType ?? undefined,
                        author: authorMap.get(e.id) ?? undefined,
                    }))

                    const result = await exportEntriesToMarkdown(
                        exportable,
                        input.output_dir,
                        teamDb,
                        allowedRoots
                    )

                    await sendProgress(progress, 3, 3, 'Team export complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_import_markdown',
            title: 'Team Import from Markdown',
            description:
                'Import frontmattered Markdown files (.md) into the team journal. ' +
                'Author is set from TEAM_AUTHOR env or git config. ' +
                'Use dry_run: true to preview without writing.',
            group: 'team',
            inputSchema: TeamImportMarkdownSchemaMcp,
            outputSchema: TeamImportMarkdownOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = TeamImportMarkdownSchema.parse(params)

                    // Determine allowed roots from project registry and CWD
                    const allowedRoots = [process.cwd()]
                    if (context.config?.projectRegistry) {
                        for (const entry of Object.values(context.config.projectRegistry)) {
                            allowedRoots.push(entry.path)
                        }
                    }



                    await sendProgress(progress, 0, 2, 'Reading markdown files...')

                    const author = resolveAuthor()
                    const result = await importMarkdownEntries(
                        input.source_dir,
                        teamDb,
                        {
                            dry_run: input.dry_run,
                            limit: input.limit,
                            author,
                        },
                        context.teamVectorManager,
                        allowedRoots
                    )

                    await sendProgress(progress, 2, 2, 'Team import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
