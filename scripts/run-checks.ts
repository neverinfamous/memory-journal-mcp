import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const testOutputDir = join(process.cwd(), '.test-output')
const healthStatusFile = join(testOutputDir, 'health-status.json')

const target = process.argv[2] // 'lint', 'typecheck', or undefined for all

function runCommand(command: string, args: string[]) {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: true })
    return result.status === 0
}

let lintOk = true
let typecheckOk = true

// Load existing state if available
if (existsSync(healthStatusFile)) {
    try {
        const existing = JSON.parse(readFileSync(healthStatusFile, 'utf-8'))
        lintOk = existing.lintOk ?? true
        typecheckOk = existing.typecheckOk ?? true
    } catch {}
}

mkdirSync(testOutputDir, { recursive: true })

let success = true

if (!target || target === 'lint') {
    console.log('Running lint...')
    const passed = runCommand('npx', ['eslint', 'src/', 'tests/'])
    lintOk = passed
    if (!passed) success = false
}

if (!target || target === 'typecheck') {
    console.log('Running typecheck...')
    const passed = runCommand('npx', ['tsc', '--noEmit'])
    typecheckOk = passed
    if (!passed) success = false
}

if (!target) {
    // Also run code-map if running all
    console.log('Running code-map generation...')
    runCommand('npx', ['tsx', 'scripts/update-code-map.ts'])
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
