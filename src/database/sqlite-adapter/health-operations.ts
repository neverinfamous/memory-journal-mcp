import * as fs from 'node:fs'
import { logger } from '../../utils/logger.js'
import type { NativeConnectionManager } from './native-connection.js'
import type { IDatabaseAdapter } from '../core/interfaces.js'
import type { BackupManager } from './backup.js'

export class HealthOperations {
    constructor(
        private connection: NativeConnectionManager,
        private backupMgr: BackupManager
    ) {}

    private readDbFileSizeBytes(dbPath: string): number {
        if (dbPath === ':memory:') return 0
        let sizeBytes = 0
        try {
            sizeBytes = fs.statSync(dbPath).size
            try {
                sizeBytes += fs.statSync(`${dbPath}-wal`).size
            } catch {
                // WAL file may not exist or may already be checkpointed
            }
        } catch (error) {
            // File may not exist on disk yet
            logger.debug('Database file size unavailable', {
                module: 'HealthOperations',
                error: error instanceof Error ? error.message : String(error),
            })
        }
        return sizeBytes
    }

    private readHealthCounts(): {
        entryCount: number
        deletedEntryCount: number
        relationshipCount: number
        tagCount: number
    } {
        // Combined health counts in a single query (batch instead of 4 serial queries)
        const countSql = `
            SELECT
                (SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL) AS entry_count,
                (SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NOT NULL) AS deleted_count,
                (SELECT COUNT(*) FROM relationships) AS rel_count,
                (SELECT COUNT(*) FROM tags) AS tag_count
        `
        const nativeDb = this.connection.getNativeDb?.()
        if (nativeDb !== undefined) {
            const row = nativeDb.prepare(countSql).get() as
                | { entry_count?: number; deleted_count?: number; rel_count?: number; tag_count?: number }
                | undefined
            return {
                entryCount: row?.entry_count ?? 0,
                deletedEntryCount: row?.deleted_count ?? 0,
                relationshipCount: row?.rel_count ?? 0,
                tagCount: row?.tag_count ?? 0,
            }
        }
        const row = this.connection.exec(countSql)[0]?.values[0]
        return {
            entryCount: (row?.[0] as number) ?? 0,
            deletedEntryCount: (row?.[1] as number) ?? 0,
            relationshipCount: (row?.[2] as number) ?? 0,
            tagCount: (row?.[3] as number) ?? 0,
        }
    }

    getHealthStatus(): ReturnType<IDatabaseAdapter['getHealthStatus']> {
        const dbPath = this.connection.getDbPath()
        const sizeBytes = this.readDbFileSizeBytes(dbPath)
        const { entryCount, deletedEntryCount, relationshipCount, tagCount } = this.readHealthCounts()
        const backups = this.backupMgr.listBackups()
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
                directory: this.connection.getBackupsDir(),
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
}
