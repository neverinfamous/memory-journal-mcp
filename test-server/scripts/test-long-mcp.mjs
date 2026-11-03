/**
 * Confirms the current MCP client can create a 50,000-character entry
 * and that a 100,001-character entry is rejected.
 *
 * Usage:
 *   node test-server/scripts/test-long-mcp.mjs
 */

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-long-mcp-'))

const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') childEnv[key] = value
}
childEnv.AUTO_REBUILD_INDEX = 'false'
childEnv.LOG_LEVEL = 'error'

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
        'dist/cli.js',
        '--db',
        join(tempDir, 'long-mcp.db'),
        '--team-db',
        join(tempDir, 'long-mcp-team.db'),
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
    cwd: projectDir,
    env: childEnv,
    stderr: 'pipe',
})

let stderr = ''
transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
})
transport.onerror = (error) => {
    console.error('Transport error:', error.message)
}

function fail(message) {
    console.error(message)
    if (stderr.trim() !== '') console.error(stderr.trim())
    process.exitCode = 1
}

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

function argumentsFor(length) {
    return {
        content: 'A'.repeat(length),
        entry_type: 'technical_note',
        workspace_id: 'test-ws',
        project_number: 5,
        impact_score: 0.2,
        trust_score: 0.8,
        validation_status: 'passed',
    }
}

const client = new Client({ name: 'test-long-mcp', version: '1.0.0' }, { capabilities: {} })

try {
    await client.connect(transport)

    console.log('Testing 50,000 chars...')
    const res1 = await client.callTool({ name: 'create_entry', arguments: argumentsFor(50000) })
    const body1 = payloadOf(res1)
    console.log('50k result:', body1.success === true ? 'success' : body1.error)
    if (body1.success !== true) {
        fail('50,000-character create_entry should succeed')
    } else {
        console.log('Testing 100,001 chars...')
        try {
            const res2 = await client.callTool({
                name: 'create_entry',
                arguments: argumentsFor(100001),
            })
            const body2 = payloadOf(res2)
            const detail = String(body2.error ?? JSON.stringify(res2))
            const rejected = body2.success !== true && detail.includes('50000')
            console.log('100k result:', rejected ? 'rejected' : detail.slice(0, 300))
            if (!rejected) fail('100,001-character create_entry should be rejected at 50000 characters')
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.log('100k result:', message.slice(0, 300))
            if (!message.includes('50000')) {
                fail('100,001-character create_entry should be rejected at 50000 characters')
            }
        }
    }
} catch (error) {
    fail(error instanceof Error ? error.message : String(error))
} finally {
    await transport.close()
}

if (process.exitCode === 1) process.exit(1)
