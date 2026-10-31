import * as fs from 'node:fs'
import type { NativeConnectionManager } from './native-connection.js'
import type { IDatabaseAdapter } from '../core/interfaces.js'
import type { BackupManager } from './backup.js'

export class HealthOperations {
    constructor(
        private connection: NativeConnectionManager,
        private backupMgr: BackupManager
    ) {}

    getHealthStatus(): ReturnType<IDatabaseAdapter['getHealthStatus']> {
        // Safe query execution through the connection interface
        const dbPath = this.connection.getDbPath()

        let sizeBytes = 0
        try {
            const stats = fs.statSync(dbPath)
            sizeBytes = stats.size
        } catch {
            // File may not exist on disk yet
        }

        // Combined health counts in a single query (batch instead of 4 serial queries)
        const countsResult = this.connection.exec(`
            SELECT
                (SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL) AS entry_count,
                (SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NOT NULL) AS deleted_count,
                (SELECT COUNT(*) FROM relationships) AS rel_count,
                (SELECT COUNT(*) FROM tags) AS tag_count
        `)

        const row = countsResult[0]?.values[0]
        const entryCount = (row?.[0] as number) ?? 0
        const deletedEntryCount = (row?.[1] as number) ?? 0
        const relationshipCount = (row?.[2] as number) ?? 0
        const tagCount = (row?.[3] as number) ?? 0

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
