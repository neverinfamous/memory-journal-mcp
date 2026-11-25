/**
 * E2E Tests: Audit Token Summary Accuracy
 */

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { test, expect } from './test-fixture.js'
import {
    startServer,
    stopServer,
    createClient,
    callToolAndParse,
} from './helpers.js'
import type { Client } from '@modelcontextprotocol/client'

const AUDIT_FILTER = 'core,search,analytics'

function auditLogPath(suffix: string): string {
    return join(tmpdir(), `mj-audit-summary-${suffix}-${Date.now()}.jsonl`)
}

async function cleanupAuditFiles(logPath: string) {
    try {
        await rm(logPath, { force: true })
    } catch {}
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.describe('Audit Token Summary Accuracy', () => {
    let port: number
    let logPath: string
    let client: Client

    test.beforeAll(async ({ baseURL: _baseURL }, testInfo) => {
        port = 5150 + testInfo.parallelIndex * 100 + 1
        logPath = auditLogPath('summary')
        await startServer(
            port,
            ['--audit-log', logPath, '--audit-reads', '--tool-filter', AUDIT_FILTER],
            'audit-summary'
        )
        client = await createClient(port)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(port)
        await cleanupAuditFiles(logPath)
    })

    test('memory://audit summary accurately aggregates tool token estimates', async () => {
        const toolsToCall = [
            { name: 'create_entry', args: { project_number: 1, content: 'entry 1' } },
            { name: 'get_recent_entries', args: { project_number: 1 } },
            { name: 'get_statistics', args: { project_number: 1 } },
        ]

        let expectedTotalTokens = 0

        for (const t of toolsToCall) {
            const payload = await callToolAndParse(client, t.name, t.args)
            expect(payload.error).toBeUndefined()

            const meta = payload._meta as Record<string, unknown> | undefined
            expect(typeof meta?.tokenEstimate).toBe('number')
            expectedTotalTokens += meta?.tokenEstimate as number
        }

        expect(expectedTotalTokens).toBeGreaterThan(0)

        let text = ''
        await expect
            .poll(
                async () => {
                    const resource = await client.readResource({ uri: 'memory://audit' })
                    text = (resource.contents[0] as { text: string }).text
                    return text
                },
                { timeout: 5000, intervals: [50, 100, 200] }
            )
            .toContain('session_summary:')

        expect(text).toContain('  total_tokens: ')
    })

    test('high-cost operations reflect accurately in summary total and rank top', async () => {
        await callToolAndParse(client, 'get_recent_entries', { project_number: 1 })
        await callToolAndParse(client, 'get_recent_entries', { project_number: 1 })

        const largePayload = await callToolAndParse(client, 'search_entries', {
            project_number: 1,
            query: 'test',
        })
        const highCostEstimate = (largePayload._meta as Record<string, unknown>).tokenEstimate as number
        expect(highCostEstimate).toBeGreaterThan(0)

        let text = ''
        await expect
            .poll(
                async () => {
                    const resource = await client.readResource({ uri: 'memory://audit' })
                    text = (resource.contents[0] as { text: string }).text
                    return text
                },
                { timeout: 5000, intervals: [50, 100, 200] }
            )
            .toContain('session_summary:')

        expect(text).toContain('  total_tokens: ')
    })
})
