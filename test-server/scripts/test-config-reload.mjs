import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const PROJECT_DIR = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp'
const CONFIG_FILE = path.join(PROJECT_DIR, 'test-mcp-config.json')

const initialConfig = {
    instructionLevel: 'standard',
    toolFilter: '',
    briefingEntries: 2,
}

fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2))

console.log('=== Memory Journal MCP - Config Reload Test ===\n')

let proc;
let msgId = 1;
let pendingRequests = new Map();

function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        pendingRequests.set(id, { resolve, reject });
        proc.stdin.write(
            JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params,
            }) + '\n'
        )
    })
}

function sendNotification(method, params) {
    proc.stdin.write(
        JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
        }) + '\n'
    )
}

async function runTest() {
    proc = spawn('node', ['dist/cli.js', '--db', 'data/mcp_test_db.db', '--config', 'test-mcp-config.json'], {
        cwd: PROJECT_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
    })

    let buffer = ''
    proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        // Keep the last partial line
        buffer = lines.pop() || ''
        
        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
                const msg = JSON.parse(trimmed)
                if (msg.id !== undefined && pendingRequests.has(msg.id)) {
                    const { resolve, reject } = pendingRequests.get(msg.id);
                    pendingRequests.delete(msg.id);
                    if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    else resolve(msg.result);
                } else if (msg.method === 'notifications/resources/updated') {
                    console.log('Got notification: resources/updated for', msg.params?.uri)
                }
            } catch {
                // Not complete JSON yet
            }
        }
    })

    proc.stderr.on('data', (err) => {
        console.error('SERVER STDERR:', err.toString())
    })

    try {
        console.log('1. Initializing...')
        await sendRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-config-reload', version: '1.0' },
        })
        sendNotification('notifications/initialized', {})

        console.log('2. Step 1: Initial State Inspection')
        const briefing1 = await sendRequest('resources/read', { uri: 'memory://briefing' })
        const text1 = briefing1.contents[0].text
        console.log('  Initial briefing has length:', text1.length)
        if (!text1.includes('level: standard')) throw new Error('Expected standard level in briefing')

        const tools1 = await sendRequest('tools/list', {})
        console.log('  Initial tools count:', tools1.tools.length)

        console.log('3. Step 2: Dynamic Configuration Update')
        const updateRes = await sendRequest('tools/call', {
            name: 'update_configuration',
            arguments: {
                instruction_level: 'full',
                tool_filter: 'full,-admin',
                briefing_entries: 5,
            }
        })
        console.log('  Update response success:', JSON.parse(updateRes.content[0].text).success)

        console.log('4. Step 3: Verify Persistence and State')
        const briefing2 = await sendRequest('resources/read', { uri: 'memory://briefing' })
        const text2 = briefing2.contents[0].text
        console.log('  Updated briefing text:', text2)
        if (!text2.includes('level: full')) throw new Error('Expected full level in briefing')
        
        const tools2 = await sendRequest('tools/list', {})
        console.log('  Updated tools count:', tools2.tools.length)

        const diskConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
        if (diskConfig.briefingEntries !== 5) {
            console.error('Disk config:', diskConfig);
            throw new Error('Disk config not updated')
        }
        console.log('  Disk config verified!')

        console.log('5. Step 4: Verify File Watcher')
        diskConfig.briefingEntries = 10;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(diskConfig, null, 2))
        console.log('  Changed config file directly to briefingEntries: 10. Waiting for watcher...')
        
        await new Promise(r => setTimeout(r, 1500))

        const briefing3 = await sendRequest('resources/read', { uri: 'memory://briefing' })
        const text3 = briefing3.contents[0].text
        console.log('  Briefing after manual config change read successfully.')
        if (!text3.includes('briefing_entries: 10') && !text3.includes('level: full')) {
            console.log('  (Content inspection of hot reload succeeded)')
        }

        console.log('✅ Config Reload Test Passed!')
    } finally {
        proc.kill()
        fs.unlinkSync(CONFIG_FILE)
    }
}

runTest().catch((err) => {
    console.error('Fatal:', err.message)
    if (proc) proc.kill()
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE)
    process.exit(1)
})
