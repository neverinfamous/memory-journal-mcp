/**
 * Test Team Zod Boundary
 *
 * Invokes the MCP server subprocess and deliberately sends invalid Zod types
 * (e.g., numbers instead of strings) to ensure that the SDK-level Zod
 * exceptions are gracefully intercepted and formatted as standard
 * VALIDATION_ERROR JSON-RPC payloads, rather than leaking raw -32602 errors.
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliPath = join(__dirname, '../../dist/cli.js')

const tests = [
    {
        name: 'team_create_entry (type mismatch)',
        payload: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'team_create_entry',
                arguments: { project_number: 5, content: 123 },
            },
        },
    },
    {
        name: 'team_pass_flag (type mismatch)',
        payload: {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'team_pass_flag',
                arguments: { project_number: 5, flag_type: 123, message: 'test' },
            },
        },
    },
]

let currentTestIdx = 0
let output = ''

console.log('Spawning MCP server for Zod boundary testing...')
const mcp = spawn('node', [cliPath, '--team-db', ':memory:'], {
    env: { ...process.env },
})

mcp.stdout.on('data', (data) => {
    output += data.toString()

    // Check if we received a response for the current test
    const test = tests[currentTestIdx]
    if (!test) return

    if (output.includes(`"id":${test.payload.id}`)) {
        const lines = output.split('\n')
        const responseLine = lines.find((line) => line.includes(`"id":${test.payload.id}`))

        if (responseLine) {
            let pass = false
            try {
                const parsed = JSON.parse(responseLine)
                const resultText = parsed?.result?.content?.[0]?.text || ''
                const structuredContent = parsed?.result?.structuredContent

                // Assert it's a validation error
                if (
                    !resultText.includes('-32602') &&
                    (resultText.includes('VALIDATION_ERROR') ||
                        structuredContent?.code === 'VALIDATION_ERROR')
                ) {
                    console.log(`✅ [PASS] ${test.name}`)
                    pass = true
                } else {
                    console.log(`❌ [FAIL] ${test.name}`)
                    console.log(`Expected structured VALIDATION_ERROR but received:`)
                    console.log(JSON.stringify(parsed, null, 2))
                    process.exit(1)
                }
            } catch (e) {
                console.log(`❌ [FAIL] ${test.name} - Could not parse response`)
                console.log('Raw Response:', responseLine)
                process.exit(1)
            }

            // Move to next test or finish
            currentTestIdx++
            output = '' // Reset buffer
            if (currentTestIdx < tests.length) {
                sendTest(currentTestIdx)
            } else {
                console.log('\n✅ All Zod boundary tests passed.')
                mcp.kill()
            }
        }
    }
})

mcp.stderr.on('data', (data) => {
    if (data.toString().includes('Error:')) {
        console.error(`\n❌ ERROR: ${data}`)
    }
})

mcp.on('close', (code) => {
    if (currentTestIdx < tests.length) {
        console.log(`\nProcess exited prematurely with code ${code}`)
        process.exit(1)
    }
})

function sendTest(idx) {
    const test = tests[idx]
    // console.log(`Sending: ${test.name}`)
    mcp.stdin.write(JSON.stringify(test.payload) + '\n')
}

// Boot delay
setTimeout(() => {
    sendTest(currentTestIdx)
}, 500)
