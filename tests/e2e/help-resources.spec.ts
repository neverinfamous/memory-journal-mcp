/**
 * E2E Tests: Help Resources
 *
 * Validates the memory://help resource system that agents use
 * for on-demand tool reference documentation.
 *
 * Tests:
 * - memory://help (root group listing with tool counts)
 * - memory://help/{group} for all 10 tool groups
 * - memory://help/gotchas (field notes and critical patterns)
 * - Content structure and non-empty responses
 *
 * Ported from db-mcp/tests/e2e/help-resources.spec.ts — adapted for memory-journal-mcp.
 */

import { test, expect } from '@playwright/test'
import { createClient } from './helpers.js'

test.describe.configure({ mode: 'serial' })

const HELP_GROUPS = [
    'admin',
    'analytics',
    'backup',
    'codemode',
    'core',
    'export',
    'github',
    'relationships',
    'search',
    'team',
]

test.describe('Help Resources', () => {
    test('memory://help is listed in resources', async () => {
        const client = await createClient()
        try {
            const list = await client.listResources()
            const uris = list.resources.map((r) => r.uri)
            expect(uris).toContain('memory://help')
        } finally {
            await client.close()
        }
    })

    test('memory://help/gotchas is listed in resources', async () => {
        const client = await createClient()
        try {
            const list = await client.listResources()
            const uris = list.resources.map((r) => r.uri)
            expect(uris).toContain('memory://help/gotchas')
        } finally {
            await client.close()
        }
    })

    test('memory://help returns non-empty JSON with groups', async () => {
        const client = await createClient()
        try {
            const response = await client.readResource({ uri: 'memory://help' })

            expect(response.contents).toBeDefined()
            expect(response.contents.length).toBe(1)
            expect(response.contents[0].uri).toBe('memory://help')

            const text = response.contents[0].text as string
            expect(text.length).toBeGreaterThan(50)

            // Should be valid JSON with group structure
            const parsed = JSON.parse(text)
            expect(parsed.totalTools).toBeGreaterThan(0)
            expect(parsed.totalGroups).toBeGreaterThan(0)
            expect(Array.isArray(parsed.groups)).toBe(true)
        } finally {
            await client.close()
        }
    })

    test('memory://help lists all 10 tool groups', async () => {
        const client = await createClient()
        try {
            const response = await client.readResource({ uri: 'memory://help' })
            const parsed = JSON.parse(response.contents[0].text as string)
            const groupNames = (parsed.groups as Array<{ name: string }>).map((g) => g.name)

            for (const group of HELP_GROUPS) {
                expect(groupNames, `Missing group: ${group}`).toContain(group)
            }
        } finally {
            await client.close()
        }
    })

    test('memory://help/gotchas returns non-empty markdown', async () => {
        const client = await createClient()
        try {
            const response = await client.readResource({ uri: 'memory://help/gotchas' })

            expect(response.contents).toBeDefined()
            expect(response.contents.length).toBe(1)
            expect(response.contents[0].uri).toBe('memory://help/gotchas')
            expect(response.contents[0].mimeType).toBe('text/markdown')

            const text = response.contents[0].text as string
            expect(text.length, 'gotchas content too short').toBeGreaterThan(50)
        } finally {
            await client.close()
        }
    })

    for (const group of HELP_GROUPS) {
        test(`memory://help/${group} returns non-empty JSON`, async () => {
            const client = await createClient()
            try {
                const response = await client.readResource({
                    uri: `memory://help/${group}`,
                })

                expect(response.contents).toBeDefined()
                expect(response.contents.length).toBe(1)
                expect(response.contents[0].uri).toBe(`memory://help/${group}`)

                const text = response.contents[0].text as string
                expect(text.length, `${group} help content too short`).toBeGreaterThan(50)

                // Should be valid JSON with tool details
                const parsed = JSON.parse(text)
                expect(parsed.group).toBe(group)
                expect(parsed.toolCount).toBeGreaterThan(0)
                expect(Array.isArray(parsed.tools)).toBe(true)
            } finally {
                await client.close()
            }
        })
    }

    test('memory://help/{invalid} returns error response', async () => {
        const client = await createClient()
        try {
            const response = await client.readResource({
                uri: 'memory://help/nonexistentgroup',
            })

            expect(response.contents).toBeDefined()
            const text = response.contents[0].text as string
            const parsed = JSON.parse(text)
            expect(parsed.error).toBeDefined()
            expect(typeof parsed.error).toBe('string')
        } finally {
            await client.close()
        }
    })
})
