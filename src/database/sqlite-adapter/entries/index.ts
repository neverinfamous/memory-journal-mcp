import type { JournalEntry, EntryType, ImportanceResult, EntryRevision, AnchorStatus, Anchor, ToolHandlerConfig } from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/schema.js'
import type { NativeConnectionManager } from '../native-connection.js'
import type { TagsManager } from '../tags.js'

import type { EntriesSharedContext } from './shared.js'
import {
    createEntry,
    getEntryById,
    getEntriesByIds,
    getEntryByIdIncludeDeleted,
    getActiveEntryCount,
    updateEntry,
    deleteEntry,
    createEntries,
    updateEntries,
    deleteEntries,
    getEntryHistory,
    restoreEntry,
    getDeletedEntries,
} from './crud.js'
import {
    getRecentEntries as getRecentEntriesQuery,
    getEntriesPage,
    searchEntries,
    getSearchFacets,
    searchByDateRange,
    type SortBy,
} from './search/index.js'
export { levenshteinDistance, buildVocabulary, findFuzzyMatches, expandFuzzyQuery } from './fuzzy-matcher.js'
import { calculateImportance, getEntriesByIdsWithImportance } from './importance.js'
import { getStatistics } from './statistics.js'
import { updateAnchorStatus, getAnchorsByEntryId } from './anchors.js'

export class EntriesManager {
    private sharedContext: EntriesSharedContext

    constructor(ctx: NativeConnectionManager, tagsMgr: TagsManager, config?: ToolHandlerConfig) {
        this.sharedContext = {
            ctx,
            tagsMgr,
            config,
            get db() {
                return ctx.getNativeDb()
            },
        }
    }

    createEntry(input: CreateEntryInput): JournalEntry {
        return createEntry(this.sharedContext, input)
    }

    getEntryById(id: number, workspaceId?: string): JournalEntry | null {
        return getEntryById(this.sharedContext, id, workspaceId)
    }

    getEntriesByIds(ids: number[]): Map<number, JournalEntry> {
        return getEntriesByIds(this.sharedContext, ids)
    }

    getEntriesByIdsWithImportance(
        ids: number[]
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }> {
        return getEntriesByIdsWithImportance(this.sharedContext, ids)
    }

    getEntryByIdIncludeDeleted(id: number, workspaceId?: string): JournalEntry | null {
        return getEntryByIdIncludeDeleted(this.sharedContext, id, workspaceId)
    }

    getActiveEntryCount(): number {
        return getActiveEntryCount(this.sharedContext)
    }

    updateEntry(
        id: number,
        input: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            significanceType?: string | null
            autoContext?: string | null
            projectNumber?: number | null
            projectOwner?: string | null
            issueNumber?: number | null
            issueUrl?: string | null
            prNumber?: number | null
            prUrl?: string | null
            prStatus?: string | null
            workflowRunId?: number | null
            workflowName?: string | null
            workflowStatus?: string | null
            expectedVersion?: number
            workspaceId?: string
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
        }
    ): JournalEntry | null {
        return updateEntry(this.sharedContext, id, input)
    }

    deleteEntry(id: number, permanent = false): boolean {
        return deleteEntry(this.sharedContext, id, permanent)
    }

    createEntries(inputs: CreateEntryInput[]): { created: JournalEntry[]; errors: { index: number; error: Error }[] } {
        return createEntries(this.sharedContext, inputs)
    }

    updateEntries(
        updates: {
            id: number
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            significanceType?: string | null
            autoContext?: string | null
            projectNumber?: number | null
            projectOwner?: string | null
            issueNumber?: number | null
            issueUrl?: string | null
            prNumber?: number | null
            prUrl?: string | null
            prStatus?: string | null
            workflowRunId?: number | null
            workflowName?: string | null
            workflowStatus?: string | null
            expectedVersion?: number
            workspaceId?: string
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return updateEntries(this.sharedContext, updates)
    }

    deleteEntries(ids: number[], permanent = false): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return deleteEntries(this.sharedContext, ids, permanent)
    }

    getRecentEntries(limit = 10, isPersonal?: boolean, sortBy?: SortBy, cursor?: string, includeArchived?: boolean, workspaceId?: string): { entries: JournalEntry[]; nextCursor?: string } {
        if (isPersonal !== undefined) {
            return searchEntries(this.sharedContext, '', { limit, isPersonal, sortBy, cursor, includeArchived, workspaceId })
        }
        return getRecentEntriesQuery(this.sharedContext, limit, sortBy, cursor, includeArchived, workspaceId)
    }

    getEntriesPage(offset: number, limit: number, order: 'asc' | 'desc' = 'desc'): { entries: JournalEntry[]; nextCursor?: string } {
        return getEntriesPage(this.sharedContext, offset, limit, order)
    }

    searchEntries(
        queryStr: string,
        options?: {
            limit?: number
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            prStatus?: string
            workflowRunId?: number
            sortBy?: SortBy
            cursor?: string
            includeArchived?: boolean
            includeHighlights?: boolean
            fuzzy_match?: boolean
            auto_correct?: boolean
            workspaceId?: string
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean; highlights?: { id: number; snippet: string }[]; suggestions?: string[]; correctedQuery?: string } {
        return searchEntries(this.sharedContext, queryStr, options)
    }

    getSearchFacets(
        queryStr: string,
        options?: {
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            prStatus?: string
            workflowRunId?: number
            tags?: string[]
            entryType?: EntryType
            startDate?: string
            endDate?: string
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[] } {
        return getSearchFacets(this.sharedContext, queryStr, options)
    }

    searchByDateRange(
        startDate: string,
        endDate: string,
        options?: {
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            workflowRunId?: number
            limit?: number
            sortBy?: SortBy
            cursor?: string
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean } {
        return searchByDateRange(this.sharedContext, startDate, endDate, options)
    }

    calculateImportance(entryId: number): ImportanceResult {
        return calculateImportance(this.sharedContext, entryId)
    }

    getStatistics(
        timeframe: 'day' | 'week' | 'month' | 'year' = 'month',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean,
        workspaceId?: string
    ): Record<string, unknown> {
        return getStatistics(this.sharedContext, timeframe, startDate, endDate, projectBreakdown, workspaceId)
    }

    getEntryHistory(id: number): EntryRevision[] {
        return getEntryHistory(this.sharedContext, id)
    }

    restoreEntry(id: number): boolean {
        return restoreEntry(this.sharedContext, id)
    }

    getDeletedEntries(options?: { limit?: number; offset?: number; workspaceId?: string }): { entries: JournalEntry[]; count: number } {
        return getDeletedEntries(this.sharedContext, options)
    }

    updateAnchorStatus(id: number, status: AnchorStatus): void {
        updateAnchorStatus(this.sharedContext, id, status)
    }

    getAnchorsByEntryId(entryId: number): Anchor[] {
        return getAnchorsByEntryId(this.sharedContext, entryId)
    }
}
