import type { Command } from 'commander'
import { type z } from 'zod'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { searchOptionsSchema } from '../schemas.js'
import type { ServerOptionsSchema } from '../schemas.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'

export const searchSchema = searchOptionsSchema

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
    if (options.team && !teamDb) {
        process.stderr.write('Warning: --team specified but no TEAM_DB_PATH configured. Using core database.\n')
    }

    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    return { db, serverOptions }
}

export async function searchAction(query: string | undefined, options: z.infer<typeof searchSchema>, command: Command): Promise<void> {
    const finalQuery = query ?? options.query ?? options.term ?? options.keyword;
    if (!finalQuery) {
        process.stderr.write("🛠️ AUTONOMOUS HEALING: Missing search query. You must provide a query as a positional argument (e.g. `mj search \"query\"`) or via a flag (e.g. `mj search --query \"query\"`).\n");
        process.exit(1);
    }

    const { db, serverOptions } = await getDb(options, command)
    
    try {
        const mode = options.mode || 'auto'
        const limit = options.limit ?? 100
        let result: unknown

        if (mode === 'semantic') {
            const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })
            result = await vectorManager.search(finalQuery, limit)
        } else {
            result = db.searchEntries(finalQuery, {
                limit,
                fuzzy_match: mode === 'auto',
                auto_correct: mode === 'auto',
            })
        }

        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (e) {
        process.stderr.write("Search failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
