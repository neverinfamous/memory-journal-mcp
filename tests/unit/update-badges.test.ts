import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    buildCommitInvocation,
    countE2eSpecFiles,
    isPartialPlaywrightRun,
    loadBadgeMetrics,
} from '../../scripts/update-badges.js'

function writeJson(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
}

function createSpecFiles(rootDir: string, relativePaths: readonly string[]): void {
    for (const rel of relativePaths) {
        const fullPath = path.join(rootDir, 'tests', 'e2e', rel)
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, '// spec\n', 'utf-8')
    }
}

describe('update-badges script helpers', () => {
    let tempDir = ''

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-badges-test-'))
    })

    afterEach(() => {
        if (tempDir.length > 0 && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })

    describe('buildCommitInvocation', () => {
        it('spawns node directly with tsx cli and preserves multi-word --msg argument', () => {
            const inv = buildCommitInvocation(tempDir, ['README.md', 'DOCKER_README.md'])
            expect(inv.command).toBe(process.execPath)
            expect(inv.args[0]).toBe(path.join(tempDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'))
            expect(inv.args[1]).toBe(path.join(tempDir, 'scripts', 'commit.ts'))

            const msgIndex = inv.args.indexOf('--msg')
            expect(msgIndex).toBeGreaterThan(-1)
            expect(inv.args[msgIndex + 1]).toBe('chore(docs): update test badges')
            expect(inv.args).toContain('--add')
            expect(inv.args).toContain('README.md')
            expect(inv.args).toContain('DOCKER_README.md')
        })
    })

    describe('countE2eSpecFiles & isPartialPlaywrightRun', () => {
        it('counts spec and test files recursively under tests/e2e', () => {
            createSpecFiles(tempDir, [
                'a.spec.ts',
                'nested/b.test.ts',
                'nested/helpers.ts',
                'c.spec.mts',
            ])
            expect(countE2eSpecFiles(path.join(tempDir, 'tests', 'e2e'))).toBe(3)
        })

        it('detects partial Playwright runs when fewer suites ran than spec files exist', () => {
            createSpecFiles(tempDir, ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'])
            expect(isPartialPlaywrightRun({ suites: [{}, {}] }, tempDir, [])).toBe(true)
            expect(isPartialPlaywrightRun({ suites: [{}, {}, {}] }, tempDir, [])).toBe(false)
        })

        it('allows partial runs when --allow-partial is passed', () => {
            createSpecFiles(tempDir, ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'])
            expect(isPartialPlaywrightRun({ suites: [{}] }, tempDir, ['--allow-partial'])).toBe(
                false
            )
        })
    })

    describe('loadBadgeMetrics', () => {
        beforeEach(() => {
            createSpecFiles(tempDir, ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'])
            writeJson(path.join(tempDir, '.test-output/coverage/coverage-summary.json'), {
                total: { lines: { pct: 82.85 } },
            })
            writeJson(path.join(tempDir, '.test-output/playwright-results.json'), {
                suites: [{}, {}, {}],
                stats: { expected: 464, skipped: 0 },
            })
        })

        it('loads only coverage metrics when --coverage-only is passed', () => {
            const metrics = loadBadgeMetrics({ rootDir: tempDir, argv: ['--coverage-only'] })
            expect(metrics.hasCoverage).toBe(true)
            expect(metrics.linesPct).toBe(82.85)
            expect(metrics.hasE2e).toBe(false)
        })

        it('loads only E2E metrics when --e2e-only is passed', () => {
            const metrics = loadBadgeMetrics({ rootDir: tempDir, argv: ['--e2e-only'] })
            expect(metrics.hasCoverage).toBe(false)
            expect(metrics.hasE2e).toBe(true)
            expect(metrics.e2ePassing).toBe(464)
            expect(metrics.e2eSkipped).toBe(0)
        })

        it('skips E2E metrics when Playwright results reflect a partial spec run', () => {
            writeJson(path.join(tempDir, '.test-output/playwright-results.json'), {
                suites: [{}],
                stats: { expected: 15, skipped: 0 },
            })
            const metrics = loadBadgeMetrics({ rootDir: tempDir, argv: [] })
            expect(metrics.hasCoverage).toBe(true)
            expect(metrics.hasE2e).toBe(false)
        })

        it('updates E2E metrics from a partial run when --allow-partial is passed', () => {
            writeJson(path.join(tempDir, '.test-output/playwright-results.json'), {
                suites: [{}],
                stats: { expected: 15, skipped: 1 },
            })
            const metrics = loadBadgeMetrics({ rootDir: tempDir, argv: ['--allow-partial'] })
            expect(metrics.hasCoverage).toBe(true)
            expect(metrics.hasE2e).toBe(true)
            expect(metrics.e2ePassing).toBe(15)
            expect(metrics.e2eSkipped).toBe(1)
        })
    })
})
