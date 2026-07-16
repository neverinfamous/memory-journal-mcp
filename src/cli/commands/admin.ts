import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { runAutoPrune } from '../../server/auto-prune.js'
import type { Command } from 'commander'
import { type z } from 'zod'

import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { 
    adminBackupOptionsSchema, 
    adminRestoreOptionsSchema, 
    adminVacuumOptionsSchema, 
    adminPruneOptionsSchema,
    adminAuditSearchOptionsSchema,
    adminRebuildIndexOptionsSchema
} from '../schemas.js'

import { AuditLogger } from '../../audit/audit-logger.js'
import type { AuditCategory, AuditEntry } from '../../audit/types.js'
import { DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES } from '../../audit/types.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'

export const backupSchema = adminBackupOptionsSchema
export const restoreSchema = adminRestoreOptionsSchema
export const vacuumSchema = adminVacuumOptionsSchema
export const pruneSchema = adminPruneOptionsSchema
export const auditSchema = adminAuditSearchOptionsSchema
export const rebuildIndexSchema = adminRebuildIndexOptionsSchema

import type { ServerOptions } from '../../server/mcp-server/types.js'

async function getDb(options: Record<string, unknown> & { config?: string, team?: boolean }, command: Command): Promise<{ db: IDatabaseAdapter, serverOptions: ServerOptions }> {
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

export async function backupAction(options: z.infer<typeof backupSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    const dest = options.dest
    try {
        const result = await db.exportToFile(dest)
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stderr.write(`Backup successful: ${result.path} (${result.sizeBytes} bytes)\n`)
        }
    } catch (e) {
        process.stderr.write("Backup failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function restoreAction(file: string, options: z.infer<typeof restoreSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        const result = await db.restoreFromFile(file)
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stderr.write(`Restore successful from ${result.restoredFrom}. Previous entries: ${result.previousEntryCount}, New entries: ${result.newEntryCount}\n`)
        }
    } catch (e) {
        process.stderr.write("Restore failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function vacuumAction(options: z.infer<typeof vacuumSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        db.pragma('optimize')
        db.flushSave()
        if (options.json === true) {
            process.stdout.write(JSON.stringify({ status: 'success', action: 'vacuum' }) + '\n')
        } else {
            process.stderr.write("Vacuum and optimize successful.\n")
        }
    } catch (e) {
        process.stderr.write("Vacuum failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function pruneAction(options: z.infer<typeof pruneSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    
    try {
        const result = await runAutoPrune(db, {
            archiveOlderThanDays: options.archiveOlderThanDays ?? 0,
            pruneOlderThanDays: options.pruneOlderThanDays ?? 0,
            hardDeleteOlderThanDays: options.hardDeleteOlderThanDays ?? 0,
            importanceThreshold: options.importanceThreshold ?? 0.15,
            dryRun: options.dryRun === true,
            excludeTags: options.excludeTags ? options.excludeTags.split(',') : []
        })
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stderr.write(`Prune result:\n`)
            process.stderr.write(`  Archived:     ${result.archivedCount}\n`)
            process.stderr.write(`  Soft Deleted: ${result.prunedCount}\n`)
            process.stderr.write(`  Hard Deleted: ${result.hardDeletedCount}\n`)
            if (result.backupFile) {
                process.stderr.write(`  Safety backup created: ${result.backupFile}\n`)
            }
        }
    } catch (e) {
        process.stderr.write("Prune failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function auditAction(options: z.infer<typeof auditSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        const auditLogPath = options.auditLog ?? process.env['MEMORY_JOURNAL_AUDIT_LOG']
        if (!auditLogPath) {
            throw new Error('Audit log path not configured (--audit-log or MEMORY_JOURNAL_AUDIT_LOG)')
        }
        
        const logger = new AuditLogger({
            logPath: auditLogPath,
            enabled: true,
            redact: options.auditRedact ?? true,
            auditReads: options.auditReads ?? false,
            maxSizeBytes: options.auditLogMaxSize ? parseInt(options.auditLogMaxSize) : DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES
        })

        const statusFilter = options.status === 'success' ? true : (options.status === 'error' ? false : undefined)

        const result: AuditEntry[] = await logger.search({
            limit: options.limit,
            tool_name: options.tool,
            user: options.user,
            category: options.category as AuditCategory | undefined,
            status: statusFilter
        })

        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Audit search failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function rebuildIndexAction(options: z.infer<typeof rebuildIndexSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })

        process.stderr.write('Rebuilding vector index...\n')
        await vectorManager.rebuildIndex()
        const stats = vectorManager.getStats()
        
        process.stdout.write(JSON.stringify({ status: 'success', stats }, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Rebuild index failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
