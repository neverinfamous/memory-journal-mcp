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
import {
    assertSafeCliDir,
    assertSafeCliOutputFile,
    getCliCommandDb as getDb,
} from './db-helper.js'
import { writeCliResult } from './cli-output.js'
import { exportEntriesToMarkdown, importMarkdownEntries, processImportBatch } from '../../markdown/index.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
    resolveWorkspaceFromFilePath,
    resolveCliQueryScope,
} from '../../utils/workspace-resolver.js'
import {
    activeProjectRegistry,
    pairStoredScope,
    uniqueWorkspaceForProject,
} from '../../utils/write-scope.js'
import { collectExternalMarkdownFiles } from './io-external-helpers.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

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
    let exitCode = 0
    try {
        if (options.workspace?.trim() === '*') {
            throw new Error("Workspace '*' cannot be used for a single-file export.")
        }
        const { workspaceId, projectNumber } = resolveCliQueryScope(
            options.workspace,
            options.defaultProject,
            serverOptions
        )
        const entries = fetchAllWorkspaceEntries(db, workspaceId, projectNumber)

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const defaultName = `journal_export_${timestamp}.json`
        const rawDest =
            options.dest ?? path.resolve(path.dirname(serverOptions.dbPath), 'backups', defaultName)
        const destPath = await assertSafeCliOutputFile(rawDest, '--dest')
        const destDir = path.dirname(destPath)
        await fs.mkdir(destDir, { recursive: true })
        const jsonPayload = JSON.stringify({ exportedAt: new Date().toISOString(), count: entries.length, entries }, null, 2)
        await fs.writeFile(destPath, jsonPayload, 'utf-8')
        const filename = path.basename(destPath)
        const sizeBytes = Buffer.byteLength(jsonPayload, 'utf-8')

        writeCliResult(
            { filename, path: destPath, sizeBytes, count: entries.length },
            options.json,
            `Exported ${String(entries.length)} entries to ${destPath}.`
        )
    } catch (e) {
        process.stderr.write("JSON export failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}

export async function exportMarkdownAction(options: z.infer<typeof exportMarkdownSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let exitCode = 0
    try {
        const resolvedDir = await assertSafeCliDir(options.dir, 'markdown export')
        if (options.workspace?.trim() === '*') {
            throw new Error("Workspace '*' cannot be used for a single-directory export.")
        }
        const { workspaceId, projectNumber } = resolveCliQueryScope(
            options.workspace,
            options.defaultProject,
            serverOptions
        )
        const entries = fetchAllWorkspaceEntries(db, workspaceId, projectNumber)
        
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

        const result = await exportEntriesToMarkdown(exportable, resolvedDir, db, [resolvedDir])
        writeCliResult(result, options.json, 'Markdown export finished.')
        if (!result.success) {
            process.exitCode = 1
        }
    } catch (e) {
        process.stderr.write("Export markdown failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
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

function resolveNamedImportScope(
    namedWorkspace: string,
    defaultProject: number | undefined,
    dirMatch: ReturnType<typeof resolveWorkspaceFromFilePath>,
    serverOptions: ToolHandlerConfig,
    registry: ReturnType<typeof activeProjectRegistry>
): { workspaceId: string | undefined; projectNumber: number | undefined } {
    if (defaultProject !== undefined) {
        pairStoredScope(namedWorkspace, defaultProject, registry)
    }
    // [INVARIANT] A named workspace keeps its registry project. An explicit
    // defaultProject applies only when that workspace has none. A directory
    // from a different repo must not supply project_number.
    const resolved = resolveProjectContext(
        {
            workspace_id: namedWorkspace,
            ...(defaultProject !== undefined ? { project_number: defaultProject } : {}),
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

function resolveDefaultImportScope(
    configuredDefaultWs: string,
    defaultProject: number | undefined,
    serverOptions: ToolHandlerConfig,
    registry: ReturnType<typeof activeProjectRegistry>
): { workspaceId: string | undefined; projectNumber: number | undefined } {
    const effectiveProj =
        defaultProject ??
        (configuredDefaultWs.toLowerCase() === 'default'
            ? undefined
            : serverOptions.defaultProjectNumber)
    if (effectiveProj !== undefined) {
        pairStoredScope(configuredDefaultWs, effectiveProj, registry)
    }
    const resolved = resolveProjectContext(
        {
            workspace_id: configuredDefaultWs,
            ...(effectiveProj !== undefined ? { project_number: effectiveProj } : {}),
        },
        serverOptions
    )
    return {
        workspaceId: resolved.workspaceId,
        projectNumber: resolved.projectNumber ?? effectiveProj,
    }
}

export function resolveImportWriteScope(
    options: { dir?: string; workspace?: string; defaultProject?: number },
    serverOptions: ToolHandlerConfig
): { workspaceId: string | undefined; projectNumber: number | undefined } {
    if (options.dir === undefined || options.dir === '') {
        throw new Error('--dir is required')
    }
    if (options.workspace?.trim() === '*') {
        throw new Error("Workspace '*' cannot be used for import writes")
    }

    const dirMatch = resolveWorkspaceFromFilePath(options.dir, serverOptions)
    const namedWorkspace = concreteImportWorkspace(options.workspace)
    const registry = activeProjectRegistry(serverOptions.projectRegistry)
    if (namedWorkspace !== undefined) {
        return resolveNamedImportScope(
            namedWorkspace,
            options.defaultProject,
            dirMatch,
            serverOptions,
            registry
        )
    }

    const configuredDefaultWs = concreteImportWorkspace(serverOptions.defaultWorkspaceId)
    if (
        dirMatch === undefined &&
        options.defaultProject === undefined &&
        configuredDefaultWs === undefined
    ) {
        return { workspaceId: undefined, projectNumber: undefined }
    }

    if (dirMatch === undefined && configuredDefaultWs !== undefined) {
        return resolveDefaultImportScope(
            configuredDefaultWs,
            options.defaultProject,
            serverOptions,
            registry
        )
    }

    // [INVARIANT] The configured default project is a fallback only (via `serverOptions`), never
    // an explicit project paired against the directory's workspace (H4).
    const explicitProject = options.defaultProject ?? dirMatch?.projectNumber
    const projectOwner =
        options.defaultProject !== undefined && dirMatch === undefined
            ? uniqueWorkspaceForProject(options.defaultProject, registry)
            : undefined
    const resolved = resolveProjectContext(
        {
            ...(dirMatch?.workspaceId !== undefined
                ? { workspace_id: dirMatch.workspaceId }
                : projectOwner !== undefined
                  ? { workspace_id: projectOwner }
                  : {}),
            ...(explicitProject !== undefined ? { project_number: explicitProject } : {}),
        },
        serverOptions
    )
    return {
        workspaceId:
            dirMatch !== undefined || projectOwner !== undefined || options.defaultProject !== undefined
                ? resolved.workspaceId
                : undefined,
        projectNumber: explicitProject !== undefined ? (resolved.projectNumber ?? explicitProject) : undefined,
    }
}

export async function importMarkdownAction(options: z.infer<typeof importMarkdownSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let exitCode = 0
    try {
        const resolvedDir = await assertSafeCliDir(options.dir, 'markdown import')
        const { workspaceId, projectNumber } = resolveImportWriteScope(options, serverOptions)
        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })

        const result = await importMarkdownEntries(
            resolvedDir,
            db,
            {
                limit: 100000,
                ...(workspaceId !== undefined ? { workspaceId } : {}),
                ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
                config: serverOptions,
            },
            vectorManager,
            [resolvedDir]
        )

        writeCliResult(result, options.json, 'Markdown import finished.')
        if (!result.success) {
            process.exitCode = 1
        }
    } catch (e) {
        process.stderr.write("Import markdown failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}

export async function importExternalAction(options: z.infer<typeof importExternalSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let exitCode = 0
    try {
        if (!options.format) throw new Error('--format is required for external import')
        const resolvedDir = await assertSafeCliDir(options.dir, 'external import')
        const { workspaceId, projectNumber } = resolveImportWriteScope(options, serverOptions)
        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })
        const { parsedFiles, errors } = await collectExternalMarkdownFiles(
            resolvedDir,
            options.format,
            options.limit ?? 500
        )

        const result = await processImportBatch(
            parsedFiles,
            db,
            {
                ...(workspaceId !== undefined ? { workspaceId } : {}),
                ...(projectNumber !== undefined ? { project_number: projectNumber } : {}),
                config: serverOptions,
            },
            vectorManager
        )
        if (errors.length > 0) {
            result.success = false
            result.errors.push(...errors)
        }
        writeCliResult(result, options.json, 'External import finished.')
        if (!result.success) {
            process.exitCode = 1
        }
    } catch (e) {
        process.stderr.write("Import external failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}
