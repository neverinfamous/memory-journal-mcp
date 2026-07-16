import type { Command } from 'commander'
import { type z } from 'zod'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import type { ServerOptionsSchema } from '../schemas.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import { 
    ioExportJsonOptionsSchema,
    ioExportMarkdownOptionsSchema,
    ioImportMarkdownOptionsSchema,
    ioImportExternalOptionsSchema 
} from '../schemas.js'
import { exportEntriesToMarkdown, importMarkdownEntries, processImportBatch, convertFile, type ParsedFile } from '../../markdown/index.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { constants } from 'node:fs'

export const exportJsonSchema = ioExportJsonOptionsSchema
export const exportMarkdownSchema = ioExportMarkdownOptionsSchema
export const importMarkdownSchema = ioImportMarkdownOptionsSchema
export const importExternalSchema = ioImportExternalOptionsSchema

async function getDb(options: ServerOptionsSchema & { team?: boolean }, command: Command): Promise<{ db: IDatabaseAdapter, serverOptions: ServerOptions }> {
    let resolver: ConfigResolver
    const configPath = (options.config) ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions, teamDb } = buildServerOptions(resolver, options, command, configErrors)
    
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    const dbPath = options.team ? (teamDb ?? serverOptions.dbPath) : serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath, serverOptions)
    await db.initialize()
    return { db, serverOptions }
}

export async function exportJsonAction(options: z.infer<typeof exportJsonSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        const dest = options.dest
        const result = await db.exportToFile(dest)
        
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Export failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function exportMarkdownAction(options: z.infer<typeof exportMarkdownSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        if (!options.dir) {
            throw new Error('--dir is required for markdown export')
        }
        const entries = db.getRecentEntries(100000).entries // Large limit to get all
        
        const exportable = entries.map(e => ({
            id: e.id,
            content: e.content,
            entryType: e.entryType,
            timestamp: e.timestamp,
            tags: e.tags,
            significance: e.significanceType ?? undefined
        }))

        // We bypass allowedRoots check for CLI since it's run by a trusted human/agent directly
        const result = await exportEntriesToMarkdown(exportable, options.dir, db, [])
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

        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })

        const result = await importMarkdownEntries(options.dir, db, { limit: 100000 }, vectorManager, [])
        
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
                const converted = convertFile(content, filename, options.format, 'note')

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

        const result = await processImportBatch(parsedFiles, db, {}, vectorManager)
        
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
