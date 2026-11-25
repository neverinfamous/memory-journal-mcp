import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { resolveEntryAnchors } from '../../src/handlers/tools/core/entry-anchors.js'
import { createEntryFromFileInProcess } from '../../src/cli/commands/entry.js'

const TEST_GIT_ENV: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
}

describe('Pass 65 Commit Pipeline Hardening & Prompts (Q-M5, Q-M6, Q-L3, AP1–AP2)', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        delete process.env['DB_ENCRYPTION_KEY']
    })

    afterEach(() => {
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    })

    it('Q-M5: memory-journal-mcp commit normalizes snake_case flags (e.g. --journal_project) via normalizeCliArgv', () => {
        const cliScript = path.resolve(process.cwd(), 'src', 'cli', 'index.ts')
        const tsxCli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
        const res = spawnSync(
            process.execPath,
            [
                tsxCli,
                cliScript,
                'commit',
                '--msg',
                'feat(cli): snake case test',
                '--impact',
                '0.5',
                '--confidence',
                '0.9',
                '--validation',
                'passed',
                '--journal_project',
                'not_a_number',
            ],
            { cwd: process.cwd(), encoding: 'utf8', windowsHide: true }
        )
        expect(res.status).not.toBe(0)
        expect(res.stderr).toContain('--journal-project:')
        expect(res.stderr).not.toContain('Unknown option')
    }, 30_000)

    it('Q-M6: resolveEntryAnchors preserves anchors for valid SHAs when a multi-SHA auto_context includes an unresolvable SHA', async () => {
        const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-anchors-partial-'))
        const adapter = new DatabaseAdapter(':memory:', {
            projectRegistry: { 'partial-repo': { path: tmpRepo, project_number: 88 } },
        })
        try {
            await adapter.initialize()
            execFileSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            fs.writeFileSync(path.join(tmpRepo, 'kept.ts'), 'export const kept = true;\n', 'utf-8')
            execFileSync('git', ['add', 'kept.ts'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', 'feat: add kept'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            const validSha = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: tmpRepo,
                encoding: 'utf-8',
                windowsHide: true,
                env: TEST_GIT_ENV,
            }).trim()

            const anchors = await resolveEntryAnchors(
                undefined,
                JSON.stringify({ commits: [validSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'] }),
                'partial-repo',
                {
                    db: adapter,
                    config: { projectRegistry: { 'partial-repo': { path: tmpRepo, project_number: 88 } } },
                }
            )
            expect(anchors).toEqual([{ anchorPath: 'kept.ts', anchorType: 'file' }])
        } finally {
            adapter.close()
            fs.rmSync(tmpRepo, { recursive: true, force: true })
        }
    }, 30_000)

    it('Q-L3: createEntryFromFileInProcess fails fast on blank file paths without waiting for stdin', async () => {
        const t0 = performance.now()
        const code = await createEntryFromFileInProcess({ file: '   ' })
        const elapsedMs = performance.now() - t0
        expect(code).toBe(1)
        expect(elapsedMs).toBeLessThan(500)
    })

    it('AP1–AP2: bumps AUDIT_PROMPT_REVISION to pass65 and embeds Pass 65 performance and code-quality checks', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')

        const adapter = new DatabaseAdapter(':memory:', { projectRegistry: {} })
        try {
            await adapter.initialize()
            const perfRes = await getPerformanceAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const perfText = perfRes.messages[0]?.content.text ?? ''
            expect(perfText).toContain('Prompt revision: 2026-11-25-audit-pass95')
            expect(perfText).toContain('unconditional `git rev-parse --git-dir`')
            expect(perfText).toContain('two-stage batch path classifiers')
            expect(perfText).toContain('explore')
            expect(perfText).toContain('generalPurpose')
            expect(perfText).not.toMatch(/[A-Z]:\\Users\\/i)

            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-25-audit-pass95')
            expect(cqText).toContain('--add scratch/')
            expect(cqText).toContain('--cwd ""')
            expect(cqText).toContain('--msg ""')
            expect(cqText).toContain('normalized argv (breaking `snake_case` flag healing)')
            expect(cqText).toContain('multi-SHA `git show ...shas`')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
        }
    })
})
