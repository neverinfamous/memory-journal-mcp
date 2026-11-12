import type { Command } from 'commander'
import { type z } from 'zod'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry, ToolHandlerConfig } from '../../types/index.js'
import { 
    ioExportJsonOptionsSchema,
    ioExportMarkdownOptionsSchema,
    ioImportMarkdownOptionsSchema,
    ioImportExternalOptionsSchema 
} from '../schemas.js'
import { getCliCommandDb as getDb } from './db-helper.js'
import { exportEntriesToMarkdown, importMarkdownEntries, processImportBatch, convertFile, type ParsedFile } from '../../markdown/index.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
    resolveWorkspaceFromFilePath,
    resolveWorkspaceId,
} from '../../utils/workspace-resolver.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { constants } from 'node:fs'

export const exportJsonSchema = ioExportJsonOptionsSchema
export const exportMarkdownSchema = ioExportMarkdownOptionsSchema
export const importMarkdownSchema = ioImportMarkdownOptionsSchema
export const importExternalSchema = ioImportExternalOptionsSchema

function fetchAllWorkspaceEntries(
    db: IDatabaseAdapter,
    workspaceId: string | undefined,
    projectNumber?: number
): JournalEntry[] {
    const PAGE_SIZE = 1000
    const entries: JournalEntry[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = db.getEntriesPage(offset, PAGE_SIZE, workspaceId, projectNumber).entries
        entries.push(...page)
        if (page.length < PAGE_SIZE) break
    }
    return entries
}

export async function exportJsonAction(options: z.infer<typeof exportJsonSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        if (options.workspace?.trim() === '*') {
            throw new Error("Workspace '*' cannot be used for a single-file export.")
        }
        const requestedProject = options.defaultProject
        const workspaceId = resolveWorkspaceId(
            options.workspace,
            requestedProject ?? serverOptions.defaultProjectNumber,
            serverOptions
        )
        const entries = fetchAllWorkspaceEntries(db, workspaceId, requestedProject)

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
        if (options.workspace?.trim() === '*') {
            throw new Error("Workspace '*' cannot be used for a single-directory export.")
        }
        const requestedProject = options.defaultProject
        const workspaceId = resolveWorkspaceId(
            options.workspace,
            requestedProject ?? serverOptions.defaultProjectNumber,
            serverOptions
        )
        const entries = fetchAllWorkspaceEntries(db, workspaceId, requestedProject)
        
        const exportable = entries.map(e => ({
            id: e.id,
            content: e.content,
            entryType: e.entryType,
            timestamp: e.timestamp,
            tags: e.tags,
            ...(e.significanceType !== null ? { significance: e.significanceType } : {}),
            ...(e.workspaceId !== undefined ? { workspaceId: e.workspaceId } : {}),
            ...(e.projectNumber !== undefined && e.projectNumber !== null ? { projectNumber: e.projectNumber } : {}),
        }))

        // We bypass allowedRoots check for CLI since it's run by a trusted human/agent directly
        const result = await exportEntriesToMarkdown(exportable, options.dir, db, [path.resolve(options.dir)])
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        if (!result.success) {
            process.exitCode = 1
        }
    } catch (e) {
        process.stderr.write("Export markdown failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

function concreteImportWorkspace(workspace: string | undefined): string | undefined {
    if (workspace === undefined) return undefined
    const trimmed = workspace.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

function workspacesReferToSameProject(
    left: string,
    right: string,
    registry: ToolHandlerConfig['projectRegistry']
): boolean {
    const leftKey = findCanonicalRegistryKey(left, registry) ?? left
    const rightKey = findCanonicalRegistryKey(right, registry) ?? right
    return leftKey.toLowerCase() === rightKey.toLowerCase()
}

function resolveImportWriteScope(
    options: { dir?: string; workspace?: string; defaultProject?: number },
    serverOptions: ToolHandlerConfig
): { workspaceId: string; projectNumber: number | undefined } {
    if (options.dir === undefined || options.dir === '') {
        throw new Error('--dir is required')
    }
    if (options.workspace?.trim() === '*') {
        throw new Error("Workspace '*' cannot be used for import writes")
    }

    const dirMatch = resolveWorkspaceFromFilePath(options.dir, serverOptions)
    const namedWorkspace = concreteImportWorkspace(options.workspace)
    if (namedWorkspace !== undefined) {
        // [INVARIANT] A named workspace keeps its registry project. An explicit
        // defaultProject applies only when that workspace has none. A directory
        // from a different repo must not supply project_number.
        const resolved = resolveProjectContext(
            {
                workspace_id: namedWorkspace,
                ...(options.defaultProject !== undefined
                    ? { project_number: options.defaultProject }
                    : {}),
            },
            serverOptions
        )
        const sameDirectory =
            dirMatch?.workspaceId !== undefined &&
            workspacesReferToSameProject(
                namedWorkspace,
                dirMatch.workspaceId,
                serverOptions.projectRegistry
            )
        const projectNumber =
            resolved.projectNumber ?? (sameDirectory ? dirMatch?.projectNumber : undefined)
        return { workspaceId: resolved.workspaceId, projectNumber }
    }

    const resolved = resolveProjectContext(
        {
            workspace_id: dirMatch?.workspaceId,
            project_number:
                options.defaultProject ??
                dirMatch?.projectNumber ??
                serverOptions.defaultProjectNumber,
        },
        serverOptions
    )
    return { workspaceId: resolved.workspaceId, projectNumber: resolved.projectNumber }
}

export async function importMarkdownAction(options: z.infer<typeof importMarkdownSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        if (!options.dir) {
            throw new Error('--dir is required for markdown import')
        }

        const { workspaceId, projectNumber } = resolveImportWriteScope(options, serverOptions)

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
        if (!result.success) {
            process.exitCode = 1
        }
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

        const { workspaceId, projectNumber } = resolveImportWriteScope(options, serverOptions)

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
        if (!result.success) {
            process.exitCode = 1
        }
    } catch (e) {
        process.stderr.write("Import external failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
