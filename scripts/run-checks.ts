import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

const testOutputDir = join(process.cwd(), '.test-output')
const healthStatusFile = join(testOutputDir, 'health-status.json')

const target = process.argv[2] // 'lint', 'typecheck', or undefined for all
if (target !== undefined && target !== 'lint' && target !== 'typecheck') {
    console.error(`Unknown check target '${target}'. Expected lint or typecheck.`)
    process.exit(1)
}

function isEnoent(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function runCommand(command: string, args: string[]): boolean {
    const fullCommand = `${command} ${args.join(' ')}`
    const result = spawnSync(fullCommand, { stdio: 'inherit', shell: true })
    return result.status === 0
}

function checkFileLengths(): boolean {
    const warnings: { path: string; lines: number }[] = []
    const violations: { path: string; lines: number }[] = []

    const walk = (dir: string): void => {
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch (error) {
            if (isEnoent(error)) return
            throw error
        }
        for (const entry of entries) {
            const fullPath = join(dir, entry.name)
            if (/[/\\](vendor|node_modules|dist|third_party|coverage|build|\.next|out)[/\\]?/.test(fullPath)) continue
            if (entry.isDirectory()) {
                walk(fullPath)
            } else if (
                entry.isFile() &&
                /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) &&
                !/\.(test|spec)\./.test(entry.name)
            ) {
                const content = readFileSync(fullPath, 'utf-8')
                const segments = content.split(/\r?\n/)
                // [INVARIANT] A trailing newline does not start a new line (parity with editor/PowerShell counts).
                const lines = segments.at(-1) === '' ? segments.length - 1 : segments.length
                if (lines > 500) {
                    violations.push({ path: fullPath, lines })
                } else if (lines >= 450) {
                    warnings.push({ path: fullPath, lines })
                }
                if (
                    (dir === 'src' || dir.startsWith(`src${sep}`)) &&
                    /(?:realpathSync|path\.resolve)\([^)]*\)(?:(?!path\.relative)[\s\S]){0,120}\.startsWith\((?!['"]\.\.['"])/.test(
                        content
                    )
                ) {
                    console.warn(
                        `⚠️  Path boundary warning: prefer path.relative() over .startsWith() after path.resolve/realpathSync in ${fullPath}`
                    )
                }
            }
        }
    }

    walk('src')
    walk('scripts')

    for (const w of warnings.sort((a, b) => b.lines - a.lines)) {
        console.warn(`⚠️  File approaching 500-line ceiling (${String(w.lines)} lines): ${w.path}`)
    }

    for (const v of violations.sort((a, b) => b.lines - a.lines)) {
        console.error(`❌ File exceeds 500-line ceiling (${String(v.lines)} lines): ${v.path}`)
    }

    return violations.length === 0
}

let lintOk = true
let typecheckOk = true

// Load existing state if available
try {
    const existing = JSON.parse(readFileSync(healthStatusFile, 'utf-8')) as {
        lintOk?: boolean
        typecheckOk?: boolean
    }
    lintOk = existing.lintOk ?? true
    typecheckOk = existing.typecheckOk ?? true
} catch {
    // missing or unreadable health file
}

mkdirSync(testOutputDir, { recursive: true })

let success = true

if (!target || target === 'lint') {
    console.log('Running lint...')
    const passed = runCommand('pnpm', ['exec', 'eslint', 'src/', 'tests/'])
    console.log('Checking file lengths (<= 500 lines)...')
    const lengthsPassed = checkFileLengths()
    lintOk = passed && lengthsPassed
    if (!passed || !lengthsPassed) success = false
}

if (!target || target === 'typecheck') {
    console.log('Running typecheck...')
    const passed = runCommand('pnpm', ['exec', 'tsc', '--noEmit'])
    typecheckOk = passed
    if (!passed) success = false
}

if (!target) {
    // Also run code-map if running all
    console.log('Running code-map generation...')
    const codeMapPassed = runCommand('pnpm', ['exec', 'tsx', 'scripts/update-code-map.ts'])
    if (!codeMapPassed) success = false

    // Run workspace isolation check
    console.log('Running workspace isolation check...')
    const unassignedPassed = runCommand('pnpm', [
        'exec',
        'tsx',
        'scripts/check-unassigned-entries.ts',
    ])
    if (!unassignedPassed) success = false
}

console.log(success ? 'Checks passed!' : 'Checks failed!')
// [INVARIANT] `ok` reflects every tracked gate, so a partial run cannot mask a previously failed gate.
writeFileSync(
    healthStatusFile,
    JSON.stringify({ ok: success && lintOk && typecheckOk, lintOk, typecheckOk, timestamp: Date.now() }, null, 2)
)

if (!success) {
    process.exit(1)
}
