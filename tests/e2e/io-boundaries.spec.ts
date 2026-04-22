/**
 * IO Boundaries E2E Test
 * Tests that allowedIoRoots correctly restricts tools.
 */

import { test, expect } from '@playwright/test'
import { createClient, callToolAndParse } from './helpers.js'
import * as os from 'node:os'

test.describe.configure({ mode: 'serial' })

test.describe('Boundary: allowedIoRoots', () => {
    test('export_markdown outside allowed roots fails', async () => {
        const client = await createClient()
        try {
            // Attempt to export to a directory outside the implicit/explicit allowed roots
            const outsideDir = os.tmpdir()
            const p = await callToolAndParse(client, 'export_markdown', {
                output_dir: outsideDir,
            })
            // Must strictly fail closed without exposing ambient authority
            expect(p.success).toBe(false)
            expect(p.error).toMatch(/security|not allowed|traversal|outside/i)
        } finally {
            await client.close()
        }
    })
})
