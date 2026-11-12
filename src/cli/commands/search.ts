import type { Command } from 'commander'
import { type z } from 'zod'
import { searchOptionsSchema } from '../schemas.js'
import { getCliCommandDb as getDb } from './db-helper.js'
import { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import { hybridSearch } from '../../handlers/tools/search/hybrid.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'

export const searchSchema = searchOptionsSchema

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
        const requestedProject = options.defaultProject
        const workspaceId = resolveWorkspaceId(
            options.workspace,
            requestedProject ?? serverOptions.defaultProjectNumber,
            serverOptions
        )
        const workspaceFilter = workspaceId !== undefined ? { workspaceId } : {}
        const projectFilter = requestedProject !== undefined ? { projectNumber: requestedProject } : {}
        let result: unknown

        if (mode === 'semantic') {
            const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })
            result = await vectorManager.search(finalQuery, limit, 0.25, workspaceId)
        } else if (mode === 'hybrid') {
            const vectorManager = new VectorSearchManager(db, { modelName: serverOptions.embeddingModel })
            result = await hybridSearch(finalQuery, db, vectorManager, { limit, ...workspaceFilter, ...projectFilter })
        } else {
            result = db.searchEntries(finalQuery, {
                limit,
                fuzzy_match: mode === 'auto',
                auto_correct: mode === 'auto',
                ...workspaceFilter,
                ...projectFilter,
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
