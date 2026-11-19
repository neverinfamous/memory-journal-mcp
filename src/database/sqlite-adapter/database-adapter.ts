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
import { getMirrorOrigins } from './entries/mirror-origins.js'
import { logger } from '../../utils/logger.js'

/**
 * SQLite Database Adapter for Memory Journal using better-sqlite3 native driver
 */
export class DatabaseAdapter extends AdapterDelegates implements IDatabaseAdapter {
    createEntry(input: CreateEntryInput): JournalEntry {
        return this.entriesMgr.createEntry(input)
    }

    /** Team DB: team entry ID -> origin personal ID for mirrored rows (empty when unsupported). */
    getMirrorOrigins(entryIds: number[]): Map<number, number> {
        return getMirrorOrigins(this.connection.getNativeDb(), entryIds)
    }

    getEntryById(id: number, workspaceId?: string): JournalEntry | null {
        return this.entriesMgr.getEntryById(id, workspaceId)
    }

    getEntryHistory(id: number, workspaceId?: string): EntryRevision[] {
        return this.entriesMgr.getEntryHistory(id, workspaceId)
    }

    getEntryByIdIncludeDeleted(id: number, workspaceId?: string): JournalEntry | null {
        return this.entriesMgr.getEntryByIdIncludeDeleted(id, workspaceId)
    }

    getEntriesByIds(ids: number[], workspaceId?: string): Map<number, JournalEntry> {
        return this.entriesMgr.getEntriesByIds(ids, workspaceId)
    }

    getEntriesByIdsWithImportance(
        ids: number[],
        workspaceId?: string
    ): Map<number, { entry: JournalEntry; importance: ImportanceResult }> {
        return this.entriesMgr.getEntriesByIdsWithImportance(ids, workspaceId)
    }

    getImportanceScoresByIds(
        entryIds: number[],
        workspaceId?: string
    ): Map<number, ImportanceResult> {
        return this.entriesMgr.getImportanceScoresByIds(entryIds, workspaceId)
    }

    calculateImportance(entryId: number, workspaceId?: string): ImportanceResult | null {
        return this.entriesMgr.calculateImportance(entryId, workspaceId)
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

    getEntriesPage(
        offset: number,
        limit: number,
        workspaceId = 'default',
        projectNumber?: number
    ): { entries: JournalEntry[]; nextCursor?: string } {
        return this.entriesMgr.getEntriesPage(offset, limit, 'desc', workspaceId, projectNumber)
    }

    getActiveEntryCount(workspaceId?: string, projectNumber?: number): number {
        return this.entriesMgr.getActiveEntryCount(workspaceId, projectNumber)
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
            sessionId?: string | null
            anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[]
        }
    ): JournalEntry | null {
        return this.entriesMgr.updateEntry(id, updates)
    }

    deleteEntry(id: number, permanent = false, workspaceId?: string): { success: boolean; warning?: string } {
        return this.executeInTransaction(() => {
            const success = this.entriesMgr.deleteEntry(id, permanent, workspaceId)
            if (!success) return { success: false }
            try {
                this.deleteVector(id)
                return { success: true }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                logger.warning('Failed to delete vector for deleted entry', {
                    module: 'SqliteAdapter',
                    entryId: id,
                    error: message,
                })
                return { success: true, warning: `Vector delete failed: ${message}` }
            }
        })
    }

    updateAnchorStatus(
        id: number,
        status: AnchorStatus,
        workspaceId?: string,
        projectNumber?: number
    ): boolean {
        return this.entriesMgr.updateAnchorStatus(id, status, workspaceId, projectNumber)
    }

    getAnchorsByEntryId(entryId: number, workspaceId?: string): Anchor[] {
        return this.entriesMgr.getAnchorsByEntryId(entryId, workspaceId)
    }

    getAnchorsByEntryIds(entryIds: number[], workspaceId?: string): Map<number, Anchor[]> {
        return this.entriesMgr.getAnchorsByEntryIds(entryIds, workspaceId)
    }

    getEntriesByIdsIncludeDeleted(ids: number[], workspaceId?: string): Map<number, JournalEntry> {
        return this.entriesMgr.getEntriesByIdsIncludeDeleted(ids, workspaceId)
    }

    restoreEntry(id: number, workspaceId?: string): boolean {
        return this.entriesMgr.restoreEntry(id, workspaceId)
    }

    getDeletedEntries(options?: {
        limit?: number
        offset?: number
        workspaceId?: string
        projectNumber?: number
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
            anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[]
            trustScore?: number
            impactScore?: number
            validationStatus?: 'passed' | 'failed' | 'none'
            sessionId?: string | null
            targetWorkspaceId?: string
        }[]
    ): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] } {
        return this.entriesMgr.updateEntries(updates)
    }

    deleteEntries(
        ids: number[],
        permanent = false,
        workspaceId?: string
    ): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[]; warning?: string } {
        return this.executeInTransaction(() => {
            const result = this.entriesMgr.deleteEntries(ids, permanent, workspaceId)
            const vectorFailures: string[] = []
            if (result.deleted.length > 0) {
                try {
                    this.deleteVectors(result.deleted)
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error)
                    // A vector failure must not fail the entry deletion, but leaves orphans to reconcile
                    logger.warning(`Vector batch delete failed: ${message}`, {
                        module: 'DatabaseAdapter',
                        count: result.deleted.length,
                    })
                    vectorFailures.push(message)
                }
            }
            if (vectorFailures.length === 0) return result
            return {
                ...result,
                warning: `Vector delete failed: ${vectorFailures.join('; ')}`,
            }
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
            excludeTags?: string[]
            entryType?: EntryType
            startDate?: string
            endDate?: string
            sortBy?: 'timestamp' | 'importance' | 'blended'
            cursor?: string
            includeArchived?: boolean
            includeHighlights?: boolean
            fuzzy_match?: boolean
            auto_correct?: boolean
            workspaceId?: string
            offset?: number
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
            excludeTags?: string[]
            entryType?: EntryType
            startDate?: string
            endDate?: string
            includeArchived?: boolean
            workspaceId?: string
        }
    ): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[]; degraded?: boolean } {
        return this.entriesMgr.getSearchFacets(query, options)
    }

    searchByDateRange(
        startDate: string,
        endDate: string,
        options?: {
            entryType?: EntryType
            tags?: string[]
            excludeTags?: string[]
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
            workflowRunId?: number
            limit?: number
            sortBy?: 'timestamp' | 'importance' | 'blended'
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
        workspaceId?: string,
        projectNumber?: number
    ): ReturnType<EntriesManager['getStatistics']> {
        return this.entriesMgr.getStatistics(
            groupBy,
            startDate,
            endDate,
            projectBreakdown,
            workspaceId,
            projectNumber
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
