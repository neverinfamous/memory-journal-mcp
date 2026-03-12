import type {
    JournalEntry,
    EntryType,
    ImportanceResult
} from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/schema.js'
import type { Database } from 'better-sqlite3'
import type { NativeConnectionManager } from '../native-connection.js'
import type { TagsManager } from '../tags.js'

import type { EntriesSharedContext } from './shared.js'
import {
    createEntry,
    getEntryById,
    getEntryByIdIncludeDeleted,
    getActiveEntryCount,
    updateEntry,
    deleteEntry,
} from './crud.js'
import {
    getEntriesPage,
    searchEntries,
    searchByDateRange,
} from './search.js'
import { calculateImportance } from './importance.js'
import { getStatistics } from './statistics.js'

export class EntriesManager {
    private sharedContext: EntriesSharedContext

    constructor(
        ctx: NativeConnectionManager,
        tagsMgr: TagsManager
    ) {
        this.sharedContext = { ctx, tagsMgr, get db() { return ctx.getRawDb() as Database } }
    }

    createEntry(input: CreateEntryInput): JournalEntry {
        return createEntry(this.sharedContext, input)
    }

    getEntryById(id: number): JournalEntry | null {
        return getEntryById(this.sharedContext, id)
    }

    getEntryByIdIncludeDeleted(id: number): JournalEntry | null {
        return getEntryByIdIncludeDeleted(this.sharedContext, id)
    }

    getActiveEntryCount(): number {
        return getActiveEntryCount(this.sharedContext)
    }

    updateEntry(id: number, input: {
        content?: string
        entryType?: EntryType
        tags?: string[]
        isPersonal?: boolean
        significanceType?: string
        autoContext?: boolean
        projectNumber?: number
        projectOwner?: string
        issueNumber?: number
        issueUrl?: string
        prNumber?: number
        prUrl?: string
        prStatus?: string
        workflowRunId?: number
        workflowName?: string
        workflowStatus?: string
    }): JournalEntry | null {
        return updateEntry(this.sharedContext, id, input)
    }

    deleteEntry(id: number, permanent = false): boolean {
        return deleteEntry(this.sharedContext, id, permanent)
    }

    getRecentEntries(limit = 10, isPersonal?: boolean): JournalEntry[] {
        // Pass the isPersonal constraint as an option to searchEntries
        return searchEntries(this.sharedContext, "", { limit, isPersonal })
    }

    getEntriesPage(
        offset: number,
        limit: number,
        order: 'asc' | 'desc' = 'desc'
    ): JournalEntry[] {
        return getEntriesPage(this.sharedContext, offset, limit, order)
    }

    searchEntries(queryStr: string, options?: { limit?: number, isPersonal?: boolean, projectNumber?: number, issueNumber?: number, prNumber?: number }): JournalEntry[] {
        return searchEntries(this.sharedContext, queryStr, options)
    }

    searchByDateRange(startDate: string, endDate: string, options?: { entryType?: EntryType, tags?: string[], isPersonal?: boolean, limit?: number }): JournalEntry[] {
        return searchByDateRange(this.sharedContext, startDate, endDate, options)
    }

    calculateImportance(entryId: number): ImportanceResult {
        return calculateImportance(this.sharedContext, entryId)
    }

    getStatistics(timeframe: 'day' | 'week' | 'month' | 'year' = 'month', startDate?: string, endDate?: string, projectBreakdown?: boolean): Record<string, unknown> {
        return getStatistics(this.sharedContext, timeframe, startDate, endDate, projectBreakdown)
    }
}
