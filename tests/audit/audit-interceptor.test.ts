/**
 * Tests for src/audit/interceptor.ts
 *
 * Validates the audit interceptor's scope-based filtering,
 * error handling, timing, redaction, and token estimation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { createAuditInterceptor } from '../../src/audit/interceptor.js'
import type { AuditEntry, AuditConfig } from '../../src/audit/types.js'

async function createTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'mj-audit-int-test-'))
}

function config(dir: string, overrides: Partial<AuditConfig> = {}): AuditConfig {
    return {
        enabled: true,
        logPath: join(dir, 'audit.jsonl'),
        redact: false,
        auditReads: false,
        maxSizeBytes: 0,
        ...overrides,
    }
}

describe('AuditInterceptor', () => {
    let dir: string
    let logger: AuditLogger

    beforeEach(async () => {
        dir = await createTempDir()
        logger = new AuditLogger(config(dir))
    })

    afterEach(async () => {
        await logger.close()
        await rm(dir, { recursive: true, force: true })
    })

    it('should skip read-only tools by default', async () => {
        const interceptor = createAuditInterceptor(logger)
        // create_entry is in the 'core' group which maps to 'read' scope
        // The scope-map resolves core group tools to 'read'
        // We need to use a tool name that resolves to 'read' scope
        const result = await interceptor.around(
            'search_entries',
            { query: 'test' },
            async () => ({ entries: [] })
        )

        expect(result).toEqual({ entries: [] })
        await logger.flush()

        // No audit file should be created for read-only tools
        await expect(readFile(join(dir, 'audit.jsonl'), 'utf-8')).rejects.toThrow()
    })

    it('should log write-scoped tool execution', async () => {
        // 'github' group maps to 'write' scope in the scope map
        const interceptor = createAuditInterceptor(logger)
        await interceptor.around(
            'create_github_issue_with_entry',
            { title: 'Test issue' },
            async () => ({ success: true, issueNumber: 1 })
        )
        await logger.flush()

        const content = await readFile(join(dir, 'audit.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.tool).toBe('create_github_issue_with_entry')
        expect(entry.category).toBe('write')
        expect(entry.scope).toBe('write')
        expect(entry.success).toBe(true)
        expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should log admin tool execution with category=admin', async () => {
        // 'admin' group maps to 'admin' scope
        const interceptor = createAuditInterceptor(logger)
        await interceptor.around(
            'mj_execute_code',
            { code: 'mj.core.getRecentEntries()' },
            async () => ({ result: 1 })
        )
        await logger.flush()

        const content = await readFile(join(dir, 'audit.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.tool).toBe('mj_execute_code')
        expect(entry.category).toBe('admin')
        expect(entry.scope).toBe('admin')
    })

    it('should set user=null when no OAuth context', async () => {
        const interceptor = createAuditInterceptor(logger)
        await interceptor.around(
            'create_github_issue_with_entry',
            { title: 'test' },
            async () => ({ success: true })
        )
        await logger.flush()

        const content = await readFile(join(dir, 'audit.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.user).toBeNull()
        expect(entry.scopes).toEqual([])
    })

    it('should capture errors and re-throw', async () => {
        const interceptor = createAuditInterceptor(logger)

        await expect(
            interceptor.around(
                'create_github_issue_with_entry',
                { title: 'bad' },
                async () => {
                    throw new Error('GitHub API error')
                }
            )
        ).rejects.toThrow('GitHub API error')

        await logger.flush()

        const content = await readFile(join(dir, 'audit.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.success).toBe(false)
        expect(entry.error).toBe('GitHub API error')
        expect(entry.tool).toBe('create_github_issue_with_entry')
    })

    it('should measure duration', async () => {
        const interceptor = createAuditInterceptor(logger)
        await interceptor.around('create_github_issue_with_entry', {}, async () => {
            // Simulate some work
            await new Promise((resolve) => setTimeout(resolve, 10))
            return { ok: true }
        })
        await logger.flush()

        const content = await readFile(join(dir, 'audit.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.durationMs).toBeGreaterThanOrEqual(5)
    })

    it('should redact args when logger is in redact mode', async () => {
        await logger.close()
        logger = new AuditLogger(config(dir, { redact: true, logPath: join(dir, 'audit-redacted.jsonl') }))

        const interceptor = createAuditInterceptor(logger)
        await interceptor.around(
            'create_github_issue_with_entry',
            { title: 'secret-title', body: 'sensitive data' },
            async () => ({ success: true })
        )
        await logger.flush()

        const content = await readFile(join(dir, 'audit-redacted.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.args).toBeUndefined()
        expect(entry.tool).toBe('create_github_issue_with_entry')
        expect(entry.success).toBe(true)
    })

    it('should return the tool result unchanged', async () => {
        const interceptor = createAuditInterceptor(logger)
        const expected = { entries: [{ id: 1 }], total: 1 }

        const result = await interceptor.around(
            'create_github_issue_with_entry',
            { title: 'test' },
            async () => expected
        )

        expect(result).toBe(expected) // Same reference — not cloned
    })

    it('should include tokenEstimate on write tool entries', async () => {
        const interceptor = createAuditInterceptor(logger)
        await interceptor.around(
            'create_github_issue_with_entry',
            { title: 'test' },
            async () => ({ success: true, issueNumber: 42 })
        )
        await logger.flush()

        const content = await readFile(join(dir, 'audit.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(typeof entry.tokenEstimate).toBe('number')
        expect(entry.tokenEstimate).toBeGreaterThan(0)
    })

    it('should log read-scoped tools when auditReads is enabled', async () => {
        await logger.close()
        logger = new AuditLogger(
            config(dir, { auditReads: true, logPath: join(dir, 'audit-reads.jsonl') })
        )

        const interceptor = createAuditInterceptor(logger)
        await interceptor.around(
            'search_entries',
            { query: 'test' },
            async () => ({ entries: [{ id: 1 }] })
        )
        await logger.flush()

        const content = await readFile(join(dir, 'audit-reads.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        expect(entry.tool).toBe('search_entries')
        expect(entry.category).toBe('read')
        expect(entry.success).toBe(true)
        expect(typeof entry.tokenEstimate).toBe('number')
        expect(entry.tokenEstimate).toBeGreaterThan(0)
    })

    it('should use compact format for read entries (no args, user, scopes)', async () => {
        await logger.close()
        logger = new AuditLogger(
            config(dir, { auditReads: true, logPath: join(dir, 'audit-compact.jsonl') })
        )

        const interceptor = createAuditInterceptor(logger)
        await interceptor.around('search_entries', { query: 'test' }, async () => ({
            entries: ['result'],
        }))
        await logger.flush()

        const content = await readFile(join(dir, 'audit-compact.jsonl'), 'utf-8')
        const entry = JSON.parse(content.trim()) as AuditEntry

        // Compact format: args should not be present even in non-redact mode
        expect(entry.args).toBeUndefined()
        // Read entries always set user/scopes to null/[] (compact)
        expect(entry.user).toBeNull()
        expect(entry.scopes).toEqual([])
        // But retains essential fields
        expect(entry.tool).toBe('search_entries')
        expect(entry.category).toBe('read')
        expect(entry.success).toBe(true)
        expect(entry.tokenEstimate).toBeGreaterThan(0)
    })
})
