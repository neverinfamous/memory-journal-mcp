import type { SQLiteAdapter } from '../../database/sqlite-adapter/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { logger } from '../../utils/logger.js'
import { REBUILD_BATCH_SIZE, REBUILD_PAGE_SIZE } from './types.js'
import type { VectorSearchManager } from './manager.js'

// Allow mocking in tests
let setTimeoutFn = globalThis.setTimeout

/**
 * Rebuild the vector index incrementally to avoid blocking the event loop or database.
 * This function handles the orchestration, while relying on the manager instance for
 * generating embeddings and upserting into the database.
 */
export async function rebuildIndex(
    manager: VectorSearchManager,
    dbAdapter: SQLiteAdapter,
    progress?: ProgressContext,
    options?: {
        force?: boolean
        batchSize?: number
        pageSize?: number
    }
): Promise<{ success: boolean; indexed: number; skipped: number; errors: number }> {
    const force = options?.force ?? false
    const batchSize = options?.batchSize ?? REBUILD_BATCH_SIZE
    const pageSize = options?.pageSize ?? REBUILD_PAGE_SIZE

    let indexed = 0
    let skipped = 0
    let errorsCount = 0

    const db = dbAdapter.db
    let totalEntries = 0
    try {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM journal_entries')
        const row = stmt.get() as { count: number }
        totalEntries = row.count
    } catch (err) {
        logger.error('Failed to count entries for vector indexing', { error: err })
        return { success: false, indexed: 0, skipped: 0, errors: 1 }
    }

    if (totalEntries === 0) {
        return { success: true, indexed: 0, skipped: 0, errors: 0 }
    }

    await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild')

    // Prepare statements for reading entries
    let getBatchStmt
    try {
        getBatchStmt = db.prepare(`
            SELECT id, content, entry_type, tags, timestamp
            FROM journal_entries
            ORDER BY id ASC
            LIMIT ? OFFSET ?
        `)
    } catch (err) {
        logger.error('Failed to prepare batch statement', { error: err })
        return { success: false, indexed: 0, skipped: 0, errors: 1 }
    }

    // Prepare statement to check if vector exists
    let checkExistsStmt
    try {
        checkExistsStmt = db.prepare('SELECT rowid FROM vec_journal_entries WHERE rowid = ?')
    } catch (err) {
        logger.error('Failed to prepare exists statement', { error: err })
        // Fallback: we will just overwrite if we can't check
    }

    let offset = 0
    while (offset < totalEntries) {
        const rows = getBatchStmt.all(pageSize, offset) as any[]
        if (rows.length === 0) break

        // Process a page in smaller batches
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize)
            const vectorsToUpsert: { id: number; embedding: Float32Array }[] = []

            for (const row of batch) {
                // Check if already indexed unless forced
                if (!force && checkExistsStmt) {
                    try {
                        const exists = checkExistsStmt.get(row.id)
                        if (exists) {
                            skipped++
                            continue
                        }
                    } catch (err) {
                        // Ignore check error and try to index anyway
                    }
                }

                try {
                    const text = \`[\${row.entry_type}] \${row.content}\`
                    const embedding = await manager.generateEmbedding(text)
                    vectorsToUpsert.push({ id: row.id, embedding })
                } catch (err) {
                    errorsCount++
                    logger.warning(\`Failed to generate embedding for entry \${row.id}\`, {
                        error: err instanceof Error ? err.message : String(err),
                    })
                }
            }

            // Upsert the batch into the database
            if (vectorsToUpsert.length > 0) {
                try {
                    // Start transaction for this batch
                    db.exec('BEGIN IMMEDIATE')
                    
                    const upsertStmt = db.prepare(
                        'INSERT OR REPLACE INTO vec_journal_entries(rowid, embedding) VALUES (?, ?)'
                    )
                    
                    for (const { id, embedding } of vectorsToUpsert) {
                        upsertStmt.run(id, embedding)
                    }
                    
                    db.exec('COMMIT')
                    indexed += vectorsToUpsert.length
                } catch (err) {
                    // Rollback transaction on failure
                    try {
                        db.exec('ROLLBACK')
                    } catch (e) {
                        // Ignore rollback error
                    }
                    
                    errorsCount += vectorsToUpsert.length
                    logger.error('Failed to upsert vector batch', {
                        error: err instanceof Error ? err.message : String(err),
                        batchSize: vectorsToUpsert.length
                    })
                }
            }

            // Yield to event loop
            await new Promise((resolve) => setTimeoutFn(resolve, 0))
            await sendProgress(
                progress,
                offset + i + batch.length,
                totalEntries,
                \`Indexing... (\${indexed} indexed, \${skipped} skipped)\`
            )
        }

        offset += pageSize
    }

    return {
        success: errorsCount === 0,
        indexed,
        skipped,
        errors: errorsCount,
    }
}
