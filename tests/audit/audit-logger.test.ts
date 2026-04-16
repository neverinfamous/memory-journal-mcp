/**
 * Tests for src/audit/audit-logger.ts
 *
 * Validates the async-buffered JSONL audit writer:
 *   - Buffered writes and flush lifecycle
 *   - close() and graceful shutdown
 *   - recent() streaming tail-read
 *   - stderr mode
 *   - Log rotation
 *   - Non-throwing error resilience
 *   - Disabled mode
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFile, rm, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { logger as appLogger } from '../../src/utils/logger.js'
import type { AuditEntry, AuditConfig } from '../../src/audit/types.js'

/** Helper: create a unique temp directory */
async function createTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'mj-audit-test-'))
}

/** Helper: build a minimal valid AuditEntry */
function fakeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
    return {
        timestamp: new Date().toISOString(),
        requestId: 'req-001',
        tool: 'create_entry',
        category: 'write',
        scope: 'write',
        user: null,
        scopes: [],
        durationMs: 42,
        success: true,
        ...overrides,
    }
}

/** Helper: build a standard enabled config */
function enabledConfig(dir: string, overrides: Partial<AuditConfig> = {}): AuditConfig {
    return {
        enabled: true,
        logPath: join(dir, 'audit.jsonl'),
        redact: false,
        auditReads: false,
        maxSizeBytes: 0,
        ...overrides,
    }
}

describe('AuditLogger', () => {
    let dir: string

    beforeEach(async () => {
        dir = await createTempDir()
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('should write JSONL entries to file', async () => {
        const config = enabledConfig(dir)
        const logger = new AuditLogger(config)

        logger.log(fakeEntry({ tool: 'create_entry' }))
        logger.log(fakeEntry({ tool: 'update_entry' }))
        await logger.close()

        const content = await readFile(config.logPath, 'utf-8')
        const lines = content.trim().split('\n')

        expect(lines).toHaveLength(2)
        const first = JSON.parse(lines[0]!) as AuditEntry
        const second = JSON.parse(lines[1]!) as AuditEntry
        expect(first.tool).toBe('create_entry')
        expect(second.tool).toBe('update_entry')
    })

    it('should include args when redact is false', async () => {
        const config = enabledConfig(dir)
        const logger = new AuditLogger(config)

        logger.log(fakeEntry({ args: { content: 'test data' } }))
        await logger.close()

        const content = await readFile(config.logPath, 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry
        expect(entry.args).toEqual({ content: 'test data' })
    })

    it('should faithfully write entries with args undefined (redact mode)', async () => {
        const config = enabledConfig(dir, { redact: true })
        const logger = new AuditLogger(config)

        // The logger writes whatever it receives — redaction happens in interceptor
        logger.log(fakeEntry({ args: undefined }))
        await logger.close()

        const content = await readFile(config.logPath, 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry
        expect(entry.args).toBeUndefined()
        expect(entry.tool).toBe('create_entry')
    })

    it('should create parent directories if they do not exist', async () => {
        const logPath = join(dir, 'nested', 'deep', 'audit.jsonl')
        const logger = new AuditLogger({ ...enabledConfig(dir), logPath })

        logger.log(fakeEntry())
        await logger.close()

        const content = await readFile(logPath, 'utf-8')
        expect(content.trim()).toBeTruthy()
    })

    it('should not write when disabled', async () => {
        const config = enabledConfig(dir, { enabled: false })
        const logger = new AuditLogger(config)

        logger.log(fakeEntry())
        await logger.close()

        // File should not have been created
        await expect(readFile(config.logPath, 'utf-8')).rejects.toThrow()
    })

    it('should flush remaining entries on close', async () => {
        const config = enabledConfig(dir)
        const logger = new AuditLogger(config)

        // Log multiple entries rapidly
        for (let i = 0; i < 10; i++) {
            logger.log(fakeEntry({ requestId: `req-${String(i)}` }))
        }

        await logger.close()

        const content = await readFile(config.logPath, 'utf-8')
        const lines = content.trim().split('\n')
        expect(lines).toHaveLength(10)
    })

    it('should record error entries with success=false', async () => {
        const config = enabledConfig(dir)
        const logger = new AuditLogger(config)

        logger.log(
            fakeEntry({
                success: false,
                error: 'database is locked',
            })
        )
        await logger.close()

        const content = await readFile(config.logPath, 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry
        expect(entry.success).toBe(false)
        expect(entry.error).toBe('database is locked')
    })

    it('should preserve user=null when OAuth is not configured', async () => {
        const config = enabledConfig(dir)
        const logger = new AuditLogger(config)

        logger.log(fakeEntry({ user: null, scopes: [] }))
        await logger.close()

        const content = await readFile(config.logPath, 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry
        expect(entry.user).toBeNull()
        expect(entry.scopes).toEqual([])
    })

    describe('recent()', () => {
        it('should return the last N entries', async () => {
            const config = enabledConfig(dir)
            const logger = new AuditLogger(config)

            for (let i = 0; i < 20; i++) {
                logger.log(fakeEntry({ requestId: `req-${String(i)}` }))
            }
            await logger.flush()

            const recent = await logger.recent(5)
            expect(recent).toHaveLength(5)
            expect(recent[0]!.requestId).toBe('req-15')
            expect(recent[4]!.requestId).toBe('req-19')

            await logger.close()
        })

        it('should return empty array when file does not exist', async () => {
            const logPath = join(dir, 'nonexistent.jsonl')
            const logger = new AuditLogger({
                ...enabledConfig(dir),
                logPath,
            })

            const recent = await logger.recent()
            expect(recent).toEqual([])

            await logger.close()
        })

        it('should return all entries when fewer than count exist', async () => {
            const config = enabledConfig(dir)
            const logger = new AuditLogger(config)

            logger.log(fakeEntry({ requestId: 'only-one' }))
            await logger.flush()

            const recent = await logger.recent(50)
            expect(recent).toHaveLength(1)
            expect(recent[0]!.requestId).toBe('only-one')

            await logger.close()
        })
    })

    describe('stderr mode', () => {
        it('should write JSONL entries to stderr', async () => {
            const logger = new AuditLogger({
                ...enabledConfig(dir),
                logPath: 'stderr',
            })

            const chunks: string[] = []
            const originalWrite = process.stderr.write
            process.stderr.write = ((chunk: string) => {
                chunks.push(chunk)
                return true
            }) as typeof process.stderr.write

            try {
                logger.log(fakeEntry({ tool: 'create_entry' }))
                await logger.flush()

                expect(chunks.length).toBeGreaterThan(0)
                const entry = JSON.parse(chunks[0]!.trim()) as AuditEntry
                expect(entry.tool).toBe('create_entry')
            } finally {
                process.stderr.write = originalWrite
                await logger.close()
            }
        })

        it('should return empty from recent() in stderr mode', async () => {
            const logger = new AuditLogger({
                ...enabledConfig(dir),
                logPath: 'stderr',
            })

            // Suppress stderr output during test
            const originalWrite = process.stderr.write
            process.stderr.write = (() => true) as typeof process.stderr.write

            try {
                logger.log(fakeEntry())
                await logger.flush()

                const recent = await logger.recent()
                expect(recent).toEqual([])
            } finally {
                process.stderr.write = originalWrite
                await logger.close()
            }
        })

        it('should be case-insensitive for stderr sentinel', async () => {
            const logger = new AuditLogger({
                ...enabledConfig(dir),
                logPath: 'STDERR',
            })

            const chunks: string[] = []
            const originalWrite = process.stderr.write
            process.stderr.write = ((chunk: string) => {
                chunks.push(chunk)
                return true
            }) as typeof process.stderr.write

            try {
                logger.log(fakeEntry({ tool: 'backup_journal' }))
                await logger.flush()

                expect(chunks.length).toBeGreaterThan(0)
            } finally {
                process.stderr.write = originalWrite
                await logger.close()
            }
        })
    })

    describe('log rotation', () => {
        it('should rotate the log file when maxSizeBytes is exceeded', async () => {
            const config = enabledConfig(dir, { maxSizeBytes: 500 })
            const logger = new AuditLogger(config)

            // Write enough entries to exceed 500 bytes
            for (let i = 0; i < 10; i++) {
                logger.log(
                    fakeEntry({
                        tool: 'create_entry',
                        requestId: `rotation-${String(i)}`,
                    })
                )
            }
            await logger.flush()

            // Write more to trigger rotation on next flush
            for (let i = 10; i < 12; i++) {
                logger.log(
                    fakeEntry({
                        tool: 'create_entry',
                        requestId: `rotation-${String(i)}`,
                    })
                )
            }
            await logger.flush()

            // The rotated file should exist
            const rotatedPath = `${config.logPath}.1`
            const rotatedStat = await stat(rotatedPath)
            expect(rotatedStat.size).toBeGreaterThan(0)

            // The current log should be smaller than the rotated one
            const currentStat = await stat(config.logPath)
            expect(currentStat.size).toBeLessThan(rotatedStat.size)

            await logger.close()
        })

        it('should not rotate when maxSizeBytes is 0 (disabled)', async () => {
            const config = enabledConfig(dir, { maxSizeBytes: 0 })
            const logger = new AuditLogger(config)

            // Pre-write a large file
            await writeFile(config.logPath, 'x'.repeat(1024))

            logger.log(fakeEntry())
            await logger.flush()

            // No rotation should occur
            await expect(stat(`${config.logPath}.1`)).rejects.toThrow()

            await logger.close()
        })
    })

    describe('coverage edge cases', () => {
        it('should handle eager high-water flush', async () => {
            const config = enabledConfig(dir)
            const logger = new AuditLogger(config)

            for (let i = 0; i < 51; i++) {
                logger.log(fakeEntry({ requestId: `req-${String(i)}` }))
            }
            await logger.close()
            const content = await readFile(config.logPath, 'utf-8')
            const lines = content.trim().split('\n')
            expect(lines.length).toBe(51)
        })

        it('should catch write errors and unshift buffer without throwing', async () => {
            const logger = new AuditLogger({
                ...enabledConfig(dir),
                logPath: dir, // dir is a directory, so appendFile will throw EISDIR
            })

            const errorSpy = vi.spyOn(appLogger, 'error')

            try {
                logger.log(fakeEntry())
                await logger.flush()
                expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Write failed'), expect.any(Object))
            } finally {
                errorSpy.mockRestore()
                await logger.close()
            }
        })

        it('should handle concurrent flushes', async () => {
            const config = enabledConfig(dir)
            const logger = new AuditLogger(config)
            logger.log(fakeEntry())
            const p1 = logger.flush()
            const p2 = logger.flush()
            await Promise.all([p1, p2])
            await logger.close()
        })

        it('should cache dirEnsured', async () => {
            const config = enabledConfig(dir)
            const logger = new AuditLogger(config)
            logger.log(fakeEntry())
            await logger.flush()
            logger.log(fakeEntry())
            await logger.flush() // dirEnsured is true here
            await logger.close()
        })

        it('should handle recent() with completely unreadable file gracefully', async () => {
            const logger = new AuditLogger({ ...enabledConfig(dir), logPath: dir })
            const result = await logger.recent()
            expect(result).toEqual([])
            await logger.close()
        })

        it('should handle concurrent fast flushes on an empty buffer', async () => {
            const config = enabledConfig(dir)
            const logger = new AuditLogger(config)
            // Empty buffer check when active flush finishes
            const p = logger.flush()
            await logger.flush()
            await p
            await logger.close()
        })
    })
})
