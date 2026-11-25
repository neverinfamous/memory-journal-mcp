import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('Backup Manager Edge Cases', () => {
    const testDir = './test-backup-edge-cases'
    const testDbPath = `${testDir}/test-db.db`
    let db: DatabaseAdapter

    beforeAll(async () => {
        try {
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true })
            }
        } catch {
            // ignore
        }
        fs.mkdirSync(testDir, { recursive: true })
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true })
            }
        } catch {
            // ignore
        }
    })

    it('should throw on path traversal in restore', async () => {
        await expect(db.restoreFromFile('../outside.db')).rejects.toThrow('Path traversal')
    })

    it('should throw on symlink restore', async () => {
        const backupsDir = path.join(testDir, 'backups')
        if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true })

        const realFile = path.join(backupsDir, 'real.db')
        const symlink = path.join(backupsDir, 'sym.db')

        fs.writeFileSync(realFile, 'dummy')
        try {
            fs.symlinkSync('real.db', symlink)
        } catch (e) {
            // Symlinks might require admin privileges on Windows. If it fails, we skip the assertion.
            return
        }

        await expect(db.restoreFromFile('sym.db')).rejects.toThrow('Symlinks are not allowed')
    })

    it('should handle stale lock with expired timestamp', async () => {
        const backup = await db.exportToFile('stale-test')
        const lockDir = `${testDbPath}.lock.d`
        const lockFile = path.join(lockDir, 'lock.json')

        fs.mkdirSync(lockDir, { recursive: true })
        // Create an expired lock (40 seconds old)
        fs.writeFileSync(
            lockFile,
            JSON.stringify({ pid: 999999, timestamp: Date.now() - 40000, nonce: '123' })
        )
        
        // Wait for Windows to fully release the file handle
        await new Promise((r) => setTimeout(r, 100))

        // Should succeed because lock is stale and gets overridden
        const result = await db.restoreFromFile(backup.filename)
        expect(result.restoredFrom).toBe(backup.filename)
    })

    it('should reclaim a leftover lock owned by this process during maintenance', async () => {
        const backup = await db.exportToFile('self-lock')
        const lockDir = `${testDbPath}.lock.d`
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(
            lockFile,
            JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce: 'self' })
        )

        const runtime = new ServerRuntime()
        await runtime.maintenanceManager.acquireMaintenanceLock()
        try {
            const result = await db.restoreFromFile(backup.filename, runtime)
            expect(result.restoredFrom).toBe(backup.filename)
        } finally {
            runtime.maintenanceManager.releaseMaintenanceLock()
        }
    })

    it('should rollback on restore failure', async () => {
        const lockDir = `${testDbPath}.lock.d`
        if (fs.existsSync(lockDir)) {
            try {
                const lockFile = path.join(lockDir, 'lock.json')
                // Overwrite lock with stale timestamp in case Windows EBUSY prevents rmSync
                fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, timestamp: 0, nonce: '123' }))
                fs.rmSync(lockDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
            } catch {
                // ignore cleanup errors in test
            }
        }

        const backup = await db.exportToFile('rollback-test')

        // Let's force an error during restore by mocking fs.promises.rename
        const originalRename = fs.promises.rename
        const originalCopy = fs.promises.copyFile
        let triggered = false

        // Override copyFile to fail during the atomic rename fallback
        fs.promises.copyFile = async (src: fs.PathLike, dest: fs.PathLike, flags?: number) => {
            if (src.toString().includes('restore_tmp') && dest.toString().includes('test-db.db')) {
                triggered = true
                throw new Error('Simulated rename fallback error')
            }
            return originalCopy(src, dest, flags)
        }
        fs.promises.rename = async (src: fs.PathLike, dest: fs.PathLike) => {
            if (dest.toString().includes('test-db.db')) {
                throw new Error('Simulated rename error')
            }
            return originalRename(src, dest)
        }

        try {
            await expect(db.restoreFromFile(backup.filename)).rejects.toThrow(
                'Simulated rename fallback error'
            )
            expect(triggered).toBe(true)

            // Check that database still works (rollback was successful)
            expect(() => db.getActiveEntryCount()).not.toThrow()
        } finally {
            fs.promises.rename = originalRename
            fs.promises.copyFile = originalCopy
        }
    })

    it('should not leave orphaned .tmp, .tmp-wal, or .tmp-shm files after exportToFile', async () => {
        await db.exportToFile('clean-sidecar-test')
        const backupsDir = path.join(testDir, 'backups')
        const leftoverTmp = fs
            .readdirSync(backupsDir)
            .filter((name) => /\.tmp(?:-(?:wal|shm))?$/i.test(name))
        expect(leftoverTmp).toEqual([])
    })

    it('should sweep stale .tmp* files and exclude pre-prune-* from deleteOldBackups keepCount', () => {
        const backupsDir = path.join(testDir, 'backups')
        if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true })

        const staleTmp = path.join(backupsDir, 'stale.db.123.tmp-shm')
        const freshTmp = path.join(backupsDir, 'fresh.db.123.tmp-wal')
        const prePruneFile = path.join(backupsDir, 'pre-prune-keep.db')
        const reg1 = path.join(backupsDir, 'backup_keep_newest.db')
        const reg2 = path.join(backupsDir, 'backup_delete_oldest.db')

        fs.writeFileSync(staleTmp, 'stale')
        const oldDate = new Date(Date.now() - 30 * 60 * 1000)
        fs.utimesSync(staleTmp, oldDate, oldDate)
        fs.writeFileSync(freshTmp, 'fresh')
        fs.writeFileSync(prePruneFile, 'preprune')
        fs.writeFileSync(reg2, 'old')
        const earlier = new Date(Date.now() - 10_000)
        fs.utimesSync(reg2, earlier, earlier)
        fs.writeFileSync(reg1, 'new')

        const cleanupRes = db.deleteOldBackups(1)
        expect(fs.existsSync(staleTmp)).toBe(false)
        expect(fs.existsSync(freshTmp)).toBe(true)
        expect(fs.existsSync(prePruneFile)).toBe(true)
        expect(cleanupRes.deleted).toContain('backup_delete_oldest.db')
        expect(cleanupRes.deleted).not.toContain('pre-prune-keep.db')

        for (const f of [freshTmp, prePruneFile, reg1]) {
            if (fs.existsSync(f)) fs.unlinkSync(f)
        }
    })
})
