import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { execFileMock } = vi.hoisted(() => ({
    execFileMock: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>()
    return {
        ...actual,
        execFile: execFileMock,
    }
})

import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { resolveEntryAnchors } from '../../src/handlers/tools/core/entry-anchors.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'
import { loadBadgeMetrics } from '../../scripts/update-badges.js'

describe('Pass 96 Commit Pipeline Hardening & Portable Prompts (PERF-M1, CQ-L5, AP1–AP3)', () => {
    it('PERF-M1: short-circuits multi-SHA batch git show fallback on repo-level failure (not a git repository)', async () => {
        execFileMock.mockReset()
        execFileMock.mockImplementation(
            (_cmd: string, _args: readonly string[], _opts: unknown, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
                const callback = typeof _opts === 'function' ? (_opts as (err: Error | null, stdout: string, stderr: string) => void) : cb
                const err = Object.assign(new Error('Command failed: fatal: not a git repository'), {
                    stderr: 'fatal: not a git repository (or any of the parent directories): .git',
                })
                callback?.(err, '', err.stderr)
            }
        )

        const adapter = new DatabaseAdapter(':memory:', { projectRegistry: {} })
        try {
            await adapter.initialize()
            const anchors = await resolveEntryAnchors(
                undefined,
                JSON.stringify({
                    commits: [
                        '1111111111111111111111111111111111111111',
                        '2222222222222222222222222222222222222222',
                        '3333333333333333333333333333333333333333',
                    ],
                }),
                'non-git-repo',
                {
                    db: adapter,
                    config: { projectRegistry: { 'non-git-repo': { path: os.tmpdir(), project_number: 5 } } },
                }
            )
            expect(anchors).toBeUndefined()
            expect(execFileMock).toHaveBeenCalledTimes(1)
        } finally {
            adapter.close()
        }
    })

    it('CQ-L5: loadBadgeMetrics strips UTF-8 BOM and throws instead of calling process.exit in --strict mode', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass96-badges-'))
        const origGh = process.env['GITHUB_ACTIONS']
        try {
            delete process.env['GITHUB_ACTIONS']
            expect(() => loadBadgeMetrics({ rootDir: tmpDir, argv: ['--strict'] })).toThrow(
                /Strict mode active/
            )

            const covPath = path.join(tmpDir, '.test-output', 'coverage', 'coverage-summary.json')
            fs.mkdirSync(path.dirname(covPath), { recursive: true })
            fs.writeFileSync(covPath, `\uFEFF${JSON.stringify({ total: { lines: { pct: 91.5 } } })}`, 'utf-8')
            const metrics = loadBadgeMetrics({ rootDir: tmpDir, argv: ['--coverage-only'] })
            expect(metrics.hasCoverage).toBe(true)
            expect(metrics.linesPct).toBe(91.5)
        } finally {
            if (origGh !== undefined) process.env['GITHUB_ACTIONS'] = origGh
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('AP1–AP3: bumps AUDIT_PROMPT_REVISION to 2026-11-25-audit-pass96 and embeds Pass 96 portable rules', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass96')

        const adapter = new DatabaseAdapter(':memory:', { projectRegistry: {} })
        try {
            await adapter.initialize()
            const perfRes = await getPerformanceAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const perfText = perfRes.messages[0]?.content.text ?? ''
            expect(perfText).toContain('Prompt revision: 2026-11-25-audit-pass96')
            expect(perfText).toContain('not a git repository')
            expect(perfText).toContain('explore')
            expect(perfText).toContain('generalPurpose')
            expect(perfText).not.toMatch(/[A-Z]:\\Users\\/i)

            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-25-audit-pass96')
            expect(cqText).toContain('--attr-source')
            expect(cqText).toContain('package-manager script-path healers')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)

            const secRes = await getSecurityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const secText = secRes.messages[0]?.content.text ?? ''
            expect(secText).toContain('Prompt revision: 2026-11-25-audit-pass96')
            expect(secText).toContain('doubles trailing backslashes before')
            expect(secText).toContain('explore')
            expect(secText).toContain('generalPurpose')
            expect(secText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
        }
    })
})
