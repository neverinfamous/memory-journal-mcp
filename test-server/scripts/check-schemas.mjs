import { spawn } from 'child_process'

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectDir = join(__dirname, '..', '..')

const DEFAULT_CHECK_SCHEMAS_TIMEOUT_MS = 15000
const configuredCheckSchemasTimeoutMs = Number.parseInt(process.env.CHECK_SCHEMAS_TIMEOUT_MS ?? '', 10)
const checkSchemasTimeoutMs =
    Number.isFinite(configuredCheckSchemasTimeoutMs) && configuredCheckSchemasTimeoutMs > 0
        ? configuredCheckSchemasTimeoutMs
        : DEFAULT_CHECK_SCHEMAS_TIMEOUT_MS

const proc = spawn(process.execPath, ['dist/cli.js', '--instruction-level', 'essential'], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
})

const killTimeout = setTimeout(() => {
    console.log(`Timeout after ${checkSchemasTimeoutMs}ms — killing process`)
    proc.kill()
    process.exit(1)
}, checkSchemasTimeoutMs)

proc.stderr.pipe(process.stderr)
proc.on('exit', () => clearTimeout(killTimeout))
proc.on('error', () => clearTimeout(killTimeout))
let buffer = ''
proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            const msg = JSON.parse(trimmed)
            if (msg.id === 2) {
                const tools = msg.result?.tools || []
                console.log(`Total tools: ${tools.length}`)

                const missingNames = []
                for (const tool of tools) {
                    if (tool.name === 'mj_execute_code') continue

                    if (!tool.outputSchema) {
                        missingNames.push(tool.name)
                    }
                }

                clearTimeout(killTimeout)
                if (missingNames.length > 0) {
                    console.error(
                        `Schema check failed: ${missingNames.length} tool(s) missing outputSchema`
                    )
                    console.error(`MISSING outputSchema: ${missingNames.join(', ')}`)
                    process.exit(1)
                } else {
                    console.log('ALL TOOLS HAVE OUTPUT SCHEMA!')
                    process.exit(0)
                }
            }
        } catch {}
    }
})

proc.stdin.write(
    JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
        },
    }) + '\n'
)
setTimeout(() => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    setTimeout(() => {
        proc.stdin.write(
            JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n'
        )
    }, 500)
}, 1500)
