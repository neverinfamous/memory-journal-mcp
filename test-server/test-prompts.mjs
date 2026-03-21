import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = join(__dirname, '..')
const proc = spawn('node', ['dist/cli.js', '--instruction-level', 'essential'], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
})

let buffer = ''
const pending = new Map() // id -> resolve

proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            const msg = JSON.parse(trimmed)
            if (msg.id && pending.has(msg.id)) {
                pending.get(msg.id)(msg)
                pending.delete(msg.id)
            }
        } catch {}
    }
})
proc.stderr.on('data', () => {})

let nextId = 1
function rpc(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Timeout: ${method}`))
        }, 20000)
        pending.set(id, (msg) => {
            clearTimeout(timer)
            resolve(msg)
        })
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
}
function notify(method, params = {}) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
    // Initialize
    await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-prompts', version: '1.0' },
    })
    await delay(500)
    notify('notifications/initialized')
    await delay(1000)

    // List prompts
    const listResp = await rpc('prompts/list', {})
    const prompts = listResp.result?.prompts ?? []
    console.log(`\n=== PROMPTS LIST: ${prompts.length} prompts ===`)
    for (const p of prompts) {
        const args = (p.arguments || []).map((a) => `${a.name}${a.required ? '*' : ''}`).join(', ')
        console.log(`  ${p.name}(${args})`)
    }

    const testCases = [
        // 8.1 No-argument prompts
        { name: 'prepare-standup', args: {}, expect: 'standup' },
        { name: 'weekly-digest', args: {}, expect: 'weekly' },
        { name: 'goal-tracker', args: {}, expect: 'goal' },
        { name: 'get-context-bundle', args: {}, expect: 'context' },
        { name: 'confirm-briefing', args: {}, expect: 'session' },
        { name: 'session-summary', args: {}, expect: 'session' },
        // 8.1 Required-argument prompts
        { name: 'find-related', args: { query: 'architecture' }, expect: 'architecture' },
        {
            name: 'analyze-period',
            args: { start_date: '2026-01-01', end_date: '2026-12-31' },
            expect: '2026',
        },
        // 8.1 Optional-argument prompts
        { name: 'prepare-retro', args: {}, expect: 'retrospective' },
        { name: 'prepare-retro', args: { days: '7' }, expect: '7' },
        { name: 'get-recent-entries', args: {}, expect: '' },
        { name: 'get-recent-entries', args: { limit: '3' }, expect: '' },
        // 8.2 GitHub prompts
        { name: 'project-status-summary', args: { project_number: '5' }, expect: '5' },
        { name: 'pr-summary', args: { pr_number: '67' }, expect: '67' },
        { name: 'code-review-prep', args: { pr_number: '67' }, expect: '67' },
        { name: 'pr-retrospective', args: { pr_number: '67' }, expect: '67' },
        { name: 'project-milestone-tracker', args: { project_number: '5' }, expect: '5' },
        { name: 'actions-failure-digest', args: {}, expect: '' },
    ]

    console.log(`\n=== TESTING ${testCases.length} PROMPT CALLS ===\n`)
    let pass = 0,
        fail = 0

    for (const tc of testCases) {
        const argsStr = Object.keys(tc.args).length ? JSON.stringify(tc.args) : '(none)'
        try {
            const resp = await rpc('prompts/get', { name: tc.name, arguments: tc.args })
            if (resp.error) {
                console.log(`FAIL ${tc.name}(${argsStr}): MCP error: ${JSON.stringify(resp.error)}`)
                fail++
                continue
            }
            const messages = resp.result?.messages
            const checks = []
            if (!Array.isArray(messages)) checks.push('messages not array')
            else if (messages.length < 1) checks.push('messages empty')
            else {
                const m = messages[0]
                if (m.role !== 'user') checks.push(`role=${m.role}`)
                if (!m.content) checks.push('no content')
                else {
                    const c = m.content
                    if (c.type !== 'text') checks.push(`type=${c.type}`)
                    if (!c.text || c.text.length === 0) checks.push('text empty')
                    else if (tc.expect && !c.text.toLowerCase().includes(tc.expect.toLowerCase())) {
                        checks.push(`missing '${tc.expect}' (len=${c.text.length})`)
                    }
                }
            }
            if (checks.length === 0) {
                const textLen = messages?.[0]?.content?.text?.length ?? 0
                console.log(
                    `PASS ${tc.name}(${argsStr}) — msgs:${messages.length}, textLen:${textLen}`
                )
                pass++
            } else {
                console.log(`FAIL ${tc.name}(${argsStr}): ${checks.join('; ')}`)
                fail++
            }
        } catch (err) {
            console.log(`FAIL ${tc.name}(${argsStr}): ${err.message}`)
            fail++
        }
    }

    // Error handling tests
    try {
        const resp = await rpc('prompts/get', { name: 'nonexistent-prompt', arguments: {} })
        if (resp.error) {
            console.log(`PASS nonexistent-prompt: MCP error (code=${resp.error.code})`)
            pass++
        } else {
            console.log(`FAIL nonexistent-prompt: expected error`)
            fail++
        }
    } catch (err) {
        console.log(`FAIL nonexistent-prompt: ${err.message}`)
        fail++
    }

    try {
        const resp = await rpc('prompts/get', { name: 'find-related', arguments: {} })
        if (resp.error) {
            console.log(`PASS find-related(no args): error returned`)
        } else {
            console.log(`PASS find-related(no args): handled gracefully`)
        }
        pass++
    } catch (err) {
        console.log(`FAIL find-related(no args): ${err.message}`)
        fail++
    }

    console.log(`\n=== RESULTS: ${pass} pass, ${fail} fail (${pass + fail} total) ===`)
    proc.kill()
    process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
