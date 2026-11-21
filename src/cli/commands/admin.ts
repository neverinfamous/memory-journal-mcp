import { runAutoPrune } from '../../server/auto-prune.js'
import type { Command } from 'commander'
import { type z } from 'zod'

import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'
import { enforceCliTeamRbac, getCliCommandDb as getDb } from './db-helper.js'
import { resolveAutoPruneScope } from '../../utils/workspace-resolver.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { 
    adminBackupOptionsSchema, 
    adminRestoreOptionsSchema, 
    adminVacuumOptionsSchema, 
    adminPruneOptionsSchema,
    adminAuditSearchOptionsSchema,
    adminRebuildIndexOptionsSchema
} from '../schemas.js'

import { AuditLogger } from '../../audit/audit-logger.js'
import type { AuditEntry } from '../../audit/types.js'
import { DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES } from '../../audit/types.js'
import { formatCliError, writeCliResult } from './cli-output.js'

export const backupSchema = adminBackupOptionsSchema
export const restoreSchema = adminRestoreOptionsSchema
export const vacuumSchema = adminVacuumOptionsSchema
export const pruneSchema = adminPruneOptionsSchema
export const auditSchema = adminAuditSearchOptionsSchema
export const rebuildIndexSchema = adminRebuildIndexOptionsSchema

export async function backupAction(options: z.infer<typeof backupSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    const trimmedDest = options.dest?.trim()
    const dest = trimmedDest !== undefined && trimmedDest !== '' ? trimmedDest : undefined
    let exitCode = 0
    try {
        const result = await db.exportToFile(dest)
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stderr.write(`Backup successful: ${result.path} (${result.sizeBytes} bytes)\n`)
        }
    } catch (e) {
        process.stderr.write(`Backup failed: ${formatCliError(e)}\n`)
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}

export async function restoreAction(file: string, options: z.infer<typeof restoreSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    let exitCode = 0
    try {
        const result = await db.restoreFromFile(file)
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stderr.write(`Restore successful from ${result.restoredFrom}. Previous entries: ${result.previousEntryCount}, New entries: ${result.newEntryCount}\n`)
        }
    } catch (e) {
        process.stderr.write(`Restore failed: ${formatCliError(e)}\n`)
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}

export async function vacuumAction(options: z.infer<typeof vacuumSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    let exitCode = 0
    try {
        db.pragma('optimize')
        db.flushSave()
        if (options.json === true) {
            process.stdout.write(JSON.stringify({ status: 'success', action: 'vacuum' }) + '\n')
        } else {
            process.stderr.write("Vacuum and optimize successful.\n")
        }
    } catch (e) {
        process.stderr.write(`Vacuum failed: ${formatCliError(e)}\n`)
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}

type CliAdminServerOptions = Awaited<ReturnType<typeof getDb>>['serverOptions']

function resolveCliPruneScope(
    options: z.infer<typeof pruneSchema>,
    serverOptions: CliAdminServerOptions
): { workspaceId: string; projectNumber?: number } {
    const requestedWs = options.workspace?.trim()
    const requestedProject = options.defaultProject
    if (requestedWs === '*') {
        if (options.allWorkspaces !== true) {
            throw new Error(
                "Refusing wildcard '--workspace *' in prune without explicit confirmation. Pass --all-workspaces alongside --workspace '*' to prune all workspaces."
            )
        }
        return {
            workspaceId: '*',
            ...(requestedProject !== undefined ? { projectNumber: requestedProject } : {}),
        }
    }
    const targetWs =
        requestedWs !== undefined && requestedWs !== ''
            ? requestedWs
            : requestedProject === undefined
              ? serverOptions.defaultWorkspaceId
              : undefined
    const targetProj =
        requestedProject ?? (requestedWs === undefined ? serverOptions.defaultProjectNumber : undefined)
    return resolveAutoPruneScope(targetWs, targetProj, serverOptions.projectRegistry)
}

function buildCliPruneConfig(
    options: z.infer<typeof pruneSchema>,
    serverOptions: CliAdminServerOptions,
    command: Command,
    parsedExcludeTags: string[],
    pruneScope: { workspaceId: string; projectNumber?: number }
): Parameters<typeof runAutoPrune>[1] {
    const fromCli = (key: string): boolean => command.getOptionValueSource(key) === 'cli'
    return {
        archiveOlderThanDays:
            (fromCli('archiveOlderThanDays') ? options.archiveOlderThanDays : undefined) ??
            serverOptions.archiveOlderThanDays ??
            0,
        pruneOlderThanDays:
            (fromCli('pruneOlderThanDays') ? options.pruneOlderThanDays : undefined) ??
            serverOptions.pruneOlderThanDays ??
            0,
        hardDeleteOlderThanDays:
            (fromCli('hardDeleteOlderThanDays') ? options.hardDeleteOlderThanDays : undefined) ??
            serverOptions.hardDeleteOlderThanDays ??
            0,
        importanceThreshold:
            options.importanceThreshold ??
            (fromCli('pruneImportanceThreshold') ? options.pruneImportanceThreshold : undefined) ??
            serverOptions.pruneImportanceThreshold ??
            0.15,
        dryRun:
            options.dryRun === true ||
            (fromCli('pruneDryRun') && options.pruneDryRun === true) ||
            serverOptions.pruneDryRun === true,
        excludeTags: parsedExcludeTags,
        workspaceId: pruneScope.workspaceId,
        ...(pruneScope.projectNumber !== undefined
            ? { projectNumber: pruneScope.projectNumber }
            : {}),
    }
}

function printCliPruneResult(
    result: Awaited<ReturnType<typeof runAutoPrune>>,
    jsonOutput: boolean | undefined
): void {
    if (jsonOutput === true) {
        process.stdout.write(JSON.stringify(result) + '\n')
        return
    }
    process.stderr.write(`Prune result:\n`)
    process.stderr.write(`  Archived:     ${result.archivedCount}\n`)
    process.stderr.write(`  Soft Deleted: ${result.prunedCount}\n`)
    process.stderr.write(`  Hard Deleted: ${result.hardDeletedCount}\n`)
    if (result.backupFile) {
        process.stderr.write(`  Safety backup created: ${result.backupFile}\n`)
    }
    if (result.aborted === true) {
        process.stderr.write('  Safety backup failed. No rows were changed.\n')
    }
}

export async function pruneAction(options: z.infer<typeof pruneSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let exitCode = 0

    try {
        const rawExcludeTags = options.excludeTags ?? options.pruneExcludeTags
        const parsedExcludeTags = rawExcludeTags
            ? rawExcludeTags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter((tag) => tag !== '')
            : (serverOptions.pruneExcludeTags ?? [])
        const pruneScope = resolveCliPruneScope(options, serverOptions)
        const result = await runAutoPrune(
            db,
            buildCliPruneConfig(options, serverOptions, command, parsedExcludeTags, pruneScope)
        )
        printCliPruneResult(result, options.json)
        if (result.aborted === true) {
            exitCode = 1
        }
    } catch (e) {
        process.stderr.write(`Prune failed: ${formatCliError(e)}\n`)
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}

function createCliAuditLogger(
    options: z.infer<typeof auditSchema>,
    command: Command,
    serverOptions: ReturnType<typeof buildServerOptions>['serverOptions'],
    configPath: string | undefined
): AuditLogger {
    const auditDefaults = serverOptions.auditConfig
    const allowConfigLogPath =
        configPath !== undefined ||
        (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true')
    const auditLogPath =
        options.auditLog ??
        process.env['AUDIT_LOG_PATH'] ??
        process.env['MEMORY_JOURNAL_AUDIT_LOG'] ??
        (allowConfigLogPath ? auditDefaults?.logPath : undefined)
    if (!auditLogPath) {
        throw new Error('Audit log path not configured (--audit-log or AUDIT_LOG_PATH)')
    }
    let maxSizeBytes = auditDefaults?.maxSizeBytes ?? DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES
    if (command.getOptionValueSource('auditLogMaxSize') === 'cli' && options.auditLogMaxSize !== undefined) {
        const parsedMaxSize = parseCanonicalPositiveInt(options.auditLogMaxSize)
        if (parsedMaxSize === undefined) {
            process.stderr.write(`Error: Invalid --audit-log-max-size '${options.auditLogMaxSize}'. Expected a positive safe integer.\n`)
            process.exit(1)
        }
        maxSizeBytes = parsedMaxSize
    }
    return new AuditLogger({
        logPath: auditLogPath,
        enabled: true,
        redact:
            (command.getOptionValueSource('auditRedact') === 'cli'
                ? options.auditRedact
                : undefined) ??
            auditDefaults?.redact ??
            true,
        auditReads:
            (command.getOptionValueSource('auditReads') === 'cli'
                ? options.auditReads
                : undefined) ??
            auditDefaults?.auditReads ??
            false,
        maxSizeBytes,
    })
}

export async function auditAction(options: z.infer<typeof auditSchema>, command: Command): Promise<void> {
    try {
        let resolver: ConfigResolver
        const configPath = options.config ?? process.env['MEMORY_JOURNAL_CONFIG']
        const configErrors: string[] = []
        try {
            resolver = new ConfigResolver(command, options, configPath)
        } catch (err) {
            configErrors.push(err instanceof Error ? err.message : String(err))
            resolver = new ConfigResolver(command, {}, undefined)
        }
        const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
        if (configErrors.length > 0) {
            process.stderr.write('Startup Configuration Errors:\n')
            configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
            process.exit(1)
        }
        if (options.dumpConfig === true) {
            dumpConfigAndExit(serverOptions)
        }

        const logger = createCliAuditLogger(options, command, serverOptions, configPath)
        const statusFilter = options.status === 'success' ? true : (options.status === 'error' ? false : undefined)

        let result: AuditEntry[]
        try {
            result = await logger.search({
                limit: options.limit,
                tool_name: options.tool,
                user: options.user,
                category: options.category,
                status: statusFilter,
            })
        } finally {
            await logger.close()
        }

        writeCliResult(result, options.json, `Audit entries matched: ${String(result.length)}`)
    } catch (e) {
        process.stderr.write(`Audit search failed: ${formatCliError(e)}\n`)
        process.exit(1)
    }
}

export async function rebuildIndexAction(options: z.infer<typeof rebuildIndexSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let exitCode = 0
    try {
        const explicitWs = options.workspace?.trim()
        if (explicitWs === '*') {
            throw new Error(
                "Refusing wildcard '--workspace *' in rebuild-index. Omit --workspace or pass a concrete workspace name."
            )
        }
        const requestedProj = options.defaultProject
        const targetWs =
            explicitWs !== undefined && explicitWs !== ''
                ? explicitWs
                : requestedProj === undefined
                  ? serverOptions.defaultWorkspaceId
                  : undefined
        const targetProj =
            requestedProj ??
            (explicitWs === undefined ? serverOptions.defaultProjectNumber : undefined)
        const rebuildScope = resolveAutoPruneScope(
            targetWs,
            targetProj,
            serverOptions.projectRegistry
        )
        if (options.team === true) {
            enforceCliTeamRbac(db, serverOptions, 'admin', rebuildScope.workspaceId)
        }
        const { VectorSearchManager } = await import('../../vector/vector-search-manager/index.js')
        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })

        if (options.json !== true) {
            process.stderr.write('Rebuilding vector index...\n')
        }
        const result = await vectorManager.rebuildIndex(undefined, {
            workspaceId: rebuildScope.workspaceId,
            ...(rebuildScope.projectNumber !== undefined
                ? { projectNumber: rebuildScope.projectNumber }
                : {}),
        })
        const stats = vectorManager.getStats()

        if (!result.success) {
            process.stderr.write(
                `Rebuild index failed: ${String(result.failed)} entries could not be indexed${result.firstError !== null ? ` (${result.firstError})` : ''}\n`
            )
            writeCliResult(
                { status: 'failed', ...result, stats },
                options.json,
                `Rebuild index failed (${String(result.failed)} failed)`
            )
            exitCode = 1
        } else {
            writeCliResult(
                { status: 'success', stats },
                options.json,
                `Rebuilt vector index (${String(stats.itemCount)} vectors)`
            )
        }
    } catch (e) {
        process.stderr.write(`Rebuild index failed: ${formatCliError(e)}\n`)
        exitCode = 1
    } finally {
        db.close()
    }
    if (exitCode !== 0) {
        process.exit(exitCode)
    }
}
