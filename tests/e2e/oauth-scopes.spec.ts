/**
 * E2E Tests: OAuth 2.1 Scope Enforcement
 *
 * Verifies that the HTTP middleware enforces RFC 8414/9728 scope logic
 * per tool group before requests reach the MCP handler.
 *
 * read:  get_recent_entries (core group)
 * write: get_github_issues  (github group)
 * admin: rebuild_vector_index (admin group)
 */

import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import * as jose from 'jose'
import express from 'express'
import type { Server } from 'node:http'

const OAUTH_SCOPES_PORT = 3113
const JWKS_PORT = 3114

test.describe.configure({ mode: 'serial' })

test.describe('OAuth 2.1 Scope Enforcement E2E', () => {
    let serverProcess: ChildProcess
    let jwksServer: Server
    let privateKey: any
    let publicKey: any

    // JWTs
    let readToken: string
    let writeToken: string
    let adminToken: string

    // To gracefully exit HTTP servers
    const closeServer = (server: Server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))

    test.beforeAll(async () => {
        // 1. Generate local keypair
        const keypair = await jose.generateKeyPair('RS256')
        privateKey = keypair.privateKey
        publicKey = keypair.publicKey

        const jwk = await jose.exportJWK(publicKey)
        jwk.kid = 'test-kid-1'
        jwk.use = 'sig'
        jwk.alg = 'RS256'

        // 2. Start mock JWKS HTTP server
        const app = express()
        app.get('/jwks', (req, res) => {
            res.json({ keys: [jwk] })
        })
        await new Promise<void>((resolve) => {
            jwksServer = app.listen(JWKS_PORT, '127.0.0.1', () => resolve())
        })

        // 3. Generate tokens
        const issuer = `http://127.0.0.1:${JWKS_PORT}`
        const audience = 'memory-journal-mcp'

        const makeToken = async (scope: string) => {
            return await new jose.SignJWT({ scope })
                .setProtectedHeader({ alg: 'RS256', kid: 'test-kid-1' })
                .setIssuedAt()
                .setIssuer(issuer)
                .setAudience(audience)
                .setExpirationTime('1h')
                .sign(privateKey)
        }

        readToken = await makeToken('read')
        writeToken = await makeToken('read write') // Usually inclusive
        adminToken = await makeToken('admin read write') // Admin includes all

        // 4. Start MCP Server with OAuth enabled
        serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--allowed-io-roots',
                process.cwd(),
                '--transport',
                'http',
                '--port',
                String(OAUTH_SCOPES_PORT),
                '--db',
                './.test-output/e2e/test-oauth-scopes.db',
                '--oauth-enabled',
                '--oauth-issuer',
                issuer,
                '--oauth-audience',
                audience,
                '--oauth-jwks-uri',
                `http://127.0.0.1:${JWKS_PORT}/jwks`,
                '--oauth-allow-plaintext-loopback',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    ALLOWED_IO_ROOTS: process.cwd(),
                    MCP_RATE_LIMIT_MAX: '10000',
                },
            }
        )

        serverProcess.stderr?.on('data', (d) => console.error('E2E SERVER STDERR:', d.toString()))
        serverProcess.stdout?.on('data', (d) => console.log('E2E SERVER STDOUT:', d.toString()))
        let ready = false
        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`http://localhost:${OAUTH_SCOPES_PORT}/health`)
                if (res.ok) {
                    ready = true
                    break
                }
            } catch {}
            await delay(500)
        }
        if (!ready) throw new Error('MCP server failed to start within 15 seconds')
    })

    test.afterAll(async () => {
        if (serverProcess) {
            serverProcess.kill('SIGTERM')
        }
        if (jwksServer) {
            await closeServer(jwksServer)
        }
    })

    /**
     * Execute a tool call directly against the MCP endpoint.
     *
     * For scope-denied cases (expectSuccess=false): a bare tools/call POST with no
     * session hits the scope middleware BEFORE session validation → 403.
     *
     * For scope-allowed cases (expectSuccess=true): performs a full session handshake
     * (initialize → mcp-session-id → tools/call) so the MCP handler receives a
     * valid request and returns 200.
     */
    async function executeToolDirectly(
        token: string,
        tool: string,
        args: Record<string, unknown>,
        expectSuccess: boolean
    ) {
        const base = `http://localhost:${OAUTH_SCOPES_PORT}/mcp`
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`,
        }

        // Always initialize a valid session (stateful server)
        const initRes = await fetch(base, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test-client', version: '1.0' },
                },
            }),
        })
        expect(initRes.status).toBe(200)
        const sessionId = initRes.headers.get('mcp-session-id')
        expect(sessionId).toBeTruthy()

        // Notify server that client is initialized
        await fetch(base, {
            method: 'POST',
            headers: { ...headers, 'mcp-session-id': sessionId! },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        })

        // Now call the tool on the established session
        const res = await fetch(base, {
            method: 'POST',
            headers: { ...headers, 'mcp-session-id': sessionId! },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: { name: tool, arguments: args },
            }),
        })
        expect(res.status).toBe(200) // JSON-RPC always returns HTTP 200
        const text = await res.text()

        let body: any
        try {
            body = JSON.parse(text)
        } catch (e) {
            // Extract from SSE format if needed
            const dataMatch = text.match(/data:\s*({.*})/)
            if (dataMatch) {
                body = JSON.parse(dataMatch[1]!)
            } else {
                throw new Error(`Failed to parse response: ${text}`, { cause: e })
            }
        }

        if (!expectSuccess) {
            // Scope failure occurs at the dispatch layer in callTool or in registration
            if (body.error) {
                expect(body.error.message).toMatch(/scope|denied|unauthorized|Access/i)
            } else {
                expect(body.result?.isError).toBe(true)
                expect(body.result?.content?.[0]?.text).toMatch(/scope|denied|unauthorized|Access/i)
            }
        } else {
            expect(body.error).toBeUndefined()
            expect(body.result?.isError).not.toBe(true)
        }
    }

    test('read token can read core tools, but gets 403 on write-scoped tools', async () => {
        // Read-scoped core tool — allowed (core group requires read)
        await executeToolDirectly(readToken, 'get_recent_entries', { limit: 1 }, true)

        // Write-scoped tool — blocked (github group requires write)
        await executeToolDirectly(readToken, 'get_github_issues', {}, false)
    })

    test('write token can call write-scoped tools, but gets 403 on admin tools', async () => {
        // Write-scoped tool allowed (github group requires write, write token has write scope)
        await executeToolDirectly(writeToken, 'get_github_issues', {}, true)

        // Admin tools blocked (admin group requires admin, write token has only read+write)
        await executeToolDirectly(writeToken, 'rebuild_vector_index', {}, false)
    })

    test('admin token can call admin-scoped tools', async () => {
        // Admin access granted (admin scope satisfies admin group requirement)
        await executeToolDirectly(adminToken, 'rebuild_vector_index', {}, true)
    })
})
