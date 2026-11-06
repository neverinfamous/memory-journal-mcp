import type { ToolContext } from '../../types/index.js'
import { autoIndexEntry } from '../../utils/vector-index-helpers.js'
import { createBatchProgressReporter, sendProgress } from '../../utils/progress-utils.js'

interface BatchIndexParams {
    progress: ToolContext['progress']
    /** Vector manager; indexing is skipped (and `doneMessage` reported) when absent. */
    vectorManager: Parameters<typeof autoIndexEntry>[0]
    db: Parameters<typeof autoIndexEntry>[1]
    autoIndex: boolean
    entryIds: number[]
    /** Prefix for per-entry failure messages, e.g. "Entry" or "Team entry". */
    errorPrefix: string
    /** Final progress message when no indexing runs. */
    doneMessage: string
    /** Optional filter selecting which entries need (re)indexing. */
    shouldIndex?: (entryId: number) => boolean
}

/**
 * Vector-index the entries touched by a batch operation, reporting progress.
 * Failures are collected rather than thrown so the caller can aggregate them.
 */
export async function indexBatchEntries(
    params: BatchIndexParams
): Promise<{ indexStatuses: string[]; indexErrors: Error[] }> {
    const { progress, vectorManager, db, autoIndex, entryIds, errorPrefix, doneMessage, shouldIndex } = params
    const indexStatuses: string[] = []
    const indexErrors: Error[] = []

    if (!autoIndex || !vectorManager) {
        await sendProgress(progress, 2, 2, doneMessage)
        return { indexStatuses, indexErrors }
    }

    const reporter = createBatchProgressReporter(progress, entryIds.length, 10)
    for (let i = 0; i < entryIds.length; i++) {
        const entryId = entryIds[i]
        if (entryId !== undefined && (shouldIndex === undefined || shouldIndex(entryId))) {
            try {
                const status = await autoIndexEntry(vectorManager, db, entryId)
                if (status) indexStatuses.push(status)
            } catch (err) {
                indexErrors.push(
                    new Error(
                        `${errorPrefix} ${String(entryId)} vector indexing failed: ${err instanceof Error ? err.message : String(err)}`
                    )
                )
            }
        }
        await reporter(i + 1, `Indexing ${String(i + 1)}/${String(entryIds.length)}...`)
    }
    return { indexStatuses, indexErrors }
}
