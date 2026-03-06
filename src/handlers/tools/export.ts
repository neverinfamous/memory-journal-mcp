/**
 * Export Tool Group - 1 tool
 *
 * Tools: export_entries
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
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
    limit: z
        .number()
        .max(500)
        .optional()
        .default(100)
        .describe('Maximum entries to export (default: 100)'),
})

// ============================================================================
// Output Schemas
// ============================================================================

const ExportEntriesOutputSchema = z.object({
    format: z.enum(['json', 'markdown']).optional(),
    entries: z.array(EntryOutputSchema).optional(),
    content: z.string().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
})

// ============================================================================
// Tool Definitions
// ============================================================================

export function getExportTools(context: ToolContext): ToolDefinition[] {
    const { db, progress } = context
    return [
        {
            name: 'export_entries',
            title: 'Export Entries',
            description: 'Export journal entries to JSON or Markdown format',
            group: 'export',
            inputSchema: ExportEntriesSchemaMcp,
            outputSchema: ExportEntriesOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = ExportEntriesSchema.parse(params)
                    const limit = input.limit ?? 100

                    await sendProgress(progress, 0, 2, 'Fetching entries...')

                    const entries = db.getRecentEntries(limit)

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
                        return { format: 'markdown', content: md }
                    }

                    await sendProgress(progress, 2, 2, 'Export complete')
                    return { format: 'json', entries }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
