import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const testOutputDir = join(process.cwd(), '.test-output')
const healthStatusFile = join(testOutputDir, 'health-status.json')

const target = process.argv[2] // 'lint', 'typecheck', or undefined for all

function runCommand(command: string, args: string[]): boolean {
    const fullCommand = `${command} ${args.join(' ')}`
    const result = spawnSync(fullCommand, { stdio: 'inherit', shell: true })
    return result.status === 0
}

function checkFileLengths(): boolean {
    const warnings: { path: string; lines: number }[] = []
    const violations: { path: string; lines: number }[] = []

    const walk = (dir: string): void => {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir)) {
            const fullPath = join(dir, entry)
            if (/[/\\](vendor|node_modules|dist)[/\\]?/.test(fullPath)) continue
            const stat = statSync(fullPath)
            if (stat.isDirectory()) {
                walk(fullPath)
            } else if (
                /\.(ts|tsx|js|mjs|cjs)$/.test(entry) &&
                !/\.(test|spec)\./.test(entry)
            ) {
                const content = readFileSync(fullPath, 'utf-8')
                const lines = content.split(/\r?\n/).length
                if (lines > 500) {
                    violations.push({ path: fullPath, lines })
                } else if (lines >= 450) {
                    warnings.push({ path: fullPath, lines })
                }
                if (
                    dir.startsWith('src') &&
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
if (existsSync(healthStatusFile)) {
    try {
        const existing = JSON.parse(readFileSync(healthStatusFile, 'utf-8')) as {
            lintOk?: boolean
            typecheckOk?: boolean
        }
        lintOk = existing.lintOk ?? true
        typecheckOk = existing.typecheckOk ?? true
    } catch {
        // ignore
    }
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

const overallOk = lintOk && typecheckOk

console.log(success ? 'Checks passed!' : 'Checks failed!')
writeFileSync(
    healthStatusFile,
    JSON.stringify({ ok: overallOk, lintOk, typecheckOk, timestamp: Date.now() }, null, 2)
)

if (!success) {
    process.exit(1)
}
