/**
 * Test Progress Notifications
 *
 * Phase 1: Validates that the MCP server emits `notifications/progress`
 * messages when a client provides a `progressToken` in `_meta`.
 * Uses `export_entries` as the trigger because it naturally sends progress
 * through the IO handler pipeline (0/2 → 1/2 → 2/2).
 *
 * Phase 2: Validates that Code Mode scripts can send progress notifications
 * via `mj.reportProgress(progress, total, message)` — the sandbox binding
 * added for parity with db-mcp's `sqlite.reportProgress()`.
 *
 * Ported from db-mcp's test-progress.mjs, adapted for memory-journal-mcp:
 *   - CLI args: plain `dist/cli.js` (default journal.db path)
 *   - Phase 1 tool: `export_entries` (IO group, always sends progress)
 *   - Phase 2 tool: `mj_execute_code` with `mj.reportProgress()`
 *   - Expected: ≥ 2 progress events per phase
 *
 * Prerequisites: `npm run build` (executes dist/cli.js directly)
 * Transport: stdio
 * Duration: ~8s
 */
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(__dirname, '../..')

const proc = spawn('node', ['dist/cli.js', '--log-level', 'error'], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
})

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

    // =========================================================================
    // Phase 1: Native tool progress (export_entries → IO handler pipeline)
    // =========================================================================
    console.log('\n--- Phase 1: Native tool progress (export_entries) ---')
    progressEvents.length = 0

    const response = await rpc('tools/call', {
        name: 'export_entries',
        arguments: { format: 'json', limit: 5 },
        _meta: { progressToken: 'phase1-token' },
    })

    if (response.error) {
        console.error('FAIL: Tool returned error:', response.error)
        failures++
    } else {
        console.log('\nTool finished successfully!')
        if (progressEvents.length >= 2) {
            console.log(
                `PASS: Received ${progressEvents.length} progress notifications (expected ≥ 2)`
            )
        } else {
            console.error(`FAIL: Expected ≥ 2 progress notifications, got ${progressEvents.length}`)
            failures++
        }
    }

    // =========================================================================
    // Phase 2: Code Mode mj.reportProgress() sandbox binding
    // =========================================================================
    console.log('\n--- Phase 2: Code Mode mj.reportProgress() ---')
    progressEvents.length = 0

    const codeResponse = await rpc('tools/call', {
        name: 'mj_execute_code',
        arguments: {
            code: [
                'await mj.reportProgress(0, 3, "Starting workflow...");',
                'await mj.reportProgress(1, 3, "Processing data...");',
                'await mj.reportProgress(2, 3, "Finalizing...");',
                'await mj.reportProgress(3, 3, "Workflow complete");',
                'return { success: true, stepsReported: 4 };',
            ].join('\n'),
        },
        _meta: { progressToken: 'phase2-codemode' },
    })

    // Allow a moment for any trailing notifications to arrive
    await delay(200)

    if (codeResponse.error) {
        console.error('FAIL: mj_execute_code returned error:', codeResponse.error)
        failures++
    } else {
        const result = codeResponse.result?.content?.[0]?.text
        let parsed
        try {
            parsed = JSON.parse(result)
        } catch {
            parsed = result
        }

        console.log('\nCode Mode result:', JSON.stringify(parsed))

        if (progressEvents.length >= 3) {
            console.log(
                `PASS: Received ${progressEvents.length} Code Mode progress notifications (expected ≥ 3)`
            )
        } else {
            console.error(
                `FAIL: Expected ≥ 3 Code Mode progress notifications, got ${progressEvents.length}`
            )
            failures++
        }
    }

    // =========================================================================
    // Phase 3: Batch Operation Progress (batch_delete_entries)
    // =========================================================================
    console.log('\n--- Phase 3: Batch Operation Progress (batch_delete_entries) ---')
    progressEvents.length = 0

    // 1. Batch Create Entries with Progress
    const seedBatch = await rpc('tools/call', {
        name: 'batch_create_entries',
        arguments: {
            entries: [
                { content: 'Delete me 1', entry_type: 'technical_note', project_number: 1 }, 
                { content: 'Delete me 2', entry_type: 'technical_note', project_number: 1 }
            ],
            auto_index: true
        },
        _meta: { progressToken: 'phase3-batch' }
    })
    
    let ids = []
    if (seedBatch.error) {
        console.error('FAIL: Could not seed batch entries:', seedBatch.error)
        failures++
    } else {
        try {
            const content = seedBatch.result?.content?.[0]?.text
            const parsed = JSON.parse(content)
            if (parsed.success) {
                ids = parsed.entries.map(e => e.id)
            } else {
                console.error('FAIL: Seed batch returned application error:', parsed.error)
                failures++
            }
        } catch (err) {}
    }

    // 2. Batch Update Entries with Progress
    if (ids.length > 0) {
        const updateBatch = await rpc('tools/call', {
            name: 'batch_update_entries',
            arguments: {
                updates: ids.map(id => ({
                    entry_id: id,
                    content: 'Updated content'
                }))
            },
            _meta: { progressToken: 'phase3-batch' }
        })
        
        if (updateBatch.error) {
            console.error('FAIL: batch_update_entries returned error:', updateBatch.error)
            failures++
        }
    }

    // 3. Batch Delete Entries with Progress
    const batchResponse = await rpc('tools/call', {
        name: 'batch_delete_entries',
        arguments: { entry_ids: ids },
        _meta: { progressToken: 'phase3-batch' }
    })
    
    if (batchResponse.error) {
        console.error('FAIL: batch_delete_entries returned error:', batchResponse.error)
        failures++
    } else {
        // Check for application-level error
        const text = batchResponse.result?.content?.[0]?.text
        let success = true
        try {
            const parsed = JSON.parse(text)
            if (parsed.success === false) {
                console.error('FAIL: Application error:', parsed.error)
                success = false
            }
        } catch(e) {}

        if (success) {
            // Wait briefly for any pending stdout data events to process
            await new Promise(resolve => setTimeout(resolve, 500))
            
            console.log('\nBatch operations finished successfully!')
            if (progressEvents.length >= 6) {
                console.log(
                    `PASS: Received ${progressEvents.length} progress notifications (expected ≥ 6)`
                )
            } else {
                console.error(`FAIL: Expected ≥ 6 progress notifications, got ${progressEvents.length}`)
                failures++
            }
        } else {
            failures++
        }
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
}

main().catch((err) => {
    console.error('Script failed:', err)
    proc.kill()
    process.exitCode = 1
})
