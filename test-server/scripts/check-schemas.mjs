import { spawn } from 'child_process'

const projectDir = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp'
const proc = spawn('node', ['dist/cli.js', '--instruction-level', 'essential'], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
})

let buffer = ''
proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()

    const lines = buffer.split('\n')
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
                
                if (missingNames.length > 0) {
                    console.log(`MISSING outputSchema: ${missingNames.join(', ')}`)
                } else {
                    console.log('ALL TOOLS HAVE OUTPUT SCHEMA!')
                }

                clearTimeout(killTimeout)
                process.exit(0)
            }
        } catch { }
    }
})

proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }) + '\n')
setTimeout(() => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    setTimeout(() => {
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    }, 500)
}, 1500)

const killTimeout = setTimeout(() => {
    console.log('Timeout — killing process')
    proc.kill()
    process.exit(1)
}, 5000)
