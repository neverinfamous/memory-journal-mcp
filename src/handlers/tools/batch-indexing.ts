import type { JournalEntry, ToolContext } from '../../types/index.js'
import { autoIndexEntry } from '../../utils/vector-index-helpers.js'
import { createBatchProgressReporter, sendProgress } from '../../utils/progress-utils.js'

interface BatchIndexParams {
    progress: ToolContext['progress']
    /** Vector manager; indexing is skipped (and `doneMessage` reported) when absent. */
    vectorManager: Parameters<typeof autoIndexEntry>[0]
    db: Parameters<typeof autoIndexEntry>[1]
    autoIndex: boolean
    entryIds: number[]
    /** Optional pre-hydrated entries to avoid redundant getEntryById lookups. */
    entries?: readonly JournalEntry[]
    /** Prefix for per-entry failure messages, e.g. "Entry" or "Team entry". */
    errorPrefix: string
    /** Final progress message when no indexing runs. */
    doneMessage: string
    /** Optional filter selecting which entries need (re)indexing. */
    shouldIndex?: (entryId: number) => boolean
    /** Workspace already resolved for every entry in this batch. */
    workspaceId?: string
    /** Per-entry workspace when a batch spans more than one workspace. */
    workspaceByEntryId?: ReadonlyMap<number, string>
}

export function collectIndexWorkspaces(
    entries: readonly { id: number; workspaceId?: string | null }[]
): Map<number, string> {
    const workspaces = new Map<number, string>()
    for (const entry of entries) {
        const workspaceId = entry.workspaceId
        if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== '*') {
            workspaces.set(entry.id, workspaceId)
        }
    }
    return workspaces
}

/**
 * Vector-index the entries touched by a batch operation, reporting progress.
 * Uses batch `addEntries` when available and falls back per-entry on failure.
 */
export async function indexBatchEntries(
    params: BatchIndexParams
): Promise<{ indexStatuses: string[]; indexErrors: Error[] }> {
    const {
        progress,
        vectorManager,
        db,
        autoIndex,
        entryIds,
        entries,
        errorPrefix,
        doneMessage,
        shouldIndex,
        workspaceId,
        workspaceByEntryId,
    } = params
    const indexStatuses: string[] = []
    const indexErrors: Error[] = []

    if (!autoIndex || !vectorManager) {
        await sendProgress(progress, 2, 2, doneMessage)
        return { indexStatuses, indexErrors }
    }

    const entryById = new Map<number, JournalEntry>()
    if (entries !== undefined) {
        for (const entry of entries) entryById.set(entry.id, entry)
    }
    const targetIds = entryIds.filter((id) => shouldIndex === undefined || shouldIndex(id))
    const resolvedEntries: JournalEntry[] = []
    let allHydratedAndScoped = targetIds.length > 1 && typeof vectorManager.addEntries === 'function'
    if (allHydratedAndScoped) {
        const missingIds = targetIds.filter((id) => !entryById.has(id))
        if (missingIds.length > 0 && typeof db.getEntriesByIds === 'function') {
            for (const [id, entry] of db.getEntriesByIds(missingIds, workspaceId ?? '*')) {
                entryById.set(id, entry)
            }
        }
        for (const id of targetIds) {
            const hydrated = entryById.get(id)
            const ws = workspaceByEntryId?.get(id) ?? workspaceId ?? hydrated?.workspaceId
            if (!hydrated || ws === undefined || ws.length === 0 || ws === '*') {
                allHydratedAndScoped = false
                break
            }
            resolvedEntries.push(hydrated)
        }
        if (allHydratedAndScoped && resolvedEntries.length === targetIds.length) {
            try {
                await vectorManager.addEntries(resolvedEntries)
                indexStatuses.push(...resolvedEntries.map(() => 'success' as const))
                await sendProgress(progress, entryIds.length, entryIds.length, doneMessage)
                return { indexStatuses, indexErrors }
            } catch {
                // Fall back to per-entry indexing so individual failure reporting remains exact.
            }
        }
    }

    const reporter = createBatchProgressReporter(progress, entryIds.length, 10)
    for (let i = 0; i < entryIds.length; i++) {
        const entryId = entryIds[i]
        if (entryId !== undefined && (shouldIndex === undefined || shouldIndex(entryId))) {
            try {
                const indexedWorkspace = workspaceByEntryId?.get(entryId) ?? workspaceId
                const target = entryById.get(entryId) ?? entryId
                const status = await autoIndexEntry(vectorManager, db, target, indexedWorkspace)
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
