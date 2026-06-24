import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { runAutoPrune } from '../../server/auto-prune.js'
import type { Command } from 'commander'

async function getDb(options: Record<string, unknown>): Promise<IDatabaseAdapter> {
    const dbPath = (options['db'] as string) ?? process.env['DB_PATH'] ?? './memory_journal.db'
    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    return db
}

export async function backupAction(options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals())
    const dest = options['dest'] as string | undefined
    try {
        const result = await db.exportToFile(dest)
        process.stdout.write(`Backup successful: ${result.path} (${result.sizeBytes} bytes)\n`)
    } catch (e) {
        process.stderr.write("Backup failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function restoreAction(file: string, _options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals())
    try {
        const result = await db.restoreFromFile(file)
        process.stdout.write(`Restore successful from ${result.restoredFrom}. Previous entries: ${result.previousEntryCount}, New entries: ${result.newEntryCount}\n`)
    } catch (e) {
        process.stderr.write("Restore failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function vacuumAction(_options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals())
    try {
        db.pragma('optimize')
        db.flushSave()
        process.stdout.write("Vacuum and optimize successful.\n")
    } catch (e) {
        process.stderr.write("Vacuum failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function pruneAction(options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals())
    
    // Parse numeric options properly since commander might pass them as strings if not strongly typed
    const parseNumber = (val: unknown): number | undefined => {
        if (typeof val === 'number') return val
        if (typeof val === 'string') return parseFloat(val)
        return undefined
    }

    try {
        const result = await runAutoPrune(db, {
            archiveOlderThanDays: parseNumber(options['archiveOlderThanDays']) ?? 0,
            pruneOlderThanDays: parseNumber(options['pruneOlderThanDays']) ?? 0,
            hardDeleteOlderThanDays: parseNumber(options['hardDeleteOlderThanDays']) ?? 0,
            importanceThreshold: parseNumber(options['importanceThreshold']) ?? 0.15,
            dryRun: options['dryRun'] === true,
            excludeTags: typeof options['excludeTags'] === 'string' ? options['excludeTags'].split(',') : []
        })
        process.stdout.write(`Prune result:\n`)
        process.stdout.write(`  Archived:     ${result.archivedCount}\n`)
        process.stdout.write(`  Soft Deleted: ${result.prunedCount}\n`)
        process.stdout.write(`  Hard Deleted: ${result.hardDeletedCount}\n`)
        if (result.backupFile) {
            process.stdout.write(`  Safety backup created: ${result.backupFile}\n`)
        }
    } catch (e) {
        process.stderr.write("Prune failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
