import type { Command } from 'commander'
import { type z } from 'zod'
import type { JournalEntry } from '../../types/index.js'
import { 
    ioExportJsonOptionsSchema,
    ioExportMarkdownOptionsSchema,
    ioImportMarkdownOptionsSchema,
    ioImportExternalOptionsSchema 
} from '../schemas.js'
import { getCliCommandDb as getDb } from './db-helper.js'
import { exportEntriesToMarkdown, importMarkdownEntries, processImportBatch, convertFile, type ParsedFile } from '../../markdown/index.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import { resolveWorkspaceFromFilePath, resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { constants } from 'node:fs'

export const exportJsonSchema = ioExportJsonOptionsSchema
export const exportMarkdownSchema = ioExportMarkdownOptionsSchema
export const importMarkdownSchema = ioImportMarkdownOptionsSchema
export const importExternalSchema = ioImportExternalOptionsSchema

export async function exportJsonAction(options: z.infer<typeof exportJsonSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        const workspaceId = options.workspace ?? serverOptions.defaultWorkspaceId
        const PAGE_SIZE = 1000
        const entries: JournalEntry[] = []
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const page = db.getEntriesPage(offset, PAGE_SIZE, workspaceId).entries
            entries.push(...page)
            if (page.length < PAGE_SIZE) break
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const defaultName = `journal_export_${timestamp}.json`
        const destPath = options.dest
            ? path.resolve(options.dest)
            : path.resolve(path.dirname(serverOptions.dbPath), 'backups', defaultName)
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        const jsonPayload = JSON.stringify({ exportedAt: new Date().toISOString(), count: entries.length, entries }, null, 2)
        await fs.writeFile(destPath, jsonPayload, 'utf-8')
        const filename = path.basename(destPath)
        const sizeBytes = Buffer.byteLength(jsonPayload, 'utf-8')

        process.stdout.write(
            JSON.stringify({ filename, path: destPath, sizeBytes, count: entries.length, entries }, null, 2) + '\n'
        )
    } catch (e) {
        process.stderr.write("JSON export failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function exportMarkdownAction(options: z.infer<typeof exportMarkdownSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        if (!options.dir) {
            throw new Error('--dir is required for markdown export')
        }
        const workspaceId = options.workspace ?? serverOptions.defaultWorkspaceId
        // Page through all entries rather than truncating at an arbitrary limit
        const PAGE_SIZE = 1000
        const entries: JournalEntry[] = []
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const page = db.getEntriesPage(offset, PAGE_SIZE, workspaceId).entries
            entries.push(...page)
            if (page.length < PAGE_SIZE) break
        }
        
        const exportable = entries.map(e => ({
            id: e.id,
            content: e.content,
            entryType: e.entryType,
            timestamp: e.timestamp,
            tags: e.tags,
            significance: e.significanceType ?? undefined
        }))

        // We bypass allowedRoots check for CLI since it's run by a trusted human/agent directly
        const result = await exportEntriesToMarkdown(exportable, options.dir, db, [path.resolve(options.dir)])
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Export markdown failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function importMarkdownAction(options: z.infer<typeof importMarkdownSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        if (!options.dir) {
            throw new Error('--dir is required for markdown import')
        }

        const dirMatch = resolveWorkspaceFromFilePath(options.dir, serverOptions)
        const projectNumber =
            options.defaultProject ?? dirMatch?.projectNumber ?? serverOptions.defaultProjectNumber
        const workspaceId = resolveWorkspaceId(
            options.workspace ?? dirMatch?.workspaceId,
            projectNumber,
            serverOptions
        )

        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })

        const result = await importMarkdownEntries(
            options.dir,
            db,
            {
                limit: 100000,
                workspaceId,
                ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
            },
            vectorManager,
            [path.resolve(options.dir)]
        )
        
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Import markdown failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function importExternalAction(options: z.infer<typeof importExternalSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        if (!options.dir) {
            throw new Error('--dir is required for external import')
        }
        if (!options.format) {
            throw new Error('--format is required for external import')
        }

        const dirMatch = resolveWorkspaceFromFilePath(options.dir, serverOptions)
        const projectNumber =
            options.defaultProject ?? dirMatch?.projectNumber ?? serverOptions.defaultProjectNumber
        const workspaceId = resolveWorkspaceId(
            options.workspace ?? dirMatch?.workspaceId,
            projectNumber,
            serverOptions
        )

        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })

        const mdFiles: string[] = []
        const dir = await fs.opendir(options.dir)
        for await (const dirent of dir) {
            if (dirent.isFile() && dirent.name.endsWith('.md')) {
                mdFiles.push(dirent.name)
            }
        }

        const parsedFiles: ParsedFile[] = []
        const errors: { file: string; error: string }[] = []

        for (const filename of mdFiles) {
            let handle
            try {
                const filepath = path.join(options.dir, filename)
                handle = await fs.open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW)
                const content = await handle.readFile('utf-8')
                const converted = convertFile(content, filename, options.format)

                if (!converted.body.trim()) {
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

        const result = await processImportBatch(
            parsedFiles,
            db,
            {
                workspaceId,
                ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
            },
            vectorManager
        )
        
        if (errors.length > 0) {
            result.success = false
            result.errors.push(...errors)
        }

        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Import external failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
