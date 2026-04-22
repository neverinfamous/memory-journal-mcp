/**
 * IO Tool Group
 *
 * Tools: export_entries, export_markdown, import_markdown
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { logger } from '../../utils/logger.js'

import { exportEntriesToMarkdown } from '../../markdown/index.js'
import { importMarkdownEntries } from '../../markdown/index.js'
import type { ExportableEntry } from '../../markdown/index.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    DATE_MIN_SENTINEL,
    DATE_MAX_SENTINEL,
    EntryOutputSchema,
    relaxedNumber,
} from './schemas.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
const ExportEntriesSchema = z.object({
    format: z.enum(['json', 'markdown']).optional().default('json'),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    entry_types: z.array(z.enum(ENTRY_TYPES)).optional(),
    tags: z.array(z.string()).optional(),
    limit: z
        .number()
        .max(500)
        .optional()
        .default(100)
        .describe('Maximum entries to export (default: 100)'),
})

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const ExportEntriesSchemaMcp = z.object({
    format: z.string().optional().default('json'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    entry_types: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Maximum entries to export (default: 100)'),
})

// ============================================================================
// Output Schemas
// ============================================================================

const ExportEntriesOutputSchema = z
    .object({
        format: z.enum(['json', 'markdown']).optional(),
        entries: z.array(EntryOutputSchema).optional(),
        count: z.number().optional(),
        content: z.string().optional(),
        truncated: z
            .boolean()
            .optional()
            .describe('True if the results were truncated to fit within payload limits'),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Export Markdown Schemas
// ============================================================================

/** Strict schema — handler validation */
const ExportMarkdownSchema = z.object({
    output_dir: z.string().min(1),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    entry_types: z.array(z.enum(ENTRY_TYPES)).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(500).optional().default(100),
})

/** Relaxed schema — MCP registration */
const ExportMarkdownSchemaMcp = z.object({
    output_dir: z.string().describe('Target directory for .md files'),
    start_date: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
    entry_types: z.array(z.string()).optional().describe('Filter by entry types'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max entries to export (default: 100, max: 500)'),
})

const ExportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        exported_count: z.number().optional(),
        output_dir: z.string().optional(),
        files: z.array(z.string()).optional(),
        skipped: z.number().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Import Markdown Schemas
// ============================================================================

/** Strict schema — handler validation */
const ImportMarkdownSchema = z.object({
    source_dir: z.string().min(1),
    dry_run: z.boolean().optional().default(false),
    limit: z.number().max(500).optional().default(100),
})

/** Relaxed schema — MCP registration */
const ImportMarkdownSchemaMcp = z.object({
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

const ImportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        created: z.number().optional(),
        updated: z.number().optional(),
        skipped: z.number().optional(),
        relationshipsLinked: z.number().optional(),
        vectorsIndexed: z.number().optional(),
        errors: z
            .array(
                z.object({
                    file: z.string(),
                    error: z.string(),
                })
            )
            .optional(),
        dry_run: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Tool Definitions
// ============================================================================

export function getIoTools(context: ToolContext): ToolDefinition[] {
    const { db, progress } = context
    return [
        {
            name: 'export_entries',
            title: 'Export Entries',
            description: 'Export journal entries to JSON or Markdown format',
            group: 'io',
            inputSchema: ExportEntriesSchemaMcp,
            outputSchema: ExportEntriesOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    const input = ExportEntriesSchema.parse(params)
                    const limit = input.limit ?? 100

                    await sendProgress(progress, 0, 2, 'Fetching entries...')

                    // When entry_types filter is active, fetch a larger batch so
                    // post-filtering doesn't silently return empty results.
                    const hasTypeFilter = input.entry_types && input.entry_types.length > 0
                    const fetchLimit = hasTypeFilter ? 500 : limit

                    // Apply filters — use searchByDateRange when dates/tags/types present
                    let entries
                    if (input.start_date || input.end_date) {
                        const startDate = input.start_date ?? DATE_MIN_SENTINEL
                        const endDate = input.end_date ?? DATE_MAX_SENTINEL
                        entries = db.searchByDateRange(startDate, endDate, {
                            tags: input.tags,
                            limit: fetchLimit,
                        })
                    } else if ((input.tags && input.tags.length > 0) || hasTypeFilter) {
                        // Tags/types filter: use a wide date range to scan the full database
                        entries = db.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
                            tags: input.tags,
                            limit: fetchLimit,
                        })
                    } else {
                        entries = db.getRecentEntries(fetchLimit)
                    }

                    // Post-filter by entry_types, then cap to requested limit
                    if (hasTypeFilter) {
                        const allowedTypes = new Set(input.entry_types)
                        entries = entries
                            .filter((e) => allowedTypes.has(e.entryType))
                            .slice(0, limit)
                    }

                    // Enforce < 5MB payload ceiling (approximate based on content + overhead)
                    const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024
                    let currentBytes = 0
                    const boundedEntries: typeof entries = []
                    let truncated = false

                    for (const entry of entries) {
                        const entrySize = Buffer.byteLength(entry.content, 'utf8') + 500
                        if (currentBytes + entrySize > MAX_PAYLOAD_BYTES) {
                            truncated = true
                            logger.warning('Export payload exceeded 5MB cap, truncating results', {
                                module: 'IO',
                                limit,
                                actualCount: boundedEntries.length,
                            })
                            break
                        }
                        currentBytes += entrySize
                        boundedEntries.push(entry)
                    }

                    entries = boundedEntries

                    await sendProgress(
                        progress,
                        1,
                        2,
                        `Processing ${String(entries.length)} entries...`
                    )

                    if (input.format === 'markdown') {
                        const md = entries
                            .map(
                                (e) =>
                                    `## ${e.timestamp}\n\n**Type:** ${e.entryType}\n\n${e.content}\n\n---`
                            )
                            .join('\n\n')

                        await sendProgress(progress, 2, 2, 'Export complete')
                        return { format: 'markdown', content: md, count: entries.length, truncated }
                    }

                    await sendProgress(progress, 2, 2, 'Export complete')
                    return { format: 'json', entries, count: entries.length, truncated }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },

        // ==================================================================
        // export_markdown
        // ==================================================================
        {
            name: 'export_markdown',
            title: 'Export to Markdown Files',
            description:
                'Export journal entries as individual frontmattered Markdown files (.md). ' +
                'Each file contains YAML frontmatter (mj_id, entry_type, tags, relationships) ' +
                'and the entry content. Files can be edited externally and re-imported via import_markdown.',
            group: 'io',
            inputSchema: ExportMarkdownSchemaMcp,
            outputSchema: ExportMarkdownOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = ExportMarkdownSchema.parse(params)

                    // Determine allowed roots
                    // Security fix: Use explicitly configured roots, without CWD fallback
                    const allowedRoots = context.config?.allowedIoRoots ?? []

                    await sendProgress(progress, 0, 3, 'Fetching entries...')

                    const limit = input.limit ?? 100
                    let entries
                    if (input.start_date || input.end_date) {
                        const startDate = input.start_date ?? DATE_MIN_SENTINEL
                        const endDate = input.end_date ?? DATE_MAX_SENTINEL
                        entries = db.searchByDateRange(startDate, endDate, {
                            tags: input.tags,
                            limit,
                        })
                    } else if (input.tags && input.tags.length > 0) {
                        entries = db.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
                            tags: input.tags,
                            limit,
                        })
                    } else {
                        entries = db.getRecentEntries(limit)
                    }

                    // Post-filter by entry_types
                    if (input.entry_types && input.entry_types.length > 0) {
                        const allowedTypes = new Set(input.entry_types)
                        entries = entries
                            .filter((e) => allowedTypes.has(e.entryType))
                            .slice(0, limit)
                    }

                    await sendProgress(
                        progress,
                        1,
                        3,
                        `Exporting ${String(entries.length)} entries...`
                    )

                    // Map to ExportableEntry
                    const exportable: ExportableEntry[] = entries.map((e) => ({
                        id: e.id,
                        content: e.content,
                        entryType: e.entryType,
                        timestamp: e.timestamp,
                        tags: e.tags,
                        significance: e.significanceType ?? undefined,
                    }))

                    const result = await exportEntriesToMarkdown(
                        exportable,
                        input.output_dir,
                        db,
                        allowedRoots
                    )

                    await sendProgress(progress, 3, 3, 'Export complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },

        // ==================================================================
        // import_markdown
        // ==================================================================
        {
            name: 'import_markdown',
            title: 'Import from Markdown Files',
            description:
                'Import frontmattered Markdown files (.md) into the journal. ' +
                'If a file has an mj_id in its frontmatter and the entry exists, it is updated. ' +
                'Otherwise, a new entry is created. Tags and relationships are reconciled automatically. ' +
                'Use dry_run: true to preview what would happen without writing.',
            group: 'io',
            inputSchema: ImportMarkdownSchemaMcp,
            outputSchema: ImportMarkdownOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = ImportMarkdownSchema.parse(params)

                    // Determine allowed roots
                    // Security fix: Use explicitly configured roots, without CWD fallback
                    const allowedRoots = context.config?.allowedIoRoots ?? []

                    await sendProgress(progress, 0, 2, 'Reading markdown files...')

                    const result = await importMarkdownEntries(
                        input.source_dir,
                        db,
                        {
                            dry_run: input.dry_run,
                            limit: input.limit,
                        },
                        context.vectorManager,
                        allowedRoots
                    )

                    await sendProgress(progress, 2, 2, 'Import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
