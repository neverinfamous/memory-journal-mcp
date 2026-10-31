import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { AggregateMcpError } from '../../../types/errors.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { logger } from '../../../utils/logger.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'

import { exportEntriesToMarkdown } from '../../../markdown/index.js'
import { importMarkdownEntries, processImportBatch, convertFile } from '../../../markdown/index.js'
import type { ExportableEntry, ParsedFile } from '../../../markdown/index.js'
import { DATE_MIN_SENTINEL, DATE_MAX_SENTINEL } from '../schemas.js'

import {
    ExportEntriesSchema,
    ExportEntriesSchemaMcp,
    ExportEntriesOutputSchema,
    ExportMarkdownSchema,
    ExportMarkdownSchemaMcp,
    ExportMarkdownOutputSchema,
    ImportMarkdownSchema,
    ImportMarkdownSchemaMcp,
    ImportMarkdownOutputSchema,
    ImportExternalSchema,
    ImportExternalSchemaMcp,
    ImportExternalOutputSchema,
} from './schemas.js'

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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = ExportEntriesSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, undefined, context.config)
                    const limit = input.limit ?? 100

                    await sendProgress(progress, 0, 2, 'Fetching entries...')

                    // When entry_types filter is active, fetch a larger batch so
                    // post-filtering doesn't silently return empty results.
                    const hasTypeFilter = input.entry_types && input.entry_types.length > 0
                    const fetchLimit = hasTypeFilter ? Math.max(500, limit * 2) : limit

                    // Apply filters — use searchByDateRange when dates/tags/types present
                    let entries
                    if (input.start_date || input.end_date) {
                        const startDate = input.start_date ?? DATE_MIN_SENTINEL
                        const endDate = input.end_date ?? DATE_MAX_SENTINEL
                        entries = db.searchByDateRange(startDate, endDate, {
                            tags: input.tags,
                            limit: fetchLimit,
                            workspaceId: wsId,
                        }).entries
                    } else if ((input.tags && input.tags.length > 0) || hasTypeFilter) {
                        // Tags/types filter: use a wide date range to scan the full database
                        entries = db.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
                            tags: input.tags,
                            limit: fetchLimit,
                            workspaceId: wsId,
                        }).entries
                    } else {
                        entries = db.getRecentEntries(fetchLimit, undefined, undefined, undefined, undefined, wsId).entries
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
                    const wsId = resolveWorkspaceId(input.workspace_id, undefined, context.config)

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
                            workspaceId: wsId,
                        }).entries
                    } else if (input.tags && input.tags.length > 0) {
                        entries = db.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
                            tags: input.tags,
                            limit,
                            workspaceId: wsId,
                        }).entries
                    } else {
                        entries = db.getRecentEntries(limit, undefined, undefined, undefined, undefined, wsId).entries
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

                    await sendProgress(progress, 2, 3, 'Writing markdown files...')

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
                    const wsId = resolveWorkspaceId(input.workspace_id, undefined, context.config)

                    // Determine allowed roots
                    // Security fix: Use explicitly configured roots, without CWD fallback
                    const allowedRoots = context.config?.allowedIoRoots ?? []

                    await sendProgress(progress, 0, 2, 'Reading markdown files...')

                    await sendProgress(progress, 1, 2, 'Importing entries...')

                    const result = await importMarkdownEntries(
                        input.source_dir,
                        db,
                        {
                            dry_run: input.dry_run,
                            limit: input.limit,
                            workspaceId: wsId,
                        },
                        context.vectorManager,
                        allowedRoots
                    )

                    if (!result.success && result.errors.length > 0) {
                        const successCount = result.created + result.updated + result.skipped
                        const total = successCount + result.errors.length
                        const message = `Importing ${total} entries: ${successCount} succeeded, ${result.errors.length} failed.`
                        
                        throw new AggregateMcpError(
                            message,
                            result.errors.map(e => ({ message: e.error, file: e.file })),
                            { result }
                        )
                    }

                    await sendProgress(progress, 2, 2, 'Import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },

        // ==================================================================
        // import_external
        // ==================================================================
        {
            name: 'import_external',
            title: 'Import from External Tools',
            description:
                'Import knowledge management exports (Notion, Obsidian, Logseq) into the journal. ' +
                'Normalizes wikilinks, YAML frontmatter, and block hierarchies automatically. ' +
                'Use dry_run: true to preview what would happen without writing.',
            group: 'io',
            inputSchema: ImportExternalSchemaMcp,
            outputSchema: ImportExternalOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    const input = ImportExternalSchema.parse(params)
                    const wsId = resolveWorkspaceId(input.workspace_id, undefined, context.config)

                    // Determine allowed roots
                    const allowedRoots = context.config?.allowedIoRoots ?? []

                    await sendProgress(progress, 0, 3, 'Reading files...')

                    const fs = await import('node:fs/promises')
                    const path = await import('node:path')
                    const { constants } = await import('node:fs')
                    const { assertSafeDirectoryPath, assertSafeFilePath } = await import('../../../utils/security-utils.js')

                    assertSafeDirectoryPath(input.source_dir, allowedRoots)

                    const mdFiles: string[] = []
                    const dir = await fs.opendir(input.source_dir)
                    for await (const dirent of dir) {
                        if (dirent.isFile() && dirent.name.endsWith('.md')) {
                            mdFiles.push(dirent.name)
                            if (mdFiles.length >= input.limit) break
                        }
                    }

                    await sendProgress(progress, 1, 3, 'Converting external formats...')

                    const parsedFiles: ParsedFile[] = []
                    const errors: { file: string; error: string }[] = []

                    for (const filename of mdFiles) {
                        let handle
                        try {
                            const filepath = path.join(input.source_dir, filename)
                            assertSafeFilePath(filepath, allowedRoots)

                            handle = await fs.open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW)
                            const stats = await handle.stat()
                            if (stats.size > 5 * 1024 * 1024) {
                                throw new Error(`File exceeds maximum size limit of 5MB (${stats.size} bytes)`)
                            }

                            const content = await handle.readFile('utf-8')
                            const converted = convertFile(content, filename, input.source_format, input.default_entry_type)

                            if (!converted.body.trim()) {
                                continue // skipped
                            }

                            parsedFiles.push({
                                filename,
                                body: converted.body,
                                metadata: converted.metadata,
                            })
                        } catch (err) {
                            errors.push({
                                file: filename,
                                error: err instanceof Error ? err.message : String(err),
                            })
                        } finally {
                            if (handle) {
                                await handle.close()
                            }
                        }
                    }

                    await sendProgress(progress, 2, 3, 'Importing entries...')

                    const result = await processImportBatch(parsedFiles, db, {
                        dry_run: input.dry_run,
                        workspaceId: wsId,
                    }, context.vectorManager)

                    // Merge conversion phase errors
                    if (errors.length > 0) {
                        result.success = false
                        result.errors.push(...errors)
                    }

                    if (!result.success && result.errors.length > 0) {
                        const successCount = result.created + result.updated + result.skipped
                        const total = successCount + result.errors.length
                        const message = `Importing ${total} entries: ${successCount} succeeded, ${result.errors.length} failed.`
                        const { AggregateMcpError } = await import('../../../types/errors.js')
                        throw new AggregateMcpError(
                            message,
                            result.errors.map(e => ({ message: e.error, file: e.file })),
                            { result }
                        )
                    }

                    await sendProgress(progress, 3, 3, 'Import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
