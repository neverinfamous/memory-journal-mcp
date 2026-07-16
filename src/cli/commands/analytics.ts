import type { Command } from 'commander'
import { type z } from 'zod'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { analyticsOptionsSchema } from '../schemas.js'
import type { ServerOptionsSchema } from '../schemas.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'

export const analyticsSchema = analyticsOptionsSchema

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

export async function analyticsStatsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        const result = db.getStatistics()
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Analytics stats failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function analyticsInsightsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        const result = db.getCrossProjectInsights({ minEntries: 1, inactiveThresholdDays: 30 })
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Analytics insights failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
