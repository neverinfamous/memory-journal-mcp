import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import { assertNoPathTraversal } from '../../utils/security-utils.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import type { IDatabaseConnection } from '../core/interfaces.js'

/** Maximum length for user-supplied backup names after sanitization */
const MAX_BACKUP_NAME_LENGTH = 50

export class BackupManager {
    constructor(private ctx: IDatabaseConnection) {}

    async exportToFile(backupName?: string): Promise<{ filename: string; path: string; sizeBytes: number }> {
        const backupsDir = this.ctx.getBackupsDir()

        if (backupName) {
            assertNoPathTraversal(backupName)
        }

        if (!fs.existsSync(backupsDir)) {
            await fs.promises.mkdir(backupsDir, { recursive: true })
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const sanitizedName = backupName
            ? backupName.replace(/[/\\:*?"<>|]/g, '_').slice(0, MAX_BACKUP_NAME_LENGTH)
            : `backup_${timestamp}`
        const filename = `${sanitizedName}.db`
        const backupPath = path.join(backupsDir, filename)

        try {
            this.ctx.pragma('wal_checkpoint(TRUNCATE)')
        } catch (checkpointErr) {
            logger.debug('WAL checkpoint skipped', {
                module: 'SqliteAdapter',
                operation: 'exportToFile',
                error: checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr),
            })
        }
        await fs.promises.copyFile(this.ctx.getDbPath(), backupPath)

        const stats = await fs.promises.stat(backupPath)

        logger.info('Backup created', {
            module: 'SqliteAdapter',
            operation: 'exportToFile',
            context: { backupPath, sizeBytes: stats.size },
        })

        return { filename, path: backupPath, sizeBytes: stats.size }
    }

    listBackups(): { filename: string; path: string; sizeBytes: number; createdAt: string }[] {
        const backupsDir = this.ctx.getBackupsDir()

        if (!fs.existsSync(backupsDir)) {
            return []
        }

        const files = fs.readdirSync(backupsDir)
        const backups: { filename: string; path: string; sizeBytes: number; createdAt: string }[] = []

        for (const filename of files) {
            if (!filename.endsWith('.db')) continue

            const filePath = path.join(backupsDir, filename)
            try {
                const stats = fs.statSync(filePath)
                if (stats.isFile()) {
                    backups.push({
                        filename,
                        path: filePath,
                        sizeBytes: stats.size,
                        createdAt: stats.birthtime.toISOString(),
                    })
                }
            } catch {
                // Skip files that can't be read
            }
        }

        backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        return backups
    }

    deleteOldBackups(keepCount: number): { deleted: string[]; kept: number } {
        const backups = this.listBackups()

        if (keepCount < 1 || Number.isNaN(keepCount)) {
            throw new ValidationError('keepCount must be at least 1')
        }

        const toKeep = backups.slice(0, keepCount)
        const toDelete = backups.slice(keepCount)
        const deleted: string[] = []

        for (const backup of toDelete) {
            try {
                fs.unlinkSync(backup.path)
                deleted.push(backup.filename)
            } catch {
                // Skip files that can't be deleted
            }
        }

        logger.info('Old backups cleaned up', {
            module: 'SqliteAdapter',
            operation: 'deleteOldBackups',
            context: { kept: toKeep.length, deleted: deleted.length },
        })

        return { deleted, kept: toKeep.length }
    }

    async restoreFromFile(filename: string): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        assertNoPathTraversal(filename)

        const backupsDir = this.ctx.getBackupsDir()
        const backupPath = path.join(backupsDir, filename)

        if (!fs.existsSync(backupPath)) {
            throw new ResourceNotFoundError('Backup', filename)
        }

        const currentCountResult = this.ctx.exec('SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL')
        const previousEntryCount = (currentCountResult[0]?.values[0]?.[0] as number) ?? 0

        await this.exportToFile(`pre_restore_${new Date().toISOString().replace(/[:.]/g, '-')}`)

        // Close old DB via manager
        this.ctx.closeDbBeforeRestore()

        // Native better-sqlite3 connection
        await fs.promises.copyFile(backupPath, this.ctx.getDbPath())
        
        // Re-initialize the native connection via dynamic import to avoid static dependency
        const DatabaseAdapter = (await import('better-sqlite3').then((m) => m.default)) as new (
            path: string
        ) => unknown
        const newDb = new DatabaseAdapter(this.ctx.getDbPath())
        this.ctx.setDbAndInitialized(newDb)

        const newCountResult = this.ctx.exec('SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL')
        const newEntryCount = (newCountResult[0]?.values[0]?.[0] as number) ?? 0

        logger.info('Database restored from backup', {
            module: 'SqliteAdapter',
            operation: 'restoreFromFile',
            context: { backupPath, previousEntryCount, newEntryCount },
        })

        return { restoredFrom: filename, previousEntryCount, newEntryCount }
    }
}
