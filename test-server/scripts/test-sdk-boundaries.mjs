/**
 * Checks that invalid tool arguments return a tool result instead of
 * crashing the MCP client or the server.
 *
 * Usage:
 *   node test-server/scripts/test-sdk-boundaries.mjs
 */

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-sdk-boundaries-'))

const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') childEnv[key] = value
}
childEnv.AUTO_REBUILD_INDEX = 'false'
childEnv.LOG_LEVEL = 'error'
childEnv.TEAM_AUTHOR = 'test_author'
childEnv.TEAM_DEFAULT_ROLE = 'member'

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
        'dist/cli.js',
        '--db',
        join(tempDir, 'sdk-boundaries.db'),
        '--team-db',
        join(tempDir, 'sdk-boundaries-team.db'),
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
        '--team-default-role',
        'member',
    ],
    cwd: projectDir,
    env: childEnv,
    stderr: 'pipe',
})

let stderr = ''
transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
})

function payloadOf(result) {
    const structured = result.structuredContent
    if (structured !== undefined && structured !== null && typeof structured === 'object') {
        return structured
    }
    const text = result.content?.[0]?.text
    if (typeof text === 'string' && text.includes('{')) {
        try {
            return JSON.parse(text.slice(text.indexOf('{')))
        } catch {
            return { success: false, error: text }
        }
    }
    return {
        success: result.isError !== true,
        error: typeof text === 'string' ? text : JSON.stringify(result),
    }
}

function describe(result) {
    const payload = payloadOf(result)
    const detail = payload.error ?? payload.message ?? (payload.success === true ? 'success' : JSON.stringify(payload))
    return { payload, detail: String(detail).slice(0, 300) }
}

const cases = [
    {
        label: 'team_create_entry invalid type',
        name: 'team_create_entry',
        arguments: {
            project_number: 5,
            workspace_id: 'memory-journal-mcp',
            entry_type: 'invalid',
            content: 'test',
        },
        accept(payload) {
            return payload.success === true
        },
    },
    {
        label: 'team_update_entry missing id',
        name: 'team_update_entry',
        arguments: { project_number: 5, workspace_id: 'memory-journal-mcp', entry_id: 999999 },
        accept(payload) {
            return payload.success !== true
        },
    },
    {
        label: 'create_entry boolean content',
        name: 'create_entry',
        arguments: { project_number: 5, workspace_id: 'memory-journal-mcp', content: true },
        accept(payload) {
            return payload.success !== true
        },
    },
    {
        label: 'create_entry array content',
        name: 'create_entry',
        arguments: { project_number: 5, workspace_id: 'memory-journal-mcp', content: ['array'] },
        accept(payload) {
            return payload.success !== true
        },
    },
]

const client = new Client({ name: 'test-sdk-boundaries', version: '1.0.0' }, { capabilities: {} })
let failures = 0

try {
    await client.connect(transport)
    for (const testCase of cases) {
        try {
            const result = await client.callTool({
                name: testCase.name,
                arguments: testCase.arguments,
            })
            const { payload, detail } = describe(result)
            const ok = testCase.accept(payload)
            console.log(`${ok ? 'PASS' : 'FAIL'} ${testCase.label}: ${detail}`)
            if (!ok) failures++
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const rejected = /validation|not found|invalid/i.test(message)
            console.log(`${rejected ? 'PASS' : 'FAIL'} ${testCase.label}: ${message.slice(0, 300)}`)
            if (!rejected) failures++
        }
    }
} catch (error) {
    failures++
    console.error(error instanceof Error ? error.message : String(error))
    if (stderr.trim() !== '') console.error(stderr.trim().slice(-800))
} finally {
    await transport.close()
}

if (failures > 0) process.exit(1)
console.log(`\n${cases.length - failures}/${cases.length} boundary checks passed`)
