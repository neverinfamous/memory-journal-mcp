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
    adminPruneOptionsSchema 
} from '../schemas.js'

export const backupSchema = adminBackupOptionsSchema
export const restoreSchema = adminRestoreOptionsSchema
export const vacuumSchema = adminVacuumOptionsSchema
export const pruneSchema = adminPruneOptionsSchema

import type { ServerOptionsSchema } from '../schemas.js'

async function getDb(options: ServerOptionsSchema, command: Command): Promise<IDatabaseAdapter> {
    let resolver: ConfigResolver
    const configPath = (options.config) ?? process.env['MEMORY_JOURNAL_CONFIG']
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

    const dbPath = serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    return db
}

export async function backupAction(options: z.infer<typeof backupSchema>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)
    const dest = options.dest
    try {
        const result = await db.exportToFile(dest)
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stdout.write(`Backup successful: ${result.path} (${result.sizeBytes} bytes)\n`)
        }
    } catch (e) {
        process.stderr.write("Backup failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function restoreAction(file: string, options: z.infer<typeof restoreSchema>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)
    try {
        const result = await db.restoreFromFile(file)
        if (options.json === true) {
            process.stdout.write(JSON.stringify(result) + '\n')
        } else {
            process.stdout.write(`Restore successful from ${result.restoredFrom}. Previous entries: ${result.previousEntryCount}, New entries: ${result.newEntryCount}\n`)
        }
    } catch (e) {
        process.stderr.write("Restore failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function vacuumAction(options: z.infer<typeof vacuumSchema>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)
    try {
        db.pragma('optimize')
        db.flushSave()
        if (options.json === true) {
            process.stdout.write(JSON.stringify({ status: 'success', action: 'vacuum' }) + '\n')
        } else {
            process.stdout.write("Vacuum and optimize successful.\n")
        }
    } catch (e) {
        process.stderr.write("Vacuum failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function pruneAction(options: z.infer<typeof pruneSchema>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)
    
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
            process.stdout.write(`Prune result:\n`)
            process.stdout.write(`  Archived:     ${result.archivedCount}\n`)
            process.stdout.write(`  Soft Deleted: ${result.prunedCount}\n`)
            process.stdout.write(`  Hard Deleted: ${result.hardDeletedCount}\n`)
            if (result.backupFile) {
                process.stdout.write(`  Safety backup created: ${result.backupFile}\n`)
            }
        }
    } catch (e) {
        process.stderr.write("Prune failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
