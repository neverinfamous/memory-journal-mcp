import type { EntryRevision } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { getEntryById } from './crud-read.js'

export type { EntryRevision }

export interface VersionDiff {
    entryId: number
    fromRevision: number
    toRevision: number | 'current'
    fromContent: string
    toContent: string
    addedLines: string[]
    removedLines: string[]
}

export function getEntryRevisions(
    context: EntriesSharedContext,
    id: number
): EntryRevision[] {
    const { db } = context

    const stmt = db.prepare(`
        SELECT id, entry_id as entryId, revision_number as revisionNumber,
               content_snapshot as contentSnapshot, changed_at as changedAt,
               changed_by as changedBy
        FROM entry_revisions
        WHERE entry_id = ?
        ORDER BY revision_number DESC
    `)

    return stmt.all(id) as EntryRevision[]
}

export const getEntryHistory = getEntryRevisions

export function compareEntryVersions(
    context: EntriesSharedContext,
    entryId: number,
    fromRevision: number,
    toRevision?: number
): VersionDiff | null {
    const revisions = getEntryRevisions(context, entryId)
    const fromRev = revisions.find((r) => r.revisionNumber === fromRevision)
    if (fromRev === undefined) return null

    let toContent: string
    let resolvedTo: number | 'current' = 'current'

    if (toRevision !== undefined) {
        const toRev = revisions.find((r) => r.revisionNumber === toRevision)
        if (toRev === undefined) return null
        toContent = toRev.contentSnapshot
        resolvedTo = toRevision
    } else {
        const currentEntry = getEntryById(context, entryId, '*')
        if (currentEntry === null) return null
        toContent = currentEntry.content
    }

    const fromLines = fromRev.contentSnapshot.split('\n')
    const toLines = toContent.split('\n')
    const fromSet = new Set(fromLines)
    const toSet = new Set(toLines)

    const addedLines = toLines.filter((line) => !fromSet.has(line))
    const removedLines = fromLines.filter((line) => !toSet.has(line))

    return {
        entryId,
        fromRevision,
        toRevision: resolvedTo,
        fromContent: fromRev.contentSnapshot,
        toContent,
        addedLines,
        removedLines,
    }
}
