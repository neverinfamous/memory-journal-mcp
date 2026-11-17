/**
 * Sends invalid Zod types to team tools and checks that the server returns
 * a VALIDATION_ERROR payload instead of a raw JSON-RPC -32602 error.
 *
 * Usage:
 *   node test-server/scripts/test-team-zod.mjs
 */

import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-team-zod-'))

const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') childEnv[key] = value
}
childEnv.AUTO_REBUILD_INDEX = 'false'
childEnv.LOG_LEVEL = 'error'
childEnv.TEAM_AUTHOR = 'test_author'
childEnv.TEAM_DEFAULT_ROLE = 'member'

const proc = spawn(
    process.execPath,
    [
        'dist/cli.js',
        '--db',
        join(tempDir, 'team-zod.db'),
        '--team-db',
        join(tempDir, 'team-zod-team.db'),
        '--tool-filter',
        'full',
        '--log-level',
        'error',
        '--team-default-role',
        'member',
        '--archive-older-than-days',
        '0',
        '--prune-older-than-days',
        '0',
        '--hard-delete-older-than-days',
        '0',
    ],
    { cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv }
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
            const message = JSON.parse(trimmed)
            const resolve = pending.get(message.id)
            if (resolve !== undefined) {
                pending.delete(message.id)
                resolve(message)
            }
        } catch {
            // Incomplete JSON stays in the buffer.
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
        }, 20000)
        pending.set(id, (message) => {
            clearTimeout(timer)
            resolve(message)
        })
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
}

function notify(method) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
}

function assertValidation(message, label) {
    const text = message.result?.content?.[0]?.text ?? ''
    const code = message.result?.structuredContent?.code
    const leaked = text.includes('-32602') || message.error?.code === -32602
    const validated = text.includes('VALIDATION_ERROR') || code === 'VALIDATION_ERROR'
    if (!leaked && validated) {
        console.log(`PASS ${label}`)
        return true
    }
    console.error(`FAIL ${label}`)
    console.error(JSON.stringify(message, null, 2))
    return false
}

const cases = [
    {
        label: 'team_create_entry content number',
        name: 'team_create_entry',
        arguments: { project_number: 5, workspace_id: 'memory-journal-mcp', content: 123 },
    },
    {
        label: 'team_search query number',
        name: 'team_search',
        arguments: { project_number: 5, query: 123 },
    },
]

let failures = 0

try {
    console.log('Spawning MCP server for Zod boundary testing...')
    const initialized = await rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-team-zod', version: '1.0' },
    })
    if (initialized.error) {
        throw new Error(`initialize failed: ${JSON.stringify(initialized.error)}`)
    }
    notify('notifications/initialized')

    let id = 2
    for (const testCase of cases) {
        const response = await rpc(id, 'tools/call', {
            name: testCase.name,
            arguments: testCase.arguments,
        })
        id++
        if (!assertValidation(response, testCase.label)) failures++
    }
    console.log(failures === 0 ? '\nAll Zod boundary tests passed.' : `\n${failures} Zod boundary test(s) failed.`)
} catch (error) {
    failures++
    console.error(error instanceof Error ? error.message : String(error))
    if (stderr.trim() !== '') console.error(stderr.trim().slice(-800))
} finally {
    proc.kill()
    setTimeout(() => {
        rmSync(tempDir, { recursive: true, force: true })
        process.exit(failures === 0 ? 0 : 1)
    }, 500)
}
