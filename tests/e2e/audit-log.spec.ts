/**
 * E2E Tests: Audit Log
 *
 * Spawns a server with --audit-log enabled and verifies:
 * 1. Write-scoped tool calls produce JSONL audit entries on disk
 * 2. Read-scoped tool calls (core group) are NOT logged
 * 3. memory://audit resource returns recent entries
 * 4. --audit-redact omits tool arguments from entries
 * 5. --audit-reads logs read-scoped tools with compact entries
 * 6. Audit entries include tokenEstimate > 0
 * 7. memory://audit resource includes summary block
 * 8. Audit log correctly ignores corrupted entries
 */

import { readFile, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

import { test, expect } from './test-fixture.js'
import {
    startServer,
    stopServer,
    createClient,
    callToolRaw,
    callToolAndParse,
} from './helpers.js'
import type { Client } from '@modelcontextprotocol/client'

test.describe.configure({ mode: 'serial', timeout: 120_000 })

const AUDIT_PORT_BASE = 5130 + (Number(process.env.TEST_PARALLEL_INDEX || 0) * 100)
const AUDIT_FILTER = 'core,admin'

function auditLogPath(suffix: string): string {
    return join(tmpdir(), `mj-audit-e2e-${suffix}-${Date.now()}.jsonl`)
}

async function cleanupAuditFiles(logPath: string) {
    try {
        await rm(logPath, { force: true })
    } catch {}
}

async function readAuditLogWithRetry(
    path: string,
    maxAttempts = 15,
    intervalMs = 500
): Promise<Array<Record<string, unknown>>> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const content = await readFile(path, 'utf-8')
            const lines = content.trim().split('\n').filter(Boolean)
            if (lines.length > 0) {
                return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
            }
        } catch {
            // File doesn't exist yet — keep trying
        }
        await delay(intervalMs)
    }
    throw new Error(`Audit log file ${path} not found or empty after ${maxAttempts * intervalMs}ms`)
}

test.describe('Audit Log', () => {
    test('write-scoped tool calls produce audit entries', async () => {
        const port = AUDIT_PORT_BASE
        const logPath = auditLogPath('write')

        await startServer(port, ['--audit-log', logPath, '--no-audit-redact', '--tool-filter', AUDIT_FILTER], 'audit-write')

        let client: Client | undefined
        try {
            client = await createClient(port)

            // Write scope tool
            await callToolRaw(client, 'create_entry', {
                project_number: 1,
                content: 'audit log test entry',
                tags: ['audit-test']
            })

            const entries = await readAuditLogWithRetry(logPath)
            expect(entries.length).toBeGreaterThanOrEqual(1)

            const entry = entries[entries.length - 1]!
            expect(entry.tool).toBe('create_entry')
            expect(entry.category).toBe('write')
            expect(entry.success).toBe(true)
            expect(typeof entry.timestamp).toBe('string')
            expect(typeof entry.durationMs).toBe('number')
            expect(entry.args).toBeDefined()
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('read-scoped tool calls are NOT logged', async () => {
        const port = AUDIT_PORT_BASE + 1
        const logPath = auditLogPath('readonly')

        await startServer(port, ['--audit-log', logPath, '--tool-filter', AUDIT_FILTER], 'audit-readonly')

        let client: Client | undefined
        try {
            client = await createClient(port)

            // Read scope tool
            await callToolRaw(client, 'get_recent_entries', { project_number: 1 })

            // Wait generously — longer than the flush interval
            await delay(2000)

            // Audit log file should not exist
            let fileExists = false
            try {
                await readFile(logPath, 'utf-8')
                fileExists = true
            } catch {}
            expect(fileExists).toBe(false)
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('memory://audit resource returns recent entries', async () => {
        const port = AUDIT_PORT_BASE + 2
        const logPath = auditLogPath('resource')

        await startServer(port, ['--audit-log', logPath, '--tool-filter', AUDIT_FILTER], 'audit-resource')

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolRaw(client, 'create_entry', {
                project_number: 1,
                content: 'test resource entry'
            })

            await readAuditLogWithRetry(logPath)

            const resource = await client.readResource({ uri: 'memory://audit' })
            expect(resource.contents).toBeDefined()
            expect(resource.contents.length).toBeGreaterThan(0)

            const text = (resource.contents[0] as { text: string }).text
            expect(text).toContain('audit_log:')
            expect(text).toContain('entries_shown:')
            expect(text).toContain('tool: create_entry')
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('--audit-redact omits tool arguments from entries', async () => {
        const port = AUDIT_PORT_BASE + 3
        const logPath = auditLogPath('redact')

        await startServer(port, ['--audit-log', logPath, '--tool-filter', AUDIT_FILTER], 'audit-redact')

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolRaw(client, 'create_entry', {
                project_number: 1,
                content: 'redact test entry'
            })

            const entries = await readAuditLogWithRetry(logPath)
            expect(entries.length).toBeGreaterThanOrEqual(1)

            const entry = entries[entries.length - 1]!
            expect(entry.tool).toBe('create_entry')
            expect(entry.success).toBe(true)
            expect(entry.args).toBeUndefined()
            
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })



    test('--audit-reads logs read-scoped tools with compact entries', async () => {
        const port = AUDIT_PORT_BASE + 4
        const logPath = auditLogPath('reads')

        await startServer(port, ['--audit-log', logPath, '--audit-reads', '--tool-filter', AUDIT_FILTER], 'audit-reads')

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolRaw(client, 'get_recent_entries', { project_number: 1 })

            const entries = await readAuditLogWithRetry(logPath)
            expect(entries.length).toBeGreaterThanOrEqual(1)

            const readEntry = entries.find((e) => e.tool === 'get_recent_entries')
            expect(readEntry).toBeDefined()
            expect(readEntry!.category).toBe('read')
            expect(readEntry!.success).toBe(true)

            expect(readEntry!.args).toBeUndefined()
            expect(readEntry!.user == null).toBe(true)
            expect(readEntry!.scopes).toEqual([])
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('audit entries include tokenEstimate > 0', async () => {
        const port = AUDIT_PORT_BASE + 5
        const logPath = auditLogPath('tokens')

        await startServer(port, ['--audit-log', logPath, '--tool-filter', AUDIT_FILTER], 'audit-tokens')

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolRaw(client, 'create_entry', {
                project_number: 1,
                content: 'tokens test entry'
            })

            const entries = await readAuditLogWithRetry(logPath)
            expect(entries.length).toBeGreaterThanOrEqual(1)

            const entry = entries[entries.length - 1]!
            expect(entry.tool).toBe('create_entry')
            expect(typeof entry.tokenEstimate).toBe('number')
            expect(entry.tokenEstimate as number).toBeGreaterThan(0)
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('memory://audit resource includes summary block', async () => {
        const port = AUDIT_PORT_BASE + 6
        const logPath = auditLogPath('summary')

        await startServer(port, ['--audit-log', logPath, '--tool-filter', AUDIT_FILTER], 'audit-summary')

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolRaw(client, 'create_entry', { project_number: 1, content: 'summary' })

            await readAuditLogWithRetry(logPath)

            const resource = await client.readResource({ uri: 'memory://audit' })
            const text = (resource.contents[0] as { text: string }).text
            expect(text).toContain('session_summary:')
            expect(text).toContain('  total_tokens: ')
            expect(text).toContain('  total_duration_ms: ')
            expect(text).toContain('  error_count: ')
            expect(text).toContain('tool: create_entry')
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('audit log correctly ignores and recovers from corrupted entries', async () => {
        const port = AUDIT_PORT_BASE + 7
        const logPath = auditLogPath('corrupted')

        await appendFile(logPath, '{"tool":"create_entry","category":"wri\n') // Incomplete
        await appendFile(logPath, '{"tool":"delete_entry","category":"write","success":true,"timestamp":"2023-10-10T10:00:00.000Z","durationMs":0,"args":{}}\n')

        await startServer(port, ['--audit-log', logPath, '--tool-filter', AUDIT_FILTER], 'audit-corrupted')

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolRaw(client, 'create_entry', { project_number: 1, content: 'new valid' })

            await delay(2000)

            const resource = await client.readResource({ uri: 'memory://audit' })
            const text = (resource.contents[0] as { text: string }).text
            
            expect(text).toContain('tool: create_entry')
            expect(text).toContain('tool: delete_entry')

            const rawFile = await readFile(logPath, 'utf-8')
            expect(rawFile).toContain('category":"wri')
            expect(rawFile).toContain('delete_entry')
            expect(rawFile).toContain('create_entry')
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })
})
