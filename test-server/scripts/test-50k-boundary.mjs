/**
 * Confirms create_entry accepts a 50,000-character content string.
 *
 * Usage:
 *   node test-server/scripts/test-50k-boundary.mjs
 */

import { spawn } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-50k-'))
const longContent = 'A'.repeat(50000)

const proc = spawn(
    process.execPath,
    [
        'dist/cli.js',
        '--db',
        join(tempDir, 'boundary.db'),
        '--team-db',
        join(tempDir, 'boundary-team.db'),
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
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            AUTO_REBUILD_INDEX: 'false',
            LOG_LEVEL: 'error',
        },
    }
)

let buffer = ''
let stderr = ''
const pending = new Map()

proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '' || !trimmed.startsWith('{')) continue
        try {
            const msg = JSON.parse(trimmed)
            const resolve = pending.get(msg.id)
            if (resolve !== undefined) {
                pending.delete(msg.id)
                resolve(msg)
            }
        } catch {
            // Incomplete JSON stays in the next chunk via buffer.
        }
    }
})

proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
})

function rpc(id, method, params) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Timeout waiting for ${method}`))
        }, 30000)
        pending.set(id, (msg) => {
            clearTimeout(timer)
            resolve(msg)
        })
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
}

function notify(method) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
}

function readSuccess(message) {
    const structured = message.result?.structuredContent
    if (structured !== undefined && typeof structured === 'object') {
        return structured
    }
    const text = message.result?.content?.[0]?.text
    if (typeof text === 'string' && text.startsWith('{')) {
        return JSON.parse(text)
    }
    return undefined
}

try {
    const initialize = await rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-50k-boundary', version: '1.0' },
    })
    if (initialize.error) {
        throw new Error(`initialize failed: ${JSON.stringify(initialize.error)}`)
    }
    notify('notifications/initialized')

    const called = await rpc(2, 'tools/call', {
        name: 'create_entry',
        arguments: {
            content: longContent,
            entry_type: 'technical_note',
            workspace_id: 'test-ws',
            project_number: 5,
            impact_score: 0.2,
            trust_score: 0.8,
            validation_status: 'passed',
        },
    })
    if (called.error) {
        throw new Error(`tools/call failed: ${JSON.stringify(called.error)}`)
    }
    const body = readSuccess(called)
    const success = body?.success === true
    console.log('Success:', success)
    if (!success) {
        console.error(body?.error ?? JSON.stringify(called.result))
        proc.kill()
        process.exit(1)
    }
    proc.kill()
    process.exit(0)
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    if (stderr.trim() !== '') {
        console.error(stderr.trim())
    }
    proc.kill()
    process.exit(1)
}
