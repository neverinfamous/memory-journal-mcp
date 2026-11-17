/**
 * HTTP payload boundary for create_entry.
 * Starts its own server, then checks a 50,000-character body succeeds
 * and a 100,001-character body is rejected.
 *
 * Usage:
 *   node test-server/scripts/test-http.mjs
 */

import { spawn } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-http-'))
const port = 5050
const base = `http://127.0.0.1:${port}`

const childEnv = { ...process.env }
delete childEnv.MCP_AUTH_TOKEN
delete childEnv.OAUTH_ENABLED
delete childEnv.OAUTH_ISSUER
childEnv.AUTO_REBUILD_INDEX = 'false'
childEnv.LOG_LEVEL = 'error'

const proc = spawn(
    process.execPath,
    [
        'dist/cli.js',
        '--transport',
        'http',
        '--server-host',
        '127.0.0.1',
        '--port',
        String(port),
        '--db',
        join(tempDir, 'http-boundary.db'),
        '--team-db',
        join(tempDir, 'http-boundary-team.db'),
        '--tool-filter',
        'full',
        '--log-level',
        'error',
        '--archive-older-than-days',
        '0',
        '--prune-older-than-days',
        '0',
        '--hard-delete-older-than-days',
        '0',
    ],
    {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
    }
)

let stderr = ''
proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
})
proc.stdout.on('data', () => {
    // Drain startup logs so a full pipe cannot stall the server.
})

function fail(message) {
    console.error(message)
    if (stderr.trim() !== '') {
        console.error(stderr.trim())
    }
    proc.kill()
    process.exit(1)
}

async function waitForHealth() {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
            fail(`Server exited with code ${proc.exitCode} before /health`)
        }
        try {
            const res = await fetch(`${base}/health`)
            if (res.ok) return
        } catch {
            // Server is still binding.
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    fail('Server did not accept connections on 127.0.0.1:5050')
}

function parseRpc(text) {
    const trimmed = text.trim()
    if (trimmed.startsWith('{')) return JSON.parse(trimmed)
    const dataLines = trimmed
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line.startsWith('{'))
    const last = dataLines.at(-1)
    if (last === undefined) {
        throw new Error(`No JSON-RPC body in response: ${trimmed.slice(0, 400)}`)
    }
    return JSON.parse(last)
}

async function post(path, body, sessionId) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-03-26',
    }
    if (sessionId !== undefined) {
        headers['mcp-session-id'] = sessionId
    }
    const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    })
    const text = await res.text()
    const message = text.trim() === '' ? {} : parseRpc(text)
    return { status: res.status, sessionId: res.headers.get('mcp-session-id'), text, message }
}

function toolBody(message) {
    const structured = message.result?.structuredContent
    if (structured !== undefined && typeof structured === 'object') return structured
    const text = message.result?.content?.[0]?.text
    if (typeof text === 'string' && text.includes('{')) {
        const start = text.indexOf('{')
        try {
            return JSON.parse(text.slice(start))
        } catch {
            return { success: false, error: text }
        }
    }
    return { success: false, error: message.error?.message ?? text ?? JSON.stringify(message) }
}

try {
    await waitForHealth()

    const initialized = await post('/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-http', version: '1.0' },
        },
    })
    if (initialized.message.error) {
        fail(`initialize failed: ${JSON.stringify(initialized.message.error)}`)
    }
    const sessionId = initialized.sessionId ?? undefined
    console.log('Session:', sessionId ?? '(stateless)')

    if (sessionId !== undefined) {
        await post(
            '/mcp',
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            sessionId
        )
    }

    const argumentsFor = (length) => ({
        content: 'A'.repeat(length),
        entry_type: 'technical_note',
        workspace_id: 'memory-journal-mcp',
        project_number: 5,
        impact_score: 0.2,
        trust_score: 0.8,
        validation_status: 'passed',
    })

    console.log('Testing 50,000 chars...')
    const res1 = await post(
        '/mcp',
        {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'create_entry', arguments: argumentsFor(50000) },
        },
        sessionId
    )
    const body1 = toolBody(res1.message)
    console.log('50k status:', res1.status, body1.success === true ? 'success' : body1.error)
    if (body1.success !== true) {
        fail('50,000-character create_entry should succeed')
    }

    console.log('Testing 100,001 chars...')
    const res2 = await post(
        '/mcp',
        {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'create_entry', arguments: argumentsFor(100001) },
        },
        sessionId
    )
    const body2 = toolBody(res2.message)
    const rejected = body2.success !== true && String(body2.error ?? res2.text).includes('50000')
    console.log('100k status:', res2.status, rejected ? 'rejected' : body2.error ?? res2.text.slice(0, 300))
    if (!rejected) {
        fail('100,001-character create_entry should be rejected at 50000 characters')
    }

    proc.kill()
    process.exit(0)
} catch (error) {
    fail(error instanceof Error ? error.message : String(error))
}
