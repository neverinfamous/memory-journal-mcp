/**
 * E2E Tests: Audit Log Rotation Stress Test
 */

import { stat, rm } from 'node:fs/promises'
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

const AUDIT_PORT_BASE = 3170
const AUDIT_FILTER = 'core'

function auditLogPath(suffix: string): string {
    return join(tmpdir(), `mj-audit-stress-${suffix}-${Date.now()}.jsonl`)
}

test.describe.configure({ mode: 'serial', timeout: 60000 })

test.describe('Audit Log Rotation Stress', () => {
    test('maintains 5 rotated files under high write throughput', async () => {
        const port = AUDIT_PORT_BASE + 1
        const logPath = auditLogPath('rotation-stress')

        // Max size 1024 bytes to force rapid rotation (must be >= 1024 per Zod schema)
        await startServer(
            port,
            ['--audit-log', logPath, '--audit-log-max-size', '1024', '--audit-reads'],
            'audit-rotation-stress'
        )

        let client: Client | undefined
        try {
            client = await createClient(port)

            const iterations = 40
            for (let i = 0; i < iterations; i++) {
                await callToolAndParse(client, 'test_simple', { message: `stress-${i}` })
                if (i % 5 === 0) {
                    await new Promise((r) => setTimeout(r, 150))
                }
            }

            await new Promise((r) => setTimeout(r, 1000))

            let rotatedCount = 0
            for (let i = 1; i <= 6; i++) {
                const rotatedPath = `${logPath}.${i}`
                try {
                    const s = await stat(rotatedPath)
                    if (s.size > 0) {
                        rotatedCount++
                        if (i > 5) {
                            throw new Error(`Rotation exceeded maximum limit, found ${rotatedPath}`)
                        }
                    }
                } catch {}
            }

            expect(rotatedCount).toBeGreaterThanOrEqual(2)
            expect(rotatedCount).toBeLessThanOrEqual(5)
        } finally {
            if (client) await client.close()
            stopServer(port)

            await rm(logPath, { force: true }).catch(() => {})
            for (let i = 1; i <= 6; i++) {
                await rm(`${logPath}.${i}`, { force: true }).catch(() => {})
            }
        }
    })
})
