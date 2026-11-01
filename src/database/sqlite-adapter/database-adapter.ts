import type {
    JournalEntry,
    EntryType,
    ImportanceResult,
    EntryRevision,
    AnchorStatus,
    Anchor,
} from '../../types/index.js'
import type { IDatabaseAdapter, CreateEntryInput } from '../core/interfaces.js'
import type { EntriesManager } from './entries/index.js'
import { AdapterDelegates } from './adapter-delegates.js'

/**
 * SQLite Database Adapter for Memory Journal using better-sqlite3 native driver
 */
export class DatabaseAdapter extends AdapterDelegates implements IDatabaseAdapter {
    createEntry(input: CreateEntryInput): JournalEntry {
        return this.entriesMgr.createEntry(input)
    }

    getEntryById(id: number, workspaceId?: string): JournalEntry | null {
        return this.entriesMgr.getEntryById(id, workspaceId)
    }

    getEntryHistory(id: number): EntryRevision[] {
        return this.entriesMgr.getEntryHistory(id)
    }

    getEntryByIdIncludeDeleted(id: number, workspaceId?: string): JournalEntry | null {
        return this.entriesMgr.getEntryByIdIncludeDeleted(id, workspaceId)
    }

    getEntriesByIds(ids: number[]): Map<number, JournalEntry> {
        return this.entriesMgr.getEntriesByIds(ids)
    }

    getEntriesByIdsWithImportance(
        ids: number[]
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }> {
        return this.entriesMgr.getEntriesByIdsWithImportance(ids)
    }

    calculateImportance(entryId: number): ImportanceResult {
        return this.entriesMgr.calculateImportance(entryId)
    }

    getRecentEntries(
        limit?: number,
        isPersonal?: boolean,
        sortBy?: 'timestamp' | 'importance',
        cursor?: string,
        includeArchived?: boolean,
        workspaceId?: string,
        projectNumber?: number,
        offset?: number
    ): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getRecentEntries(
            limit ?? 10,
            isPersonal,
            sortBy,
            cursor,
            includeArchived,
            workspaceId,
            projectNumber,
            offset
        )
    }

    getEntriesPage(offset: number, limit: number): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getEntriesPage(offset, limit)
    }

    getActiveEntryCount(workspaceId?: string): number {
        return this.entriesMgr.getActiveEntryCount(workspaceId)
    }

    updateEntry(
        id: number,
        updates: {
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
            isArchived?: boolean
            expectedVersion?: number
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
            workspaceId?: string
            targetWorkspaceId?: string
            sessionId?: string
        }
    ): JournalEntry | null {
        return this.entriesMgr.updateEntry(id, updates)
    }

    deleteEntry(id: number, permanent = false, workspaceId?: string): boolean {
        return this.executeInTransaction(() => {
            const success = this.entriesMgr.deleteEntry(id, permanent, workspaceId)
            if (success) {
                this.deleteVector(id)
            }
            return success
        })
    }

    updateAnchorStatus(id: number, status: AnchorStatus): void {
        this.entriesMgr.updateAnchorStatus(id, status)
    }

    getAnchorsByEntryId(entryId: number): Anchor[] {
        return this.entriesMgr.getAnchorsByEntryId(entryId)
    }

    restoreEntry(id: number, workspaceId?: string): boolean {
        return this.entriesMgr.restoreEntry(id, workspaceId)
    }

    getDeletedEntries(options?: {
        limit?: number
        offset?: number
        workspaceId?: string
    }): { entries: JournalEntry[]; count: number } {
        return this.entriesMgr.getDeletedEntries(options)
    }

    createEntries(inputs: CreateEntryInput[]): {
        created: JournalEntry[]
        errors: { index: number; error: Error }[]
    } {
        return this.entriesMgr.createEntries(inputs)
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
            isArchived?: boolean
            expectedVersion?: number
            workspaceId?: string
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
            sessionId?: string
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return this.entriesMgr.updateEntries(updates)
    }

    deleteEntries(
        ids: number[],
        permanent = false,
        workspaceId?: string
    ): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return this.executeInTransaction(() => {
            const result = this.entriesMgr.deleteEntries(ids, permanent, workspaceId)
            for (const id of result.deleted) {
                try {
                    this.deleteVector(id)
                } catch {
                    // Vectors failure shouldn't fail the entry deletion
                }
            }
            return result
        })
    }

    searchEntries(
        query: string,
        options?: {
            limit?: number
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
            sortBy?: 'timestamp' | 'importance'
            cursor?: string
            includeArchived?: boolean
            includeHighlights?: boolean
            fuzzy_match?: boolean
            auto_correct?: boolean
            workspaceId?: string
        }
    ): {
        entries: JournalEntry[]
        nextCursor?: string
        degraded?: boolean
        highlights?: { id: number; snippet: string }[]
        suggestions?: string[]
        correctedQuery?: string
    } {
        return this.entriesMgr.searchEntries(query, options)
    }

    getSearchFacets(
        query: string,
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
        return this.entriesMgr.getSearchFacets(query, options)
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
            sortBy?: 'timestamp' | 'importance'
            cursor?: string
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean } {
        return this.entriesMgr.searchByDateRange(startDate, endDate, options)
    }

    getStatistics(
        groupBy?: 'day' | 'week' | 'month' | 'year',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean,
        workspaceId?: string
    ): ReturnType<EntriesManager['getStatistics']> {
        return this.entriesMgr.getStatistics(
            groupBy,
            startDate,
            endDate,
            projectBreakdown,
            workspaceId
        )
    }

    getEntriesByProject(projectNumber: number, limit?: number, workspaceId?: string): JournalEntry[] {
        return this.entriesMgr.getEntriesByProject(projectNumber, limit, workspaceId)
    }

    getEntriesByIssue(issueNumber: number, limit?: number, workspaceId?: string): JournalEntry[] {
        return this.entriesMgr.getEntriesByIssue(issueNumber, limit, workspaceId)
    }

    getEntriesByPR(prNumber: number, limit?: number, workspaceId?: string): JournalEntry[] {
        return this.entriesMgr.getEntriesByPR(prNumber, limit, workspaceId)
    }

    getEntriesByWorkflowRun(
        workflowRunId: number,
        limit?: number,
        workspaceId?: string
    ): JournalEntry[] {
        return this.entriesMgr.getEntriesByWorkflowRun(workflowRunId, limit, workspaceId)
    }

    getEntriesBySession(sessionId: string, limit?: number, workspaceId?: string): JournalEntry[] {
        return this.entriesMgr.getEntriesBySession(sessionId, limit, workspaceId)
    }
}
