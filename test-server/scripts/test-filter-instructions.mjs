/**
 * Filter-Aware Instruction Validation
 *
 * Starts the server with various --tool-filter configs and verifies that
 * each instruction section is correctly included or excluded based on enabled
 * tool groups. Also verifies that the dynamic index at memory://help properly
 * reflects the enabled groups.
 *
 * Usage:
 *   pnpm run build && node test-server/scripts/test-filter-instructions.mjs
 */

import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(__dirname, '../..')

const SECTIONS = {
    CORE: 'Essential Behaviors',
    CODE_MODE: '## Code Mode',
    CODEMODE_REF: '# Code Mode API Reference',
    HELP_POINTERS: '## Available Help',
    ACTIVE_TOOLS: '## Active Tools',
}

const HELP_GROUP_ORDER = [
    'core',
    'search',
    'analytics',
    'relationships',
    'io',
    'admin',
    'github',
    'git',
    'backup',
    'team',
    'codemode',
]

const ALL_GROUPS = [...HELP_GROUP_ORDER].sort()

const TEST_CONFIGS = [
    {
        label: 'full (all groups)',
        filter: null, // default
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ALL_GROUPS,
        expectedTools: 108,
        expectedActiveTools: 108,
    },
    {
        // With default codemodeInternalFullAccess=false, memory://help scopes to registered MCP tools
        // (ALWAYS_ENABLED_TOOLS keeps mj_execute_code + update_configuration)
        label: 'codemode only (default sandbox scoping)',
        filter: 'codemode',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: true, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ['admin', 'codemode'],
        expectedTools: 2,
        expectedActiveTools: 2,
    },
    {
        // With --codemode-internal-full-access, memory://help and Available Help expand to all 11 groups
        // while ## Active Tools stays scoped to the 2 registered MCP tools
        label: 'codemode + --codemode-internal-full-access',
        filter: 'codemode',
        extraArgs: ['--codemode-internal-full-access'],
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: true, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ALL_GROUPS,
        expectedTools: 108,
        expectedActiveTools: 2,
    },
    {
        label: 'essential (core+admin+codemode — no github)',
        filter: 'essential',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ['core', 'admin', 'codemode'],
        expectedTools: 11,
        expectedActiveTools: 11,
    },
    {
        label: 'starter (core+search+admin+codemode — no github)',
        filter: 'starter',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ['core', 'search', 'admin', 'codemode'],
        expectedTools: 17,
        expectedActiveTools: 17,
    },
    {
        // ALWAYS_ENABLED_TOOLS keeps mj_execute_code + update_configuration active;
        // memory://help scopes to enabled groups unless --codemode-internal-full-access is set.
        label: 'core only (escape hatch keeps Code Mode + update_configuration)',
        filter: 'core',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ['core', 'admin', 'codemode'],
        expectedTools: 11,
        expectedActiveTools: 11,
    },
    {
        // -codemode removes the group, then the escape hatch adds mj_execute_code back.
        label: 'full -codemode (escape hatch keeps Code Mode)',
        filter: '-codemode',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ALL_GROUPS,
        expectedTools: 108,
        expectedActiveTools: 108,
    },
    {
        label: 'full -github (no github, no copilot)',
        filter: '-github',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ALL_GROUPS.filter((g) => g !== 'github'),
        expectedTools: 90,
        expectedActiveTools: 90,
    },
    {
        label: 'readonly (core+search+analytics+relationships+io+admin+git+codemode)',
        filter: 'readonly',
        expect: { CORE: true, CODE_MODE: true, CODEMODE_REF: false, HELP_POINTERS: true, ACTIVE_TOOLS: true },
        expectedGroups: ['core', 'search', 'analytics', 'relationships', 'io', 'admin', 'git', 'codemode'],
        expectedTools: 24,
        expectedActiveTools: 24,
    },
]

function sendJsonRpc(proc, id, method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
}

function parseHelpIndexMessage(msg) {
    const content = msg.result?.contents?.[0]?.text
    if (typeof content !== 'string') return { availableGroups: [], totalTools: 0 }
    try {
        const parsed = JSON.parse(content)
        return {
            availableGroups: Array.isArray(parsed.groups) ? parsed.groups.map((g) => g.name) : [],
            totalTools: parsed.totalTools ?? 0,
        }
    } catch {
        return { availableGroups: [], totalTools: 0 }
    }
}

function handleServerLine(proc, trimmed, config, state, finish) {
    let msg
    try {
        msg = JSON.parse(trimmed)
    } catch {
        return
    }
    if (msg.id === 1 && msg.result) {
        state.instructions =
            msg.result?.serverInfo?.instructions ||
            msg.result?.instructions ||
            msg.result?.capabilities?.instructions ||
            ''
        sendJsonRpc(proc, 2, 'resources/read', { uri: 'memory://help' })
        return
    }
    if (msg.id === 2) {
        if (msg.error) {
            console.error('Resource read error:', msg.error)
            finish(state)
            return
        }
        const parsed = parseHelpIndexMessage(msg)
        state.availableGroups = parsed.availableGroups
        state.totalTools = parsed.totalTools
        if (!config.expectedGroups.includes('github')) {
            sendJsonRpc(proc, 3, 'resources/read', { uri: 'memory://help/github' })
            return
        }
        finish(state)
        return
    }
    if (msg.id === 3) {
        const text = msg.result?.contents?.[0]?.text
        state.staticHelpReadable = typeof text === 'string' && text.includes('GitHub')
        finish(state)
    }
}

function runConfig(config) {
    return new Promise((resolve, reject) => {
        const args = [
            'dist/cli.js',
            'serve',
            '--config',
            'test-server/scripts/test-server-config.json',
            '--transport',
            'stdio',
            '--db',
            ':memory:',
            '--team-db',
            ':memory:',
        ]
        if (config.filter) args.push('--tool-filter', config.filter)
        if (Array.isArray(config.extraArgs)) args.push(...config.extraArgs)

        const proc = spawn('node', args, {
            cwd: PROJECT_DIR,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                TEST_DB_PATH: ':memory:',
                TEST_TEAM_DB_PATH: ':memory:',
                DB_ENCRYPTION_KEY: '',
                MJ_DB_ENCRYPTION_KEY: '',
                GITHUB_DB_PATH: ':memory:',
            },
        })

        let buffer = ''
        const state = {
            instructions: '',
            availableGroups: [],
            totalTools: 0,
            staticHelpReadable: config.expectedGroups.includes('github'),
        }
        const timeoutId = setTimeout(() => {
            proc.kill()
            reject(new Error('Timeout'))
        }, 25000)

        const finish = (out) => {
            clearTimeout(timeoutId)
            proc.kill()
            resolve(out)
        }

        proc.stdout.on('data', (chunk) => {
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed) handleServerLine(proc, trimmed, config, state, finish)
            }
        })

        proc.stderr.on('data', () => {})

        sendJsonRpc(proc, 1, 'initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'filter-instruction-test', version: '1.0' },
        })
    })
}

function tokenEstimate(text) {
    return Math.round(text.length / 4)
}

function checkSections(instructions, expect) {
    const results = {}
    for (const [key, marker] of Object.entries(SECTIONS)) {
        const present = instructions.includes(marker)
        const shouldBePresent = expect[key]
        results[key] = {
            present,
            expected: shouldBePresent,
            pass: present === shouldBePresent,
        }
    }
    return results
}

function checkGroups(actualGroups, expectedGroups) {
    const missing = expectedGroups.filter((g) => !actualGroups.includes(g))
    const unexpected = actualGroups.filter((g) => !expectedGroups.includes(g))
    return {
        pass: missing.length === 0 && unexpected.length === 0,
        missing,
        unexpected,
    }
}

function validateConfigResult(config, result) {
    const { instructions, availableGroups, totalTools, staticHelpReadable } = result
    const sectionResults = checkSections(instructions, config.expect)
    const groupResults = checkGroups(availableGroups, config.expectedGroups)
    const sectionFailures = Object.entries(sectionResults).filter(([, r]) => !r.pass)
    const orderedExpectedGroups = HELP_GROUP_ORDER.filter((g) => config.expectedGroups.includes(g))
    const expectedPointer = `Read \`memory://help/{group}\` for: ${orderedExpectedGroups.join(', ')}.`

    const extraErrors = []
    if (totalTools !== config.expectedTools) {
        extraErrors.push(`[INVALID COUNT] totalTools=${totalTools} (expected ${config.expectedTools})`)
    }
    if (!instructions.includes(`## Active Tools (${config.expectedActiveTools})`)) {
        extraErrors.push(`[INVALID ACTIVE COUNT] missing '## Active Tools (${config.expectedActiveTools})'`)
    }
    if (!instructions.includes(expectedPointer)) {
        extraErrors.push(`[INVALID HELP POINTER] expected '${expectedPointer}'`)
    }
    if (!config.expectedGroups.includes('github')) {
        if (instructions.includes('**github**:') || instructions.includes('get_copilot_reviews')) {
            extraErrors.push('[UNEXPECTED] excluded github tools leaked into Active Tools')
        }
        if (!staticHelpReadable) {
            extraErrors.push('[MISSING] static fallback memory://help/github should remain readable')
        }
    }

    const allPass = sectionFailures.length === 0 && groupResults.pass && extraErrors.length === 0
    return { sectionResults, sectionFailures, groupResults, extraErrors, allPass }
}

async function main() {
    console.log('=== Filter-Aware Instruction Validation ===\n')
    console.log('Checking that instruction sections are correctly included/excluded')
    console.log('and dynamic index groups are correctly registered.\n')

    let totalPassed = 0
    let totalFailed = 0
    const rows = []

    for (const config of TEST_CONFIGS) {
        process.stdout.write(`  Testing: ${config.label} ... `)
        let result
        try {
            result = await runConfig(config)
        } catch (err) {
            console.log(`❌ ERROR: ${err.message}`)
            totalFailed++
            continue
        }

        const { instructions, totalTools } = result
        const chars = instructions.length
        const tokens = tokenEstimate(instructions)
        const check = validateConfigResult(config, result)

        if (check.allPass) {
            console.log(`✅ (${chars} chars, ~${tokens} tokens, ${totalTools} help tools, ${config.expectedActiveTools} active)`)
            totalPassed++
        } else {
            console.log(`❌ (${chars} chars, ~${tokens} tokens, ${totalTools} help tools)`)
            totalFailed++
            for (const msg of check.extraErrors) console.log(`      ${msg}`)
            for (const [section, r] of check.sectionFailures) {
                const action = r.expected ? 'MISSING' : 'UNEXPECTED'
                console.log(`      [${action}] SECTION ${section}`)
            }
            for (const g of check.groupResults.missing) console.log(`      [MISSING] GROUP ${g}`)
            for (const g of check.groupResults.unexpected) console.log(`      [UNEXPECTED] GROUP ${g}`)
        }

        rows.push({ label: config.label, chars, tokens, pass: check.allPass, sectionResults: check.sectionResults })
    }

    // Token summary table
    console.log('\n=== Token Estimates by Filter ===\n')
    console.log(`  ${'Filter'.padEnd(62)} ${'Chars'.padStart(6)} ${'~Tokens'.padStart(8)} ${'Sections'.padStart(36)}`)
    console.log(`  ${'-'.repeat(62)} ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(36)}`)
    for (const row of rows) {
        const sectionSummary = Object.entries(row.sectionResults)
            .filter(([, r]) => r.present)
            .map(([k]) => k.toLowerCase().replace('_', '-'))
            .join('+')
        console.log(`  ${row.label.padEnd(62)} ${String(row.chars).padStart(6)} ${String(row.tokens).padStart(8)}   ${sectionSummary}`)
    }

    console.log(`\n=== Results: ${totalPassed} passed, ${totalFailed} failed ===\n`)
    process.exit(totalFailed > 0 ? 1 : 0)
}

main().catch((err) => {
    console.error('Fatal:', err.message)
    process.exit(1)
})
