/**
 * E2E Tests: Complete Resource Coverage
 *
 * Tests 13 resources not covered by resources.spec.ts or resources-expanded.spec.ts:
 * help (index + per-group + gotchas), rules, workflows, skills,
 * github (status, insights, milestones), graph/actions, actions/recent,
 * and team (recent, statistics).
 */

import { test, expect } from '@playwright/test'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Resource Reads: Complete Coverage', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    // --- Help resources ---
    test('should read memory://help (tool group index)', async () => {
        const response = await client.readResource({ uri: 'memory://help' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('groups')
        expect(Array.isArray(parsed.groups)).toBe(true)
        expect(parsed.groups.length).toBeGreaterThanOrEqual(10)
    })

    test('should read memory://help/core (per-group tool details)', async () => {
        const response = await client.readResource({ uri: 'memory://help/core' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('group', 'core')
        expect(parsed).toHaveProperty('tools')
        expect(Array.isArray(parsed.tools)).toBe(true)
        expect(parsed.tools.length).toBeGreaterThanOrEqual(5)
    })

    test('should read memory://help/gotchas (field notes)', async () => {
        const response = await client.readResource({ uri: 'memory://help/gotchas' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        // Gotchas content should be a non-trivial text block
        expect(text.length).toBeGreaterThan(50)
    })

    // --- Configuration-dependent resources (unconfigured in test env) ---
    test('should read memory://rules (unconfigured)', async () => {
        const response = await client.readResource({ uri: 'memory://rules' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('configured', false)
    })

    test('should read memory://workflows (unconfigured)', async () => {
        const response = await client.readResource({ uri: 'memory://workflows' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('configured', false)
    })

    test('should read memory://skills (unconfigured)', async () => {
        const response = await client.readResource({ uri: 'memory://skills' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        // Without SKILLS_DIR_PATH, should return { configured: false } or empty skills
        expect(typeof parsed).toBe('object')
    })

    // --- GitHub resources (no token in test env) ---
    test('should read memory://github/status', async () => {
        const response = await client.readResource({ uri: 'memory://github/status' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        // May return error or partial data without token — either is valid
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
    })

    test('should read memory://github/insights', async () => {
        const response = await client.readResource({ uri: 'memory://github/insights' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
    })

    test('should read memory://github/milestones', async () => {
        const response = await client.readResource({ uri: 'memory://github/milestones' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
    })

    // --- Graph resources ---
    test('should read memory://graph/actions', async () => {
        const response = await client.readResource({ uri: 'memory://graph/actions' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        expect(typeof text).toBe('string')
    })

    test('should read memory://actions/recent', async () => {
        const response = await client.readResource({ uri: 'memory://actions/recent' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        expect(typeof text).toBe('string')
    })

    // --- Team resources (no TEAM_DB_PATH in test env) ---
    test('should read memory://team/recent', async () => {
        const response = await client.readResource({ uri: 'memory://team/recent' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        // Without team DB, should return a not-configured indicator
        expect(typeof parsed).toBe('object')
    })

    test('should read memory://team/statistics', async () => {
        const response = await client.readResource({ uri: 'memory://team/statistics' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(typeof parsed).toBe('object')
    })
})
