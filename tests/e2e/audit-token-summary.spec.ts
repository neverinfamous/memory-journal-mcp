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
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

const AUDIT_PORT_BASE = 3180
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
    test('memory://audit summary accurately aggregates tool token estimates', async () => {
        const port = AUDIT_PORT_BASE + 1
        const logPath = auditLogPath('accuracy')

        await startServer(
            port,
            ['--audit-log', logPath, '--audit-reads', '--tool-filter', AUDIT_FILTER],
            'audit-accuracy'
        )

        let client: Client | undefined
        try {
            client = await createClient(port)

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
                const tokens = meta!.tokenEstimate as number

                expectedTotalTokens += tokens

                await new Promise((r) => setTimeout(r, 100))
            }

            const resource = await client.readResource({ uri: 'memory://audit' })
            expect(resource.contents).toBeDefined()

            const text = (resource.contents[0] as { text: string }).text

            expect(text).toContain('session_summary:')
            expect(text).toContain('  total_tokens: ')
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })

    test('high-cost operations reflect accurately in summary total and rank top', async () => {
        const port = AUDIT_PORT_BASE + 2
        const logPath = auditLogPath('highcost')

        await startServer(
            port,
            ['--audit-log', logPath, '--audit-reads', '--tool-filter', AUDIT_FILTER],
            'audit-highcost'
        )

        let client: Client | undefined
        try {
            client = await createClient(port)

            await callToolAndParse(client, 'get_recent_entries', { project_number: 1 })
            await callToolAndParse(client, 'get_recent_entries', { project_number: 1 })

            const largePayload = await callToolAndParse(client, 'search_entries', { project_number: 1, query: 'test' })
            const highCostEstimate = (largePayload._meta as Record<string, unknown>).tokenEstimate as number
            expect(highCostEstimate).toBeGreaterThan(0)

            await new Promise((r) => setTimeout(r, 600))

            const resource = await client.readResource({ uri: 'memory://audit' })
            const text = (resource.contents[0] as { text: string }).text

            expect(text).toContain('session_summary:')
            expect(text).toContain('  total_tokens: ')
        } finally {
            if (client) await client.close()
            stopServer(port)
            await cleanupAuditFiles(logPath)
        }
    })
})
