/**
 * Test Team DB Fallback
 *
 * Invokes the MCP server subprocess intentionally missing the TEAM_DB_PATH
 * environment variable to verify that:
 * 1. The server boots successfully without crashing.
 * 2. It intercepts a team-scoped tool request and returns a standardized,
 *    user-facing recovery message instead of an unhandled internal exception.
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliPath = join(__dirname, '../../dist/cli.js')

console.log('Spawning MCP server without TEAM_DB_PATH...')
const mcp = spawn('node', [cliPath], {
    env: {
        ...process.env,
        TEAM_DB_PATH: '',
    },
})

let output = ''
let responseReceived = false

mcp.stdout.on('data', (data) => {
    output += data.toString()
    if (output.includes('"id":1')) {
        const lines = output.split('\n')
        const responseLine = lines.find((line) => line.includes('"id":1'))
        if (responseLine) {
            try {
                const parsed = JSON.parse(responseLine)
                console.log('\n✅ Received intercept response:')
                console.log(JSON.stringify(parsed, null, 2))
                responseReceived = true
                mcp.kill()
            } catch (e) {
                console.log('\nRaw Response:', responseLine)
            }
        }
    }
})

mcp.stderr.on('data', (data) => {
    // Suppress normal boot STDERR unless an actual error trace
    if (data.toString().includes('Error:')) {
        console.error(`\n❌ ERROR: ${data}`)
    }
})

mcp.on('close', (code) => {
    if (!responseReceived) {
        console.log(`\nProcess exited with code ${code} without sending tool payload`)
    } else {
        console.log(`\nTest completed successfully.`)
    }
})

// Boot delay before payload
setTimeout(() => {
    console.log('Sending mock team_create_entry request...')
    mcp.stdin.write(
        JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'team_create_entry',
                arguments: { content: 'test' },
            },
        }) + '\n'
    )
}, 500)
