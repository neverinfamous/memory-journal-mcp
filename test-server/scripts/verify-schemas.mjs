/**
 * Confirms every registered tool except mj_execute_code advertises outputSchema.
 *
 * Usage:
 *   node test-server/scripts/verify-schemas.mjs
 */

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'mj-verify-schemas-'))

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
        join(tempDir, 'schemas.db'),
        '--team-db',
        join(tempDir, 'schemas-team.db'),
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

const client = new Client({ name: 'verify-schemas', version: '1.0.0' }, { capabilities: {} })

try {
    await client.connect(transport)
    const listed = await client.listTools()
    const tools = listed.tools
    const checked = tools.filter((tool) => tool.name !== 'mj_execute_code')
    const missing = checked.filter((tool) => !('outputSchema' in tool)).map((tool) => tool.name)

    if (missing.length === 0) {
        console.log(
            `SUCCESS: All ${checked.length} standard tools have outputSchema defined on the protocol level.`
        )
    } else {
        console.error('FAILED: The following tools are missing outputSchema:', missing)
        const sample = tools[0]
        if (sample !== undefined) console.error('Sample tool keys:', Object.keys(sample))
        process.exitCode = 1
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    if (stderr.trim() !== '') console.error(stderr.trim())
    process.exitCode = 1
} finally {
    await transport.close()
    rmSync(tempDir, { recursive: true, force: true })
}

if (process.exitCode === 1) process.exit(1)
