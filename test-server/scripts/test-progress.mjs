/**
 * Test Progress Notifications
 *
 * Validates that the MCP server emits `notifications/progress` messages when
 * a client provides a `progressToken` in `_meta`.  Uses `export_entries` as
 * the trigger because it naturally sends progress through the IO handler
 * pipeline (0/2 → 1/2 → 2/2).
 *
 * Ported from db-mcp's test-progress.mjs, adapted for memory-journal-mcp:
 *   - CLI args: plain `dist/cli.js` (default journal.db path)
 *   - Tool name: `export_entries` (IO group, always sends progress)
 *   - Expected: ≥ 2 progress notification events
 *
 * Prerequisites: `npm run build` (executes dist/cli.js directly)
 * Transport: stdio
 * Duration: ~5s
 */
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(__dirname, '../..')

const proc = spawn(
    'node',
    ['dist/cli.js', '--log-level', 'error'],
    {
        cwd: projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
    }
)

let buffer = ''
const pending = new Map() // id -> resolve
const progressEvents = []

proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            const msg = JSON.parse(trimmed)

            // Handle notifications
            if (msg.method === 'notifications/progress') {
                console.log(
                    `[PROGRESS] Step ${msg.params.progress} of ${msg.params.total || '?'}` +
                        (msg.params.message ? ` — ${msg.params.message}` : '')
                )
                progressEvents.push(msg.params)
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
        proc.stdin.write(
            JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
        )
    })
}

function notify(method, params = {}) {
    proc.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    )
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
    console.log('Initializing MCP Server...')
    await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-progress', version: '1.0' },
    })
    await delay(500)
    notify('notifications/initialized')
    await delay(1_000)

    // Seed a minimal entry so export_entries has something to process
    console.log('\nSeeding a test entry...')
    const seedResponse = await rpc('tools/call', {
        name: 'create_entry',
        arguments: { content: 'Progress notification test entry', entry_type: 'technical_note' },
    })

    if (seedResponse.error) {
        console.error('FAIL: Could not seed entry:', seedResponse.error)
        proc.kill()
        process.exitCode = 1
        return
    }

    console.log('\nCalling export_entries with progressToken...')
    progressEvents.length = 0 // Reset before the measured call

    const response = await rpc('tools/call', {
        name: 'export_entries',
        arguments: { format: 'json', limit: 5 },
        _meta: { progressToken: 'test-token' },
    })

    if (response.error) {
        console.error('FAIL: Tool returned error:', response.error)
        process.exitCode = 1
    } else {
        console.log('\nTool finished successfully!')

        // export_entries sends: 0/2 (Fetching), 1/2 (Processing), 2/2 (Complete) = 3 notifications
        if (progressEvents.length >= 2) {
            console.log(
                `PASS: Received ${progressEvents.length} progress notifications (expected ≥ 2)`
            )
        } else {
            console.error(
                `FAIL: Expected ≥ 2 progress notifications, got ${progressEvents.length}`
            )
            process.exitCode = 1
        }
    }

    proc.kill()
}

main().catch((err) => {
    console.error('Script failed:', err)
    proc.kill()
    process.exitCode = 1
})
