import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { AggregateMcpError, ValidationError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { logger } from '../../../utils/logger.js'
import { assertSafeDirectoryPath } from '../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { exportEntriesToMarkdown } from '../../../markdown/index.js'
import type { ExportableEntry } from '../../../markdown/index.js'
import { DATE_MIN_SENTINEL, DATE_MAX_SENTINEL } from '../schemas.js'
import { wildcardWriteRejection } from './io-shared.js'
import { getIoImportTools } from './import-tools.js'
import {
    ExportEntriesSchema,
    ExportEntriesSchemaMcp,
    ExportEntriesOutputSchema,
    ExportMarkdownSchema,
    ExportMarkdownSchemaMcp,
    ExportMarkdownOutputSchema,
} from './schemas.js'

export { MAX_IMPORT_FILE_BYTES } from './io-shared.js'

interface ExportQueryArgs {
    limit?: number | undefined
    start_date?: string | undefined
    end_date?: string | undefined
    tags?: string[] | undefined
    entry_types?: string[] | undefined
}

function fetchEntriesForExport(
    db: ToolContext['db'],
    input: ExportQueryArgs,
    wsId: string,
    projectNumber: number | undefined
): ReturnType<ToolContext['db']['searchByDateRange']>['entries'] {
    const limit = input.limit ?? 100
    // When entry_types filter is active, over-fetch so post-filtering doesn't silently return too few results.
    const hasTypeFilter = input.entry_types !== undefined && input.entry_types.length > 0
    const fetchLimit = hasTypeFilter ? Math.max(500, limit * 2) : limit
    let entries

    if (input.start_date || input.end_date) {
        if (
            input.start_date !== undefined &&
            input.end_date !== undefined &&
            input.start_date > input.end_date
        ) {
            throw new ValidationError('start_date cannot be after end_date')
        }
        entries = db.searchByDateRange(
            input.start_date ?? DATE_MIN_SENTINEL,
            input.end_date ?? DATE_MAX_SENTINEL,
            {
                tags: input.tags,
                limit: fetchLimit,
                workspaceId: wsId,
                ...(projectNumber !== undefined ? { projectNumber } : {}),
            }
        ).entries
    } else if ((input.tags && input.tags.length > 0) || hasTypeFilter) {
        entries = db.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
            tags: input.tags,
            limit: fetchLimit,
            workspaceId: wsId,
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        }).entries
    } else {
        entries = (projectNumber !== undefined
            ? db.getRecentEntries(fetchLimit, undefined, undefined, undefined, undefined, wsId, projectNumber)
            : db.getRecentEntries(fetchLimit, undefined, undefined, undefined, undefined, wsId)
        ).entries
    }

    if (hasTypeFilter) {
        const allowedTypes = new Set(input.entry_types)
        return entries.filter((e) => allowedTypes.has(e.entryType)).slice(0, limit)
    }
    return entries
}

function boundExportPayloadSize<T extends { content: string }>(
    entries: T[],
    limit: number
): { boundedEntries: T[]; truncated: boolean } {
    const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024
    let currentBytes = 0
    const boundedEntries: T[] = []
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
    return { boundedEntries, truncated }
}

async function executeExportEntries(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, progress } = context
    const input = ExportEntriesSchema.parse(params)
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const projectNumber = alignedProjectFilter(
        wsId,
        input.project_number,
        activeProjectRegistry(context.config?.projectRegistry)
    )
    await sendProgress(progress, 0, 2, 'Fetching entries...')
    const rawEntries = fetchEntriesForExport(db, input, wsId, projectNumber)
    const { boundedEntries: entries, truncated } = boundExportPayloadSize(
        rawEntries,
        input.limit ?? 100
    )
    await sendProgress(progress, 1, 2, `Processing ${String(entries.length)} entries...`)

    if (input.format === 'markdown') {
        const md = entries
            .map((e) => `## ${e.timestamp}\n\n**Type:** ${e.entryType}\n\n${e.content}\n\n---`)
            .join('\n\n')
        await sendProgress(progress, 2, 2, 'Export complete')
        return { format: 'markdown', content: md, count: entries.length, truncated }
    }
    await sendProgress(progress, 2, 2, 'Export complete')
    return { format: 'json', entries, count: entries.length, truncated }
}

async function executeExportMarkdown(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, progress } = context
    const input = ExportMarkdownSchema.parse(params)
    const rejectedExport = wildcardWriteRejection(input.workspace_id)
    if (rejectedExport !== undefined) return rejectedExport
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const projectNumber = alignedProjectFilter(
        wsId,
        input.project_number,
        activeProjectRegistry(context.config?.projectRegistry)
    )
    const allowedRoots = context.config?.allowedIoRoots ?? []
    assertSafeDirectoryPath(input.output_dir, allowedRoots)

    await sendProgress(progress, 0, 3, 'Fetching entries...')
    const entries = fetchEntriesForExport(db, input, wsId, projectNumber)
    await sendProgress(progress, 1, 3, `Exporting ${String(entries.length)} entries...`)

    const exportable: ExportableEntry[] = entries.map((e) => ({
        id: e.id,
        content: e.content,
        entryType: e.entryType,
        timestamp: e.timestamp,
        tags: e.tags,
        significance: e.significanceType ?? undefined,
        ...(e.workspaceId !== undefined ? { workspaceId: e.workspaceId } : {}),
        ...(e.projectNumber !== undefined && e.projectNumber !== null
            ? { projectNumber: e.projectNumber }
            : {}),
    }))

    await sendProgress(progress, 2, 3, 'Writing markdown files...')
    const result = await exportEntriesToMarkdown(exportable, input.output_dir, db, allowedRoots)
    if (!result.success && result.errors !== undefined && result.errors.length > 0) {
        const total = result.exported_count + result.errors.length
        throw new AggregateMcpError(
            `Exporting ${String(total)} entries: ${String(result.exported_count)} succeeded, ${String(result.errors.length)} failed.`,
            result.errors.map((e) => ({ message: e.error, file: e.file })),
            { result }
        )
    }
    await sendProgress(progress, 3, 3, 'Export complete')
    const out: Record<string, unknown> = {}
    return Object.assign(out, result)
}

export function getIoTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'export_entries',
            title: 'Export Entries',
            description: 'Export journal entries to JSON or Markdown format',
            group: 'io',
            inputSchema: ExportEntriesSchemaMcp,
            outputSchema: ExportEntriesOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    return await executeExportEntries(params, context)
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
                'Each file contains JSON frontmatter (mj_id, entry_type, tags, relationships) ' +
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
                    return await executeExportMarkdown(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        ...getIoImportTools(context),
    ]
}
