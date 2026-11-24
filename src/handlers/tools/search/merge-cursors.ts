import type { JournalEntry } from '../../../types/index.js'
import type { EntryWithSource } from './helpers.js'
import {
    decodeCursor,
    encodeCursor,
} from '../../../database/sqlite-adapter/entries/search/cursor.js'

export interface MergedCompoundCursorOptions {
    merged: readonly EntryWithSource[]
    personalEntries: readonly JournalEntry[]
    teamEntries: readonly JournalEntry[]
    personalRawNextCursor: string | undefined
    teamRawNextCursor: string | undefined
    prevPersonalCursor: string | undefined
    prevTeamCursor: string | undefined
    useKeyset: boolean
    personalDegraded: boolean
    teamDegraded: boolean
    encodeCompound: (personalCursor?: string, teamCursor?: string) => string
}

function readCursorOffset(cursor: string | undefined): number {
    if (cursor === undefined || cursor === '') return 0
    const decoded = decodeCursor(cursor)
    return decoded !== null && 'offset' in decoded ? decoded.offset : 0
}

function computeSideNextCursor<T extends { readonly timestamp?: string | undefined }>(opts: {
    consumedEntries: readonly T[]
    getEntryId: (entry: T) => unknown
    rawEntriesCount: number
    rawNextCursor: string | undefined
    prevCursor: string | undefined
    useKeyset: boolean
    degraded: boolean
}): string | undefined {
    const {
        consumedEntries,
        getEntryId,
        rawEntriesCount,
        rawNextCursor,
        prevCursor,
        useKeyset,
        degraded,
    } = opts
    if (rawEntriesCount === 0) return undefined
    if (consumedEntries.length >= rawEntriesCount) return rawNextCursor

    if (useKeyset) {
        if (consumedEntries.length > 0) {
            const last = consumedEntries[consumedEntries.length - 1]
            const lastId = last !== undefined ? getEntryId(last) : undefined
            if (last !== undefined && typeof last.timestamp === 'string' && typeof lastId === 'number') {
                return encodeCursor({ t: last.timestamp, id: lastId })
            }
        }
        return prevCursor ?? encodeCursor({ offset: 0 })
    }

    const nextOffset = readCursorOffset(prevCursor) + consumedEntries.length
    return encodeCursor({
        offset: nextOffset,
        ...(degraded ? { degraded: true as const } : {}),
    })
}

/**
 * Compute per-store compound cursors from the entries actually consumed into the merged page
 * so 2x per-DB over-fetching never skips rows or terminates pagination early.
 */
export function computeMergedCompoundCursor(opts: MergedCompoundCursorOptions): string | undefined {
    const personalInPage = opts.merged.filter((entry) => entry.source === 'personal')
    const teamInPageIds = new Set<number>()
    const collapsedTeamIds = new Set<number>()

    for (const entry of opts.merged) {
        const entryId = entry['id']
        if (entry.source === 'team' && entry.team_db === undefined && typeof entryId === 'number') {
            teamInPageIds.add(entryId)
        } else if (entry.source === 'personal' && typeof entry['alsoInTeam'] === 'number') {
            collapsedTeamIds.add(entry['alsoInTeam'])
        }
    }

    const consumedTeamEntries = opts.teamEntries.filter(
        (entry) => teamInPageIds.has(entry.id) || collapsedTeamIds.has(entry.id)
    )

    const nextPersonalCursor = computeSideNextCursor({
        consumedEntries: personalInPage,
        getEntryId: (entry) => entry['id'],
        rawEntriesCount: opts.personalEntries.length,
        rawNextCursor: opts.personalRawNextCursor,
        prevCursor: opts.prevPersonalCursor,
        useKeyset: opts.useKeyset,
        degraded: opts.personalDegraded,
    })

    const nextTeamCursor = computeSideNextCursor({
        consumedEntries: consumedTeamEntries,
        getEntryId: (entry) => entry.id,
        rawEntriesCount: opts.teamEntries.length,
        rawNextCursor: opts.teamRawNextCursor,
        prevCursor: opts.prevTeamCursor,
        useKeyset: opts.useKeyset,
        degraded: opts.teamDegraded,
    })

    return nextPersonalCursor !== undefined || nextTeamCursor !== undefined
        ? opts.encodeCompound(nextPersonalCursor, nextTeamCursor)
        : undefined
}
