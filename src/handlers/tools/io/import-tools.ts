import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { AggregateMcpError, ValidationError } from '../../../types/errors.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { importMarkdownEntries, processImportBatch, convertFile } from '../../../markdown/index.js'
import type { ParsedFile } from '../../../markdown/index.js'
import { wildcardWriteRejection, MAX_IMPORT_FILE_BYTES, resolveImportScope } from './io-shared.js'
import {
    ImportMarkdownSchema,
    ImportMarkdownSchemaMcp,
    ImportMarkdownOutputSchema,
    ImportExternalSchema,
    ImportExternalSchemaMcp,
    ImportExternalOutputSchema,
} from './schemas.js'

export function getIoImportTools(context: ToolContext): ToolDefinition[] {
    const { db, progress } = context
    return [
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
                    const rejectedImport = wildcardWriteRejection(input.workspace_id)
                    if (rejectedImport !== undefined) return rejectedImport
                    const { wsId, effectiveProjectNum } = resolveImportScope(input, context.config)
                    if (effectiveProjectNum !== undefined && effectiveProjectNum <= 0) {
                        throw new ValidationError('project_number must be a positive integer')
                    }

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
                            ...(wsId !== undefined ? { workspaceId: wsId } : {}),
                            ...(effectiveProjectNum !== undefined ? { project_number: effectiveProjectNum } : {}),
                            ...(context.config !== undefined ? { config: context.config } : {}),
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
                    const rejectedExternal = wildcardWriteRejection(input.workspace_id)
                    if (rejectedExternal !== undefined) return rejectedExternal
                    const { wsId, effectiveProjectNum } = resolveImportScope(input, context.config)

                    // Determine allowed roots
                    const allowedRoots = context.config?.allowedIoRoots ?? []

                    await sendProgress(progress, 0, 3, 'Reading files...')

                    const fs = await import('node:fs/promises')
                    const path = await import('node:path')
                    const { constants } = await import('node:fs')
                    const { assertSafeDirectoryPath, assertSafeFilePath } = await import('../../../utils/security-utils.js')

                    assertSafeDirectoryPath(input.source_dir, allowedRoots)

                    const allMdFiles: string[] = []
                    const dir = await fs.opendir(input.source_dir)
                    for await (const dirent of dir) {
                        if (dirent.isFile() && dirent.name.endsWith('.md')) {
                            allMdFiles.push(dirent.name)
                        }
                    }
                    allMdFiles.sort((a, b) => a.localeCompare(b))
                    const mdFiles = allMdFiles.slice(0, input.limit)

                    await sendProgress(progress, 1, 3, 'Converting external formats...')

                    const parsedFiles: ParsedFile[] = []
                    const errors: { file: string; error: string }[] = []
                    let emptySkipped = 0

                    for (const filename of mdFiles) {
                        let handle
                        try {
                            const filepath = path.join(input.source_dir, filename)
                            assertSafeFilePath(filepath, allowedRoots)

                            handle = await fs.open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW)
                            const stats = await handle.stat()
                            if (stats.size > MAX_IMPORT_FILE_BYTES) {
                                throw new Error(`File exceeds maximum size limit of ${String(MAX_IMPORT_FILE_BYTES / (1024 * 1024))}MB (${stats.size} bytes)`)
                            }

                            const content = await handle.readFile('utf-8')
                            const converted = convertFile(content, filename, input.source_format, input.default_entry_type)

                            if (!converted.body.trim()) {
                                emptySkipped++
                                continue
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

                    if (effectiveProjectNum !== undefined && effectiveProjectNum <= 0) {
                        throw new ValidationError('project_number must be a positive integer')
                    }

                    await sendProgress(progress, 2, 3, 'Importing entries...')

                    const result = await processImportBatch(parsedFiles, db, {
                        dry_run: input.dry_run,
                        ...(wsId !== undefined ? { workspaceId: wsId } : {}),
                        ...(effectiveProjectNum !== undefined ? { project_number: effectiveProjectNum } : {}),
                        ...(context.config !== undefined ? { config: context.config } : {}),
                    }, context.vectorManager)
                    result.skipped += emptySkipped

                    // Merge conversion phase errors
                    if (errors.length > 0) {
                        result.success = false
                        result.errors.push(...errors)
                    }

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

                    await sendProgress(progress, 3, 3, 'Import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
