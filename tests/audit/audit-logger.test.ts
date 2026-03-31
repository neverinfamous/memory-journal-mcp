/**
 * Tests for src/audit/audit-logger.ts
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AuditLogger, NullAuditLogger, createAuditLogger } from '../../src/audit/audit-logger.js'

// Helper: create a temp directory and return its path
function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mj-audit-test-'))
}

// Helper: read all lines from a file
function readLines(filePath: string): string[] {
    try {
        return fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    } catch {
        return []
    }
}

const MOCK_ENTRY = {
    timestamp: '2026-03-31T00:00:00.000Z',
    toolName: 'create_entry',
    scope: 'write' as const,
    durationMs: 42,
    inputTokens: 10,
    outputTokens: 20,
    isError: false,
    args: { content: 'test content' },
}

describe('AuditLogger', () => {
    const temps: string[] = []

    afterEach(() => {
        // Clean up temp dirs after each test
        for (const dir of temps) {
            try {
                fs.rmSync(dir, { recursive: true, force: true })
            } catch {
                // ignore cleanup errors
            }
        }
        temps.length = 0
    })

    it('creates the log file on first write', () => {
        const dir = makeTempDir()
        temps.push(dir)
        const logPath = path.join(dir, 'audit.jsonl')

        const logger = new AuditLogger({ logPath, redact: false })
        logger.log(MOCK_ENTRY)

        expect(fs.existsSync(logPath)).toBe(true)
    })

    it('creates nested directories if they do not exist', () => {
        const dir = makeTempDir()
        temps.push(dir)
        const logPath = path.join(dir, 'nested', 'deep', 'audit.jsonl')

        const logger = new AuditLogger({ logPath, redact: false })
        logger.log(MOCK_ENTRY)

        expect(fs.existsSync(logPath)).toBe(true)
    })

    it('writes valid JSONL entries', () => {
        const dir = makeTempDir()
        temps.push(dir)
        const logPath = path.join(dir, 'audit.jsonl')

        const logger = new AuditLogger({ logPath, redact: false })
        logger.log(MOCK_ENTRY)

        const lines = readLines(logPath)
        expect(lines).toHaveLength(1)

        const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
        expect(parsed['toolName']).toBe('create_entry')
        expect(parsed['scope']).toBe('write')
        expect(parsed['durationMs']).toBe(42)
        expect(parsed['args']).toEqual({ content: 'test content' })
    })

    it('appends multiple entries as separate JSONL lines', () => {
        const dir = makeTempDir()
        temps.push(dir)
        const logPath = path.join(dir, 'audit.jsonl')

        const logger = new AuditLogger({ logPath, redact: false })
        logger.log(MOCK_ENTRY)
        logger.log({ ...MOCK_ENTRY, toolName: 'update_entry', scope: 'admin' as const })
        logger.log({ ...MOCK_ENTRY, toolName: 'delete_entry', isError: true })

        const lines = readLines(logPath)
        expect(lines).toHaveLength(3)

        const parsed2 = JSON.parse(lines[1]!) as Record<string, unknown>
        expect(parsed2['toolName']).toBe('update_entry')
    })

    it('omits args when redact: true', () => {
        const dir = makeTempDir()
        temps.push(dir)
        const logPath = path.join(dir, 'audit.jsonl')

        const logger = new AuditLogger({ logPath, redact: true })
        logger.log(MOCK_ENTRY)

        const lines = readLines(logPath)
        const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
        expect(parsed['args']).toBeUndefined()
        expect(parsed['toolName']).toBe('create_entry')
    })

    it('includes all required fields in each entry', () => {
        const dir = makeTempDir()
        temps.push(dir)
        const logPath = path.join(dir, 'audit.jsonl')

        const logger = new AuditLogger({ logPath, redact: false })
        logger.log(MOCK_ENTRY)

        const lines = readLines(logPath)
        const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
        expect(parsed).toHaveProperty('timestamp')
        expect(parsed).toHaveProperty('toolName')
        expect(parsed).toHaveProperty('scope')
        expect(parsed).toHaveProperty('durationMs')
        expect(parsed).toHaveProperty('inputTokens')
        expect(parsed).toHaveProperty('outputTokens')
        expect(parsed).toHaveProperty('isError')
    })

    describe('log rotation', () => {
        it('rotates when file exceeds 10MB', () => {
            const dir = makeTempDir()
            temps.push(dir)
            const logPath = path.join(dir, 'audit.jsonl')

            // Pre-populate file to just over 10MB
            const ELEVEN_MB = 11 * 1024 * 1024
            fs.writeFileSync(logPath, 'x'.repeat(ELEVEN_MB))

            const logger = new AuditLogger({ logPath, redact: false })
            logger.log(MOCK_ENTRY)

            // Original should be archived as .1
            expect(fs.existsSync(`${logPath}.1`)).toBe(true)
            // New file should now just contain the fresh entry
            const lines = readLines(logPath)
            expect(lines).toHaveLength(1)
        })

        it('shifts archives in order (.4→.5, .3→.4, …)', () => {
            const dir = makeTempDir()
            temps.push(dir)
            const logPath = path.join(dir, 'audit.jsonl')

            // Pre-create archives .1 through .4
            for (let i = 1; i <= 4; i++) {
                fs.writeFileSync(`${logPath}.${i}`, `archive-${i}`)
            }

            // Make current file over 10MB
            fs.writeFileSync(logPath, 'x'.repeat(11 * 1024 * 1024))

            const logger = new AuditLogger({ logPath, redact: false })
            logger.log(MOCK_ENTRY)

            // .4 → .5
            expect(fs.readFileSync(`${logPath}.5`, 'utf8')).toBe('archive-4')
            // .3 → .4
            expect(fs.readFileSync(`${logPath}.4`, 'utf8')).toBe('archive-3')
            // current → .1
            expect(fs.existsSync(`${logPath}.1`)).toBe(true)
        })

        it('does not rotate when file is under 10MB', () => {
            const dir = makeTempDir()
            temps.push(dir)
            const logPath = path.join(dir, 'audit.jsonl')

            // Write a small file
            fs.writeFileSync(logPath, 'small content\n')

            const logger = new AuditLogger({ logPath, redact: false })
            logger.log(MOCK_ENTRY)

            // No archive should be created
            expect(fs.existsSync(`${logPath}.1`)).toBe(false)
        })
    })
})

describe('NullAuditLogger', () => {
    it('is a no-op and never throws', () => {
        const logger = new NullAuditLogger()
        expect(() => logger.log(MOCK_ENTRY)).not.toThrow()
    })
})

describe('createAuditLogger', () => {
    it('returns NullAuditLogger when logPath is undefined', () => {
        const logger = createAuditLogger(undefined, false)
        expect(logger).toBeInstanceOf(NullAuditLogger)
    })

    it('returns AuditLogger when logPath is provided', () => {
        const dir = makeTempDir()
        const logPath = path.join(dir, 'audit.jsonl')
        const logger = createAuditLogger(logPath, false)
        expect(logger).toBeInstanceOf(AuditLogger)
        // Clean up
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    })
})
