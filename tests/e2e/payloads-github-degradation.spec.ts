/**
 * Payload Contract Tests: GitHub Configuration Degradation
 *
 * Verifies that GitHub tools gracefully degrade and return
 * structured { requiresUserInput: true } errors instead of crashing
 * or throwing unhandled exceptions when PROJECT_REGISTRY is missing.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { startServer, stopServer, createClient } from './helpers.js'
import { tmpdir } from 'node:os'

const GITHUB_DEGRADE_PORT = 3115

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: GitHub Config Degradation', () => {
    let client: Client

    test.beforeAll(async () => {
        // Strip out PROJECT_REGISTRY and GITHUB_TOKEN so auto-detect fails
        const oldRegistry = process.env.PROJECT_REGISTRY
        const oldToken = process.env.GITHUB_TOKEN

        delete process.env.PROJECT_REGISTRY
        delete process.env.GITHUB_TOKEN

        // startServer propagates the current process.env
        try {
            const startOpts = { cwd: tmpdir() }
            await startServer(GITHUB_DEGRADE_PORT, [], 'gh-degrade', startOpts)
            client = await createClient(GITHUB_DEGRADE_PORT)
        } finally {
            if (oldRegistry) process.env.PROJECT_REGISTRY = oldRegistry
            if (oldToken) process.env.GITHUB_TOKEN = oldToken
        }
    })

    test.afterAll(async () => {
        if (client) {
            await client.close()
        }
        stopServer(GITHUB_DEGRADE_PORT)
    })

    test('get_github_issues returns requiresUserInput: true without auto-detect env', async () => {
        const response = await client.callTool({
            name: 'get_github_issues',
            arguments: {}, // Empty properties to fail auto-detect
        })

        expect(Array.isArray(response.content)).toBe(true)
        const text = (response.content as Array<{ text: string }>)[0]!.text
        console.log('GitHub Degrade Response:', text)
        // Check for presence of requiresUserInput flag due to missing token / auto-detect failure
        expect(text).toContain('"requiresUserInput":true')
    })

    test('get_github_context degrades gracefully to returning missing state', async () => {
        const response = await client.callTool({
            name: 'get_github_context',
            arguments: {},
        })

        expect(Array.isArray(response.content)).toBe(true)
        const text = (response.content as Array<{ text: string }>)[0]!.text
        const payload = JSON.parse(text)

        expect(payload.repoName).toBeNull()
        expect(payload.issueCount).toBe(0)
    })
})
