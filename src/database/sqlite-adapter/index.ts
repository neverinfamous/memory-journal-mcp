import type {
    JournalEntry,
    Tag,
    Relationship,
    EntryType,
    RelationshipType,
    ImportanceResult,
} from '../../types/index.js'
import type { CreateEntryInput } from '../core/schema.js'
import type { IDatabaseAdapter, QueryResult } from '../core/interfaces.js'

import { NativeConnectionManager } from './native-connection.js'
import { TagsManager } from './tags.js'
import { EntriesManager } from './entries/index.js'
import { RelationshipsManager } from './relationships.js'
import { BackupManager } from './backup.js'
import * as fs from 'node:fs'

/**
 * SQLite Database Adapter for Memory Journal using better-sqlite3 native driver
 */
export class DatabaseAdapter implements IDatabaseAdapter {
    private connection: NativeConnectionManager
    private tagsMgr: TagsManager
    private entriesMgr: EntriesManager
    private relationshipsMgr: RelationshipsManager
    private backupMgr: BackupManager

    constructor(dbPath: string) {
        this.connection = new NativeConnectionManager(dbPath)
        this.tagsMgr = new TagsManager(this.connection)
        this.entriesMgr = new EntriesManager(this.connection, this.tagsMgr)
        this.relationshipsMgr = new RelationshipsManager(this.connection, this.entriesMgr)
        this.backupMgr = new BackupManager(this.connection)
    }

    async initialize(): Promise<void> {
        return this.connection.initialize()
    }

    applyTeamSchema(): void {
        this.connection.applyTeamSchema()
    }

    flushSave(): void {
        this.connection.flushSave()
    }

    close(): void {
        this.connection.close()
    }

    createEntry(input: CreateEntryInput): JournalEntry {
        return this.entriesMgr.createEntry(input)
    }

    getEntryById(id: number): JournalEntry | null {
        return this.entriesMgr.getEntryById(id)
    }

    getEntryByIdIncludeDeleted(id: number): JournalEntry | null {
        return this.entriesMgr.getEntryByIdIncludeDeleted(id)
    }

    calculateImportance(entryId: number): ImportanceResult {
        return this.entriesMgr.calculateImportance(entryId)
    }

    getRecentEntries(limit?: number, isPersonal?: boolean): JournalEntry[] {
        return this.entriesMgr.getRecentEntries(limit ?? 10, isPersonal)
    }

    getEntriesPage(offset: number, limit: number): JournalEntry[] {
        return this.entriesMgr.getEntriesPage(offset, limit)
    }

    getActiveEntryCount(): number {
        return this.entriesMgr.getActiveEntryCount()
    }

    updateEntry(
        id: number,
        updates: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
        }
    ): JournalEntry | null {
        return this.entriesMgr.updateEntry(id, updates)
    }

    deleteEntry(id: number, permanent = false): boolean {
        return this.entriesMgr.deleteEntry(id, permanent)
    }

    searchEntries(
        query: string,
        options?: {
            limit?: number
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
        }
    ): JournalEntry[] {
        return this.entriesMgr.searchEntries(query, options)
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
        }
    ): JournalEntry[] {
        return this.entriesMgr.searchByDateRange(startDate, endDate, options)
    }

    getStatistics(
        groupBy?: 'day' | 'week' | 'month',
        startDate?: string,
        endDate?: string,
        projectBreakdown?: boolean
    ): ReturnType<EntriesManager['getStatistics']> {
        return this.entriesMgr.getStatistics(groupBy, startDate, endDate, projectBreakdown)
    }

    getTagsForEntry(entryId: number): string[] {
        return this.tagsMgr.getTagsForEntry(entryId)
    }

    listTags(): Tag[] {
        return this.tagsMgr.listTags()
    }

    mergeTags(
        sourceTag: string,
        targetTag: string
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        return this.tagsMgr.mergeTags(sourceTag, targetTag)
    }

    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string
    ): Relationship {
        return this.relationshipsMgr.linkEntries(fromEntryId, toEntryId, relationshipType, description)
    }

    getRelationships(entryId: number): Relationship[] {
        return this.relationshipsMgr.getRelationships(entryId)
    }

    getBackupsDir(): string {
        return this.connection.getBackupsDir()
    }

    async exportToFile(backupName?: string): Promise<{ filename: string; path: string; sizeBytes: number }> {
        return this.backupMgr.exportToFile(backupName)
    }

    listBackups(): { filename: string; path: string; sizeBytes: number; createdAt: string }[] {
        return this.backupMgr.listBackups()
    }

    deleteOldBackups(keepCount: number): { deleted: string[]; kept: number } {
        return this.backupMgr.deleteOldBackups(keepCount)
    }

    async restoreFromFile(filename: string): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        return this.backupMgr.restoreFromFile(filename)
    }

    getHealthStatus(): ReturnType<IDatabaseAdapter['getHealthStatus']> {
        // Safe query execution through interface rather than direct sql.js
        const dbPath = this.connection.getDbPath()

        let sizeBytes = 0
        try {
            const stats = fs.statSync(dbPath)
            sizeBytes = stats.size
        } catch {
            // File may not exist on disk yet
        }

        const entryResult = this.connection.exec('SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL')
        const deletedResult = this.connection.exec('SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NOT NULL')
        const relResult = this.connection.exec('SELECT COUNT(*) FROM relationships')
        const tagResult = this.connection.exec('SELECT COUNT(*) FROM tags')

        const entryCount = (entryResult[0]?.values[0]?.[0] as number) ?? 0
        const deletedEntryCount = (deletedResult[0]?.values[0]?.[0] as number) ?? 0
        const relationshipCount = (relResult[0]?.values[0]?.[0] as number) ?? 0
        const tagCount = (tagResult[0]?.values[0]?.[0] as number) ?? 0

        const backups = this.listBackups()
        const lastBackup = backups[0] ?? null

        return {
            database: {
                path: dbPath,
                sizeBytes,
                entryCount,
                deletedEntryCount,
                relationshipCount,
                tagCount,
            },
            backups: {
                directory: this.getBackupsDir(),
                count: backups.length,
                lastBackup: lastBackup
                    ? {
                          filename: lastBackup.filename,
                          createdAt: lastBackup.createdAt,
                          sizeBytes: lastBackup.sizeBytes,
                      }
                    : null,
            },
        }
    }

    pragma(command: string): void {
        this.connection.pragma(command)
    }

    getRawDb(): unknown {
        return this.connection.getRawDb()
    }

    executeRawQuery(sql: string, params?: unknown[]): QueryResult[] {
        return this.connection.exec(sql, params)
    }
}
