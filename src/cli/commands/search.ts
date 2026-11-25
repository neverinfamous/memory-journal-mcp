import type { Command } from 'commander'
import { type z } from 'zod'
import { searchOptionsSchema } from '../schemas.js'
import { getCliCommandDb as getDb, resolveCliReadScope } from './db-helper.js'
import { formatCliError, writeCliResult } from './cli-output.js'

export const searchSchema = searchOptionsSchema

export async function searchAction(query: string | undefined, options: z.infer<typeof searchSchema>, command: Command): Promise<void> {
    if (options.dumpConfig === true) {
        await getDb(options, command)
        return
    }
    const firstNonBlankQuery = (...vals: (string | undefined)[]): string | undefined => {
        for (const v of vals) {
            if (typeof v === 'string' && v.trim() !== '') return v.trim()
        }
        return undefined
    }
    const finalQuery = firstNonBlankQuery(query, options.query, options.term, options.keyword)
    if (finalQuery === undefined) {
        process.stderr.write("🛠️ AUTONOMOUS HEALING: Missing search query. You must provide a query as a positional argument (e.g. `mj search \"query\"`) or via a flag (e.g. `mj search --query \"query\"`).\n");
        process.exit(1);
    }

    const { db, serverOptions } = await getDb(options, command)
    let failed = false
    let vectorManager: { dispose: () => Promise<void> } | undefined

    try {
        const mode = options.mode || 'auto'
        const limit = options.limit ?? 100
        const { workspaceId, projectNumber } = resolveCliReadScope(db, serverOptions, options)
        const workspaceFilter = workspaceId !== undefined ? { workspaceId } : {}
        const projectFilter = projectNumber !== undefined ? { projectNumber } : {}
        let result: unknown

        if (mode === 'semantic') {
            const { VectorSearchManager } = await import('../../vector/vector-search-manager/index.js')
            const manager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })
            vectorManager = manager
            result = await manager.search(finalQuery, limit, 0.25, workspaceId, projectNumber)
        } else if (mode === 'hybrid') {
            const [{ VectorSearchManager }, { hybridSearch }] = await Promise.all([
                import('../../vector/vector-search-manager/index.js'),
                import('../../handlers/tools/search/hybrid.js'),
            ])
            const manager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })
            vectorManager = manager
            result = await hybridSearch(finalQuery, db, manager, { limit, ...workspaceFilter, ...projectFilter })
        } else {
            result = db.searchEntries(finalQuery, {
                limit,
                fuzzy_match: mode === 'auto',
                auto_correct: mode === 'auto',
                ...workspaceFilter,
                ...projectFilter,
            })
        }

        writeCliResult(result, options.json, 'Search finished.')
    } catch (e) {
        failed = true
        process.stderr.write(`Search failed: ${formatCliError(e)}\n`)
    } finally {
        await vectorManager?.dispose().catch(() => undefined)
        db.close()
    }
    if (failed) {
        process.exit(1)
    }
}
