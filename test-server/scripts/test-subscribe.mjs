import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rmSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(__dirname, '../..')
const dbPath = resolve(__dirname, "test-subscribe-prompts.db")

// Cleanup function
const cleanup = () => {
    try {
        rmSync(dbPath, { force: true })
        rmSync(`${dbPath}-shm`, { force: true })
        rmSync(`${dbPath}-wal`, { force: true })
        
        const teamDbPath = resolve(__dirname, "test-subscribe-team-prompts.db")
        rmSync(teamDbPath, { force: true })
        rmSync(`${teamDbPath}-shm`, { force: true })
        rmSync(`${teamDbPath}-wal`, { force: true })
    } catch {}
}

cleanup()

const proc = spawn('node', [
    'dist/cli.js', 
    '--log-level', 'error',
    '--db', dbPath,
    '--team-db', 'test-subscribe-team-prompts.db'
], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        DB_PATH: dbPath,
        PROJECT_NUMBER: "5",
        MEMORY_JOURNAL_MCP_TOOL_FILTER: "full",
    }
})

let buffer = ''
const pending = new Map() // id -> resolve
const notifications = []

proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            const msg = JSON.parse(trimmed)
            // Debug all messages except empty/noisy
            if (msg.method || (msg.id && msg.result)) {
                console.log(`[DEBUG] Received: ${JSON.stringify(msg)}`)
            }

            // Handle notifications
            if (msg.method === 'notifications/resources/updated') {
                console.log(`[NOTIFICATION] Received update for ${msg.params.uri}`)
                notifications.push(msg.params)
            }

            // Handle RPC responses
            if (msg.id && pending.has(msg.id)) {
                pending.get(msg.id)(msg)
                pending.delete(msg.id)
            }
        } catch {
            // Non-JSON line — ignore
        }
    }
})

proc.stderr.on('data', () => {})

let nextId = 1
function rpc(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Timeout: ${method}`))
        }, 10_000)
        pending.set(id, (msg) => {
            clearTimeout(timer)
            resolve(msg)
        })
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
}

function notify(method, params = {}) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0

async function main() {
    console.log('Initializing MCP Server...')
    await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: { roots: { listChanged: true } },
        clientInfo: { name: 'test-subscribe', version: '1.0' },
    })
    await delay(500)
    notify('notifications/initialized')
    await delay(500)

    console.log('\n--- Phase 1: Subscription setup ---')
    await rpc('resources/subscribe', { uri: 'memory://briefing' })
    console.log('Subscribed to memory://briefing')

    console.log('\n--- Phase 2: Triggering mutation ---')
    const seedResponse = await rpc('tools/call', {
        name: 'create_entry',
        arguments: { project_number: 5, content: 'Entry that should trigger briefing update', entry_type: 'technical_note' },
    })

    if (seedResponse.error) {
        console.error('FAIL: Could not create entry:', seedResponse.error)
        failures++
    }

    // Wait for debounced notification (100ms internal delay)
    await delay(500)

    if (notifications.some(n => n.uri === 'memory://briefing')) {
        console.log('PASS: Received notifications/resources/updated for memory://briefing')
    } else {
        console.error('FAIL: Did not receive resource updated notification')
        failures++
    }

    console.log('\n--- Phase 3: Unsubscription verification ---')
    await rpc('resources/unsubscribe', { uri: 'memory://briefing' })
    console.log('Unsubscribed from memory://briefing')
    
    // Clear notifications array
    notifications.length = 0

    await rpc('tools/call', {
        name: 'update_entry',
        arguments: { project_number: 5, entry_id: 1, content: 'Updated content' },
    })

    await delay(500)

    if (notifications.some(n => n.uri === 'memory://briefing')) {
        console.error('FAIL: Received notification after unsubscribing!')
        failures++
    } else {
        console.log('PASS: Did not receive notification after unsubscribe')
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n--- Summary ---')
    if (failures === 0) {
        console.log('ALL PHASES PASSED')
    } else {
        console.error(`${failures} phase(s) FAILED`)
        process.exitCode = 1
    }

    proc.kill()
    
    // Wait briefly to allow process to release file locks
    setTimeout(() => {
        cleanup()
    }, 500)
}

main().catch((err) => {
    console.error('Script failed:', err)
    proc.kill()
    setTimeout(() => {
        cleanup()
        process.exitCode = 1
    }, 500)
})
