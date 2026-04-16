/**
 * Payload Contract Tests: GitHub Configuration Degradation
 *
 * Verifies that GitHub tools gracefully degrade and return
 * structured { requiresUserInput: true } errors instead of crashing
 * or throwing unhandled exceptions when PROJECT_REGISTRY is missing.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { startServer, stopServer, createClient, callToolAndParse } from './helpers.js'
import { tmpdir } from 'node:os'

const GITHUB_DEGRADE_PORT = 3115

test.describe.configure({ mode: 'serial', timeout: 120000 })

test.describe('Payload Contracts: GitHub Config Degradation', () => {
    let client: Client

    test.beforeAll(async () => {
        test.setTimeout(120000)
        // Strip out PROJECT_REGISTRY and GITHUB_TOKEN so auto-detect fails
        const oldRegistry = process.env.PROJECT_REGISTRY
        const oldToken = process.env.GITHUB_TOKEN
        const oldTeamDb = process.env.TEAM_DB_PATH

        delete process.env.PROJECT_REGISTRY
        delete process.env.GITHUB_TOKEN
        delete process.env.TEAM_DB_PATH

        // startServer propagates the current process.env
        try {
            const startOpts = { cwd: tmpdir() }
            await startServer(GITHUB_DEGRADE_PORT, [], 'gh-degrade', startOpts)
            client = await createClient(GITHUB_DEGRADE_PORT)
        } finally {
            if (oldRegistry) process.env.PROJECT_REGISTRY = oldRegistry
            if (oldToken) process.env.GITHUB_TOKEN = oldToken
            if (oldTeamDb) process.env.TEAM_DB_PATH = oldTeamDb
        }
    })

    test.afterAll(async () => {
        if (client) {
            await client.close()
        }
        stopServer(GITHUB_DEGRADE_PORT)
    })

    test('get_github_issues returns requiresUserInput: true without auto-detect env', async () => {
        const payload = await callToolAndParse(client, 'get_github_issues', {}) as any

        expect(typeof payload).toBe('object')
        expect(payload.requiresUserInput).toBe(true)
    })

    test('get_github_context degrades gracefully to returning missing state', async () => {
        const payload = await callToolAndParse(client, 'get_github_context', {}) as any

        expect(payload.repoName).toBeNull()
        expect(payload.issueCount).toBe(0)
    })
})
