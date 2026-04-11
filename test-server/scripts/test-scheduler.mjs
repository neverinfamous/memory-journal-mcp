/**
 * Phase 10: Automated Scheduler Test
 *
 * Prerequisites:
 *   npm run build
 *   node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2 --digest-interval 2
 *
 * Usage:
 *   node test-server/test-scheduler.mjs              # full test (130s wait)
 *   WAIT_SECONDS=0 node test-server/test-scheduler.mjs  # initial check only
 */

const BASE = process.env.MCP_URL || 'http://localhost:3099/mcp'
const WAIT_SECONDS = parseInt(process.env.WAIT_SECONDS || '130', 10)

/** Parse SSE response text into JSON-RPC messages */
function parseSSE(text) {
    const messages = []
    for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
            try {
                messages.push(JSON.parse(line.slice(6)))
            } catch {
                // skip non-JSON data lines
            }
        }
    }
    return messages
}

async function mcpRequest(method, params, sessionId) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
    }
    if (sessionId) headers['mcp-session-id'] = sessionId

    const res = await fetch(BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
        }),
    })

    const sid = res.headers.get('mcp-session-id') || sessionId
    const ct = res.headers.get('content-type') || ''
    const text = await res.text()

    let body
    if (ct.includes('text/event-stream')) {
        const messages = parseSSE(text)
        // Find the response with a result or error (skip notifications)
        body = messages.find((m) => m.result || m.error) || messages[0]
    } else {
        body = JSON.parse(text)
    }
    return { body, sessionId: sid }
}

function checkScheduler(health, label) {
    console.log(`\n===== ${label} =====`)

    const scheduler = health.scheduler
    if (!scheduler) {
        console.error('❌ No scheduler block in health')
        return false
    }

    console.log(`  active: ${scheduler.active}`)
    console.log(`  jobs: ${scheduler.jobs?.length || 0}`)

    for (const job of scheduler.jobs || []) {
        console.log(
            `  [${job.name}] runCount=${job.runCount ?? 0}, lastResult=${job.lastResult ?? 'null'}, lastError=${job.lastError ?? 'null'}, nextRun=${job.nextRun ?? 'null'}`
        )
    }

    return scheduler.active && (scheduler.jobs?.length || 0) === 4
}

async function main() {
    console.log('=== Phase 10: Automated Scheduler Test ===')
    console.log(`Target: ${BASE}, wait: ${WAIT_SECONDS}s`)

    // 1. Initialize
    const init = await mcpRequest('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'scheduler-test', version: '1.0' },
    })
    const sid = init.sessionId
    console.log(`Session: ${sid}`)

    // Send initialized notification (no id = notification, no response expected)
    await fetch(BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'mcp-session-id': sid,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })

    // 2. Read health
    const h1 = await mcpRequest('resources/read', { uri: 'memory://health' }, sid)
    const t1 = h1.body?.result?.contents?.[0]?.text
    if (!t1) {
        console.error('❌ No health content. Response:', JSON.stringify(h1.body, null, 2))
        process.exit(1)
    }
    const d1 = JSON.parse(t1)
    const ok1 = checkScheduler(d1, 'Initial Health (expect runCount=0)')
    if (!ok1) {
        console.error('❌ Scheduler not active')
        process.exit(1)
    }

    const jobs1 = d1.scheduler.jobs
    console.log(`\n  All runCount=0: ${jobs1.every((j) => (j.runCount ?? 0) === 0) ? '✅' : '❌'}`)
    console.log(`  All lastRun=null: ${jobs1.every((j) => j.lastRun === null) ? '✅' : '❌'}`)
    console.log(`  All have nextRun: ${jobs1.every((j) => j.nextRun !== null) ? '✅' : '❌'}`)

    if (WAIT_SECONDS === 0) {
        console.log('\nWAIT_SECONDS=0, skipping post-wait check')
        process.exit(0)
    }

    // 3. Wait
    console.log(`\n⏳ Waiting ${WAIT_SECONDS}s for scheduler jobs to fire...`)
    await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000))

    // 4. Re-read health
    const h2 = await mcpRequest('resources/read', { uri: 'memory://health' }, sid)
    const t2 = h2.body?.result?.contents?.[0]?.text
    const d2 = JSON.parse(t2)
    checkScheduler(d2, 'Post-Wait Health')

    const jobs2 = d2.scheduler.jobs
    const backup = jobs2.find((j) => j.name === 'backup')
    const vacuum = jobs2.find((j) => j.name === 'vacuum')
    const rebuild = jobs2.find((j) => j.name === 'rebuild-index')
    const digest = jobs2.find((j) => j.name === 'digest')

    console.log('\n===== Verification =====')
    const checks = [
        ['backup runCount ≥ 2', (backup?.runCount ?? 0) >= 2],
        ['backup lastResult = success', backup?.lastResult === 'success'],
        ['vacuum runCount ≥ 1', (vacuum?.runCount ?? 0) >= 1],
        ['vacuum lastResult = success', vacuum?.lastResult === 'success'],
        ['rebuild-index runCount ≥ 1', (rebuild?.runCount ?? 0) >= 1],
        ['rebuild-index lastResult = success', rebuild?.lastResult === 'success'],
        ['digest runCount ≥ 1', (digest?.runCount ?? 0) >= 1],
        ['digest lastResult = success', digest?.lastResult === 'success'],
        ['backup lastError = null', !backup?.lastError],
        ['vacuum lastError = null', !vacuum?.lastError],
        ['rebuild lastError = null', !rebuild?.lastError],
        ['digest lastError = null', !digest?.lastError],
    ]

    let passed = 0
    for (const [name, ok] of checks) {
        console.log(`  ${ok ? '✅' : '❌'} ${name}`)
        if (ok) passed++
    }

    console.log(`\n${passed}/${checks.length} checks passed`)
    process.exit(passed === checks.length ? 0 : 1)
}

main().catch((err) => {
    console.error('Fatal:', err.message)
    process.exit(1)
})
