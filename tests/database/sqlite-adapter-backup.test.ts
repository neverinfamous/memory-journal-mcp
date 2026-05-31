import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('Backup Manager Edge Cases', () => {
    const testDir = './test-backup-edge-cases'
    const testDbPath = `${testDir}/test-db.db`
    let db: DatabaseAdapter

    beforeAll(async () => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
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

        // Should succeed because lock is stale and gets overridden
        const result = await db.restoreFromFile(backup.filename)
        expect(result.restoredFrom).toBe(backup.filename)
    })

    it('should rollback on restore failure', async () => {
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
})
