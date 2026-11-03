/**
 * Starts an HTTP server and checks that the four scheduler jobs run.
 *
 * Backup is every 1 minute. Vacuum, index rebuild, and digest are every
 * 2 minutes, so the default wait is 130 seconds.
 *
 * Usage:
 *   node test-server/scripts/test-scheduler.mjs
 *   WAIT_SECONDS=0 node test-server/scripts/test-scheduler.mjs
 */

import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-scheduler-'))
const port = 3099
const base = process.env.MCP_URL ?? `http://127.0.0.1:${port}/mcp`
const ownsServer = process.env.MCP_URL === undefined
const waitSeconds = Number.parseInt(process.env.WAIT_SECONDS ?? '130', 10)

const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') childEnv[key] = value
}
delete childEnv.MCP_AUTH_TOKEN
delete childEnv.OAUTH_ENABLED
delete childEnv.OAUTH_ISSUER
childEnv.AUTO_REBUILD_INDEX = 'false'
childEnv.AUTO_PRUNE_INTERVAL_MINUTES = '0'
childEnv.LOG_LEVEL = 'error'
childEnv.MEMORY_JOURNAL_CONFIG = join(projectDir, 'test-server', 'scripts', 'test-server-config.json')

let proc
let stderr = ''
let nextId = 1

function fail(message) {
    console.error(message)
    if (stderr.trim() !== '') console.error(stderr.trim().slice(-800))
    process.exitCode = 1
}

async function startServer() {
    proc = spawn(
        process.execPath,
        [
            'dist/cli.js',
            '--transport', 'http',
            '--server-host', '127.0.0.1',
            '--port', String(port),
            '--db', join(tempDir, 'scheduler.db'),
            '--team-db', join(tempDir, 'scheduler-team.db'),
            '--log-level', 'error',
            '--tool-filter', 'core',
            '--backup-interval', '1',
            '--keep-backups', '3',
            '--vacuum-interval', '2',
            '--rebuild-index-interval', '2',
            '--digest-interval', '2',
            '--report-interval', '0',
            '--auto-prune-interval', '0',
            '--archive-older-than-days', '0',
            '--prune-older-than-days', '0',
            '--hard-delete-older-than-days', '0',
        ],
        { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv }
    )
    proc.stdout.on('data', () => {})
    proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
    })

    const healthUrl = `http://127.0.0.1:${port}/health`
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
            fail(`Server exited with code ${proc.exitCode} before /health`)
            return false
        }
        try {
            const res = await fetch(healthUrl)
            if (res.ok) return true
        } catch {
            // Server is still binding.
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
    fail('Server did not accept connections on 127.0.0.1:3099')
    return false
}

function stopServer() {
    if (proc !== undefined) proc.kill()
    setTimeout(() => {
        rmSync(tempDir, { recursive: true, force: true })
        process.exit(process.exitCode ?? 1)
    }, 500)
}

function parseRpc(text, contentType) {
    if (contentType.includes('text/event-stream')) {
        const messages = []
        for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
                messages.push(JSON.parse(line.slice(6)))
            } catch {
                // Skip non-JSON event lines.
            }
        }
        return messages.find((message) => message.result !== undefined || message.error !== undefined) ?? messages[0]
    }
    return JSON.parse(text)
}

async function mcpRequest(method, params, sessionId) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-03-26',
    }
    if (sessionId !== undefined && sessionId !== '') headers['mcp-session-id'] = sessionId
    const res = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    })
    const text = await res.text()
    const body = text.trim() === '' ? {} : parseRpc(text, res.headers.get('content-type') ?? '')
    return { body, sessionId: res.headers.get('mcp-session-id') ?? sessionId }
}

function checkScheduler(health, label) {
    console.log(`\n===== ${label} =====`)
    const scheduler = health.scheduler
    if (scheduler === undefined || scheduler === null) {
        console.error('No scheduler block in health')
        return false
    }
    console.log(`  active: ${scheduler.active}`)
    console.log(`  jobs: ${scheduler.jobs?.length ?? 0}`)
    for (const job of scheduler.jobs ?? []) {
        console.log(
            `  [${job.name}] runCount=${job.runCount ?? 0}, lastResult=${job.lastResult ?? 'null'}, lastError=${job.lastError ?? 'null'}, nextRun=${job.nextRun ?? 'null'}`
        )
    }
    return scheduler.active === true && (scheduler.jobs?.length ?? 0) === 4
}

function jobChecks(health) {
    const jobs = health.scheduler?.jobs ?? []
    const backup = jobs.find((job) => job.name === 'backup')
    const vacuum = jobs.find((job) => job.name === 'vacuum')
    const rebuild = jobs.find((job) => job.name === 'rebuild-index')
    const digest = jobs.find((job) => job.name === 'digest')
    return [
        ['backup runCount >= 2', (backup?.runCount ?? 0) >= 2],
        ['backup lastResult = success', backup?.lastResult === 'success'],
        ['vacuum runCount >= 1', (vacuum?.runCount ?? 0) >= 1],
        ['vacuum lastResult = success', vacuum?.lastResult === 'success'],
        ['rebuild-index runCount >= 1', (rebuild?.runCount ?? 0) >= 1],
        ['rebuild-index lastResult = success', rebuild?.lastResult === 'success'],
        ['digest runCount >= 1', (digest?.runCount ?? 0) >= 1],
        ['digest lastResult = success', digest?.lastResult === 'success'],
        ['backup lastError = null', backup?.lastError === null || backup?.lastError === undefined],
        ['vacuum lastError = null', vacuum?.lastError === null || vacuum?.lastError === undefined],
        ['rebuild lastError = null', rebuild?.lastError === null || rebuild?.lastError === undefined],
        ['digest lastError = null', digest?.lastError === null || digest?.lastError === undefined],
    ]
}

async function readHealth(sessionId) {
    const response = await mcpRequest('resources/read', { uri: 'memory://health' }, sessionId)
    const text = response.body?.result?.contents?.[0]?.text
    if (typeof text !== 'string' || text === '') {
        throw new Error(`No health content. Response: ${JSON.stringify(response.body)}`)
    }
    return JSON.parse(text)
}

async function main() {
    console.log('=== Phase 10: Automated Scheduler Test ===')
    console.log(`Target: ${base}, wait: ${waitSeconds}s`)

    if (ownsServer) {
        const started = await startServer()
        if (!started) return
    }

    const init = await mcpRequest('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'scheduler-test', version: '1.0' },
    })
    if (init.body?.error !== undefined) {
        fail(`initialize failed: ${JSON.stringify(init.body.error)}`)
        return
    }
    const sessionId = init.sessionId ?? ''
    console.log(`Session: ${sessionId === '' ? '(stateless)' : sessionId}`)
    const notifyHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-03-26',
    }
    if (sessionId !== '') notifyHeaders['mcp-session-id'] = sessionId
    await fetch(base, {
        method: 'POST',
        headers: notifyHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })

    const initial = await readHealth(sessionId)
    const initialOk = checkScheduler(initial, 'Initial Health (expect runCount=0)')
    if (!initialOk) {
        fail('Scheduler not active')
        return
    }
    const jobs = initial.scheduler.jobs
    console.log(`\n  All runCount=0: ${jobs.every((job) => (job.runCount ?? 0) === 0) ? 'yes' : 'no'}`)
    console.log(`  All lastRun=null: ${jobs.every((job) => job.lastRun === null) ? 'yes' : 'no'}`)
    console.log(`  All have nextRun: ${jobs.every((job) => job.nextRun !== null) ? 'yes' : 'no'}`)

    if (waitSeconds === 0) {
        console.log('\nWAIT_SECONDS=0, skipping post-wait check')
        process.exitCode = 0
        return
    }

    console.log(`\nWaiting up to ${waitSeconds}s for scheduler jobs to fire...`)
    const deadline = Date.now() + waitSeconds * 1000
    let latest = initial
    while (Date.now() < deadline) {
        const slice = Math.min(15000, deadline - Date.now())
        if (slice <= 0) break
        await new Promise((resolve) => setTimeout(resolve, slice))
        latest = await readHealth(sessionId)
        const summary = (latest.scheduler?.jobs ?? [])
            .map((job) => `${job.name}:${job.runCount ?? 0}/${job.lastResult ?? '-'}`)
            .join(' ')
        console.log(`  ${summary}`)
        if (jobChecks(latest).every(([, ok]) => ok === true)) break
    }

    checkScheduler(latest, 'Post-Wait Health')
    const checks = jobChecks(latest)
    console.log('\n===== Verification =====')
    let passed = 0
    for (const [name, ok] of checks) {
        console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`)
        if (ok) passed++
    }
    console.log(`\n${passed}/${checks.length} checks passed`)
    process.exitCode = passed === checks.length ? 0 : 1
}

try {
    await main()
} catch (error) {
    fail(error instanceof Error ? error.message : String(error))
} finally {
    stopServer()
}
