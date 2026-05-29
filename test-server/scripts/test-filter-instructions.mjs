/**
 * Filter-Aware Instruction Validation
 *
 * Starts the server with various --tool-filter configs and verifies that
 * each instruction section is correctly included or excluded based on enabled
 * tool groups. Also reports char counts and token estimates per configuration.
 *
 * Validated sections:
 *   CORE         — always present (Essential Session Start, Behaviors)
 *   CODE_MODE    — only when `codemode` group is enabled
 *   HELP_POINTERS — dynamic help pointers at standard+ level
 *
 * Note: GitHub Integration, Copilot Review Patterns, and the Semantic search
 * Quick Access row have been moved to on-demand help (memory://help/{group})
 * and are no longer part of the init payload.
 *
 * Usage:
 *   npm run build && node test-server/scripts/test-filter-instructions.mjs
 */

import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(__dirname, '../..')

// Section markers — substrings we check for presence/absence in instructions
const SECTIONS = {
    CORE: 'Essential Session Start', // Always present
    CODE_MODE: '## Code Mode', // codemode group only
    HELP_POINTERS: 'Available Help', // standard+ level only
}

// Test matrix: each entry defines a filter config and expected section presence
const TEST_CONFIGS = [
    {
        label: 'full (all groups)',
        filter: null, // default
        level: 'standard',
        expect: {
            CORE: true,
            CODE_MODE: true,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'codemode only',
        filter: 'codemode',
        level: 'standard',
        expect: {
            CORE: true,
            CODE_MODE: true,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'essential (core+codemode — no github)',
        filter: 'essential',
        level: 'standard',
        // META_GROUPS.essential = ['core', 'codemode'] — no github, no search
        expect: {
            CORE: true,
            CODE_MODE: true,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'starter (core+search+codemode — no github)',
        filter: 'starter',
        level: 'standard',
        // META_GROUPS.starter = ['core', 'search', 'codemode']
        expect: {
            CORE: true,
            CODE_MODE: true,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'core only (no codemode, no github, no search)',
        filter: 'core',
        level: 'standard',
        expect: {
            CORE: true,
            CODE_MODE: false,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'full -codemode (github present, no code mode)',
        filter: '-codemode',
        level: 'standard',
        expect: {
            CORE: true,
            CODE_MODE: false,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'full -github (no github, no copilot)',
        filter: '-github',
        level: 'standard',
        expect: {
            CORE: true,
            CODE_MODE: true,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'readonly (core+search+analytics+relationships+export — no github, no codemode)',
        filter: 'readonly',
        level: 'standard',
        // META_GROUPS.readonly excludes github and codemode groups
        expect: {
            CORE: true,
            CODE_MODE: false,
            HELP_POINTERS: true,
        },
    },
    {
        label: 'full — essential level (no help pointers at essential level)',
        filter: null,
        level: 'essential',
        expect: {
            CORE: true,
            CODE_MODE: true,
            HELP_POINTERS: false,
        },
    },
]

/** Spawn server with given filter/level, send initialize, capture instructions */
function runConfig(filter, level) {
    return new Promise((resolve, reject) => {
        const args = ['dist/cli.js']
        if (filter) args.push('--tool-filter', filter)
        if (level) args.push('--instruction-level', level)

        const proc = spawn('node', args, {
            cwd: PROJECT_DIR,
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
                    if (msg.id === 1 && msg.result) {
                        const instructions =
                            msg.result?.serverInfo?.instructions ||
                            msg.result?.instructions ||
                            msg.result?.capabilities?.instructions ||
                            ''
                        proc.kill()
                        resolve(instructions)
                    }
                } catch {
                    // Incomplete JSON, keep buffering
                }
            }
        })

        proc.stderr.on('data', () => {})

        proc.stdin.write(
            JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'filter-instruction-test', version: '1.0' },
                },
            }) + '\n'
        )

        setTimeout(() => {
            proc.kill()
            reject(new Error('Timeout'))
        }, 10000)
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

async function main() {
    console.log('=== Filter-Aware Instruction Validation ===\n')
    console.log('Checking that instruction sections are correctly included/excluded')
    console.log('per enabled tool groups.\n')

    let totalPassed = 0
    let totalFailed = 0
    const rows = []

    for (const config of TEST_CONFIGS) {
        process.stdout.write(`  Testing: ${config.label} ... `)
        let instructions
        try {
            instructions = await runConfig(config.filter, config.level)
        } catch (err) {
            console.log(`❌ ERROR: ${err.message}`)
            totalFailed++
            continue
        }

        const chars = instructions.length
        const tokens = tokenEstimate(instructions)
        const sectionResults = checkSections(instructions, config.expect)

        const failures = Object.entries(sectionResults).filter(([, r]) => !r.pass)
        const allPass = failures.length === 0

        if (allPass) {
            console.log(`✅ (${chars} chars, ~${tokens} tokens)`)
            totalPassed++
        } else {
            console.log(`❌ (${chars} chars, ~${tokens} tokens)`)
            totalFailed++
            for (const [section, result] of failures) {
                const action = result.expected ? 'MISSING' : 'UNEXPECTED'
                console.log(
                    `      [${action}] ${section} — expected ${result.expected ? 'present' : 'absent'}, got ${result.present ? 'present' : 'absent'}`
                )
                console.log(`        marker: "${SECTIONS[section]}"`)
            }
        }

        rows.push({ label: config.label, chars, tokens, pass: allPass, sectionResults })
    }

    // Token summary table
    console.log('\n=== Token Estimates by Filter ===\n')
    console.log(
        `  ${'Filter'.padEnd(52)} ${'Chars'.padStart(6)} ${'~Tokens'.padStart(8)} ${'Sections'.padStart(30)}`
    )
    console.log(`  ${'-'.repeat(52)} ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(30)}`)
    for (const row of rows) {
        const sectionSummary = Object.entries(row.sectionResults)
            .map(([k, r]) => (r.present ? k.toLowerCase().replace('_', '-').slice(0, 5) : null))
            .filter(Boolean)
            .join('+')
        console.log(
            `  ${row.label.padEnd(52)} ${String(row.chars).padStart(6)} ${String(row.tokens).padStart(8)}   ${sectionSummary}`
        )
    }

    console.log(`\n=== Results: ${totalPassed} passed, ${totalFailed} failed ===\n`)
    process.exit(totalFailed > 0 ? 1 : 0)
}

main().catch((err) => {
    console.error('Fatal:', err.message)
    process.exit(1)
})
