import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const testOutputDir = join(process.cwd(), '.test-output')
const healthStatusFile = join(testOutputDir, 'health-status.json')
const normPath = (p: string): string =>
    process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)
const isMain =
    process.argv[1] !== undefined &&
    normPath(process.argv[1]) === normPath(fileURLToPath(import.meta.url))

export const IGNORE_DIR_REGEX =
    /(?:^|[/\\])(\.git|vendor|third_party|node_modules|dist|coverage|build|\.next|out|\.wrangler|\.turbo|\.output|\.svelte-kit|\.test-output)(?:[/\\]|$)/

function isEnoent(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function runNodeBin(binSegments: string[], args: string[]): boolean {
    const binPath = resolve(process.cwd(), ...binSegments)
    const result = spawnSync(process.execPath, [binPath, ...args], {
        stdio: 'inherit',
        shell: false,
    })
    return result.status === 0
}

function checkFileLengths(): boolean {
    const warnings: { path: string; lines: number }[] = []
    const violations: { path: string; lines: number }[] = []
    let largeTestFiles = 0

    const walk = (dir: string): void => {
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch (error) {
            if (isEnoent(error)) return
            throw error
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue
            const fullPath = join(dir, entry.name)
            if (IGNORE_DIR_REGEX.test(fullPath)) continue
            if (entry.isDirectory()) {
                walk(fullPath)
            } else if (
                entry.isFile() &&
                (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ||
                    ((dir === 'skills' || dir.startsWith(`skills${sep}`)) &&
                        entry.name.endsWith('.md'))) &&
                !entry.name.endsWith('.d.ts')
            ) {
                const content = readFileSync(fullPath, 'utf-8')
                const segments = content.split(/\r?\n/)
                // [INVARIANT] A trailing newline does not start a new line (parity with editor/PowerShell counts).
                const lines = segments.at(-1) === '' ? segments.length - 1 : segments.length
                if (/\.(test|spec|bench)\./.test(entry.name)) {
                    if (lines > 500) largeTestFiles++
                    continue
                }
                if (lines > 500) {
                    violations.push({ path: fullPath, lines })
                } else if (lines >= 451) {
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
    walk('skills')
    walk('tests')

    if (largeTestFiles > 0) {
        console.log(
            `ℹ️  Advisory: ${String(largeTestFiles)} legacy test file(s) exceed 500 lines (non-test helpers in tests/ remain capped at 500 lines).`
        )
    }

    for (const w of warnings.sort((a, b) => b.lines - a.lines)) {
        console.warn(`⚠️  File approaching 500-line ceiling (${String(w.lines)} lines): ${w.path}`)
    }

    for (const v of violations.sort((a, b) => b.lines - a.lines)) {
        console.error(`❌ File exceeds 500-line ceiling (${String(v.lines)} lines): ${v.path}`)
    }

    return violations.length === 0
}

function hasLintableSkillFiles(dir = 'skills'): boolean {
    let entries
    try {
        entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
        if (isEnoent(error)) return false
        throw error
    }
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const fullPath = join(dir, entry.name)
        if (IGNORE_DIR_REGEX.test(fullPath)) continue
        if (entry.isDirectory()) {
            if (hasLintableSkillFiles(fullPath)) return true
        } else if (entry.isFile() && /\.(?:ts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            return true
        }
    }
    return false
}

function runFullSuiteFollowupChecks(): boolean {
    console.log('Running code-map generation...')
    const codeMapPassed = runNodeBin(
        ['node_modules', 'tsx', 'dist', 'cli.mjs'],
        ['scripts/update-code-map.ts']
    )
    console.log('Running workspace isolation check...')
    const unassignedPassed = runNodeBin(
        ['node_modules', 'tsx', 'dist', 'cli.mjs'],
        ['scripts/check-unassigned-entries.ts']
    )
    return codeMapPassed && unassignedPassed
}

function runChecksMain(): void {
    const target = process.argv[2] // 'lint', 'typecheck', or undefined for all
    if (target !== undefined && target !== 'lint' && target !== 'typecheck') {
        console.error(`Unknown check target '${target}'. Expected lint or typecheck.`)
        process.exit(1)
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
        const lintDirs = ['src/', 'tests/', 'scripts/', ...(hasLintableSkillFiles() ? ['skills/'] : [])]
        const passed = runNodeBin(['node_modules', 'eslint', 'bin', 'eslint.js'], lintDirs)
        console.log('Checking file lengths (<= 500 lines)...')
        const lengthsPassed = checkFileLengths()
        lintOk = passed && lengthsPassed
        if (!passed || !lengthsPassed) success = false
    }

    if (!target || target === 'typecheck') {
        console.log('Running typecheck...')
        const passed =
            runNodeBin(['node_modules', 'typescript', 'bin', 'tsc'], ['--noEmit']) &&
            runNodeBin(
                ['node_modules', 'typescript', 'bin', 'tsc'],
                ['-p', 'tsconfig.scripts.json', '--noEmit']
            )
        typecheckOk = passed
        if (!passed) success = false
    }

    if (!target) {
        if (!runFullSuiteFollowupChecks()) success = false
    }

    console.log(success ? 'Checks passed!' : 'Checks failed!')
    // [INVARIANT] `ok` reflects every tracked gate, so a partial run cannot mask a previously failed gate.
    writeFileSync(
        healthStatusFile,
        JSON.stringify(
            { ok: success && lintOk && typecheckOk, lintOk, typecheckOk, timestamp: Date.now() },
            null,
            2
        )
    )

    if (!success) {
        process.exit(1)
    }
}

if (isMain) {
    runChecksMain()
}
