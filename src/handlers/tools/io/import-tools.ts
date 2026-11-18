import type * as FsPromises from 'node:fs/promises'
import type * as PathModule from 'node:path'
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

type ExternalFileOutcome =
    | { filename: string; skipped: true }
    | { filename: string; error: string }
    | { filename: string; parsed: ParsedFile }

async function readSingleExternalFile(
    fs: typeof FsPromises,
    path: typeof PathModule,
    openFlags: number,
    assertSafeFilePath: (filepath: string, allowedRoots: string[]) => void,
    input: ReturnType<typeof ImportExternalSchema.parse>,
    allowedRoots: string[],
    filename: string
): Promise<ExternalFileOutcome> {
    let handle
    try {
        const filepath = path.join(input.source_dir, filename)
        assertSafeFilePath(filepath, allowedRoots)
        handle = await fs.open(filepath, openFlags)
        const stats = await handle.stat()
        if (stats.size > MAX_IMPORT_FILE_BYTES) {
            throw new Error(
                `File exceeds maximum size limit of ${String(MAX_IMPORT_FILE_BYTES / (1024 * 1024))}MB (${stats.size} bytes)`
            )
        }
        const content = await handle.readFile('utf-8')
        const converted = convertFile(content, filename, input.source_format, input.default_entry_type)
        if (!converted.body.trim()) return { filename, skipped: true }
        return { filename, parsed: { filename, body: converted.body, metadata: converted.metadata } }
    } catch (err) {
        return { filename, error: err instanceof Error ? err.message : String(err) }
    } finally {
        if (handle) await handle.close()
    }
}

async function readAndConvertExternalFiles(
    input: ReturnType<typeof ImportExternalSchema.parse>,
    allowedRoots: string[]
): Promise<{
    parsedFiles: ParsedFile[]
    errors: { file: string; error: string }[]
    emptySkipped: number
}> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const { constants } = await import('node:fs')
    const { assertSafeDirectoryPath, assertSafeFilePath } = await import(
        '../../../utils/security-utils.js'
    )

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

    const parsedFiles: ParsedFile[] = []
    const errors: { file: string; error: string }[] = []
    let emptySkipped = 0
    const READ_CONCURRENCY = 16
    const openFlags = constants.O_RDONLY | constants.O_NOFOLLOW

    for (let i = 0; i < mdFiles.length; i += READ_CONCURRENCY) {
        const chunk = mdFiles.slice(i, i + READ_CONCURRENCY)
        const outcomes = await Promise.all(
            chunk.map((filename) =>
                readSingleExternalFile(
                    fs,
                    path,
                    openFlags,
                    assertSafeFilePath,
                    input,
                    allowedRoots,
                    filename
                )
            )
        )
        for (const item of outcomes) {
            if ('error' in item) errors.push({ file: item.filename, error: item.error })
            else if ('skipped' in item) emptySkipped++
            else parsedFiles.push(item.parsed)
        }
    }
    return { parsedFiles, errors, emptySkipped }
}

async function executeImportExternal(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, progress } = context
    const input = ImportExternalSchema.parse(params)
    const rejectedExternal = wildcardWriteRejection(input.workspace_id)
    if (rejectedExternal !== undefined) return rejectedExternal
    const { wsId, effectiveProjectNum } = resolveImportScope(input, context.config)
    const allowedRoots = context.config?.allowedIoRoots ?? []

    await sendProgress(progress, 0, 3, 'Reading files...')
    await sendProgress(progress, 1, 3, 'Converting external formats...')
    const { parsedFiles, errors, emptySkipped } = await readAndConvertExternalFiles(input, allowedRoots)
    if (effectiveProjectNum !== undefined && effectiveProjectNum <= 0) {
        throw new ValidationError('project_number must be a positive integer')
    }

    await sendProgress(progress, 2, 3, 'Importing entries...')
    const result = await processImportBatch(
        parsedFiles,
        db,
        {
            dry_run: input.dry_run,
            ...(wsId !== undefined ? { workspaceId: wsId } : {}),
            ...(effectiveProjectNum !== undefined ? { project_number: effectiveProjectNum } : {}),
            ...(context.config !== undefined ? { config: context.config } : {}),
        },
        context.vectorManager
    )
    result.skipped += emptySkipped

    if (errors.length > 0) {
        result.success = false
        result.errors.push(...errors)
    }
    if (!result.success && result.errors.length > 0) {
        const successCount = result.created + result.updated + result.skipped
        const total = successCount + result.errors.length
        throw new AggregateMcpError(
            `Importing ${total} entries: ${successCount} succeeded, ${result.errors.length} failed.`,
            result.errors.map((e) => ({ message: e.error, file: e.file })),
            { result }
        )
    }
    await sendProgress(progress, 3, 3, 'Import complete')
    return result as unknown as Record<string, unknown>
}

export function getIoImportTools(context: ToolContext): ToolDefinition[] {
    const { db } = context
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

                    await sendProgress(context.progress, 0, 2, 'Reading markdown files...')

                    await sendProgress(context.progress, 1, 2, 'Importing entries...')

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

                    await sendProgress(context.progress, 2, 2, 'Import complete')
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
                    return await executeImportExternal(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
