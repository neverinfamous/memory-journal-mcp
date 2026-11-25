import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import {
    prefetchBatchCommitFiles,
    resolveEntryAnchors,
} from '../../src/handlers/tools/core/entry-anchors.js'

const TEST_GIT_ENV: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'commit.gpgsign',
    GIT_CONFIG_VALUE_0: 'false',
}

describe('Pass 61 Commit Pipeline Prompts & NUL-Delimited Anchor Extraction', () => {
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

    it('AP1–AP2: bumps AUDIT_PROMPT_REVISION to pass61 and includes POSIX --, --root/-z, and trailer newline checks', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass90')

        const adapter = new DatabaseAdapter(':memory:', { projectRegistry: {} })
        try {
            await adapter.initialize()
            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass90')
            expect(cqText).toContain('POSIX `--` end-of-options')
            expect(cqText).toContain('`--root`')
            expect(cqText).toContain('core.quotePath=true')
            expect(cqText).toContain('raw trailer injection')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
        }
    })

    it('P-L2: resolveEntryAnchors and prefetchBatchCommitFiles preserve non-ASCII filenames via git show -z', async () => {
        const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-anchors-utf8-'))
        const adapter = new DatabaseAdapter(':memory:', {
            projectRegistry: { 'utf8-repo': { path: tmpRepo, project_number: 77 } },
        })
        try {
            await adapter.initialize()
            execFileSync('git', ['init', '--quiet'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            fs.writeFileSync(path.join(tmpRepo, 'initial.ts'), 'export const a = 1;\n', 'utf-8')
            execFileSync('git', ['add', 'initial.ts'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            execFileSync('git', ['commit', '--quiet', '--no-verify', '-m', 'chore: root'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            const sha1 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpRepo, encoding: 'utf-8', windowsHide: true, env: TEST_GIT_ENV }).trim()

            fs.writeFileSync(path.join(tmpRepo, 'café.ts'), 'export const c = 2;\n', 'utf-8')
            execFileSync('git', ['add', 'café.ts'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            execFileSync('git', ['commit', '--quiet', '--no-verify', '-m', 'feat: add non-ascii file'], { cwd: tmpRepo, stdio: 'ignore', windowsHide: true, env: TEST_GIT_ENV })
            const sha2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpRepo, encoding: 'utf-8', windowsHide: true, env: TEST_GIT_ENV }).trim()

            const context = {
                db: adapter,
                config: { projectRegistry: { 'utf8-repo': { path: tmpRepo, project_number: 77 } } },
            }

            const prefetched = await prefetchBatchCommitFiles(
                [
                    { autoContext: JSON.stringify({ commits: [sha1] }), workspaceId: 'utf8-repo' },
                    { autoContext: JSON.stringify({ commits: [sha2] }), workspaceId: 'utf8-repo' },
                ],
                context
            )
            expect(prefetched.get(`${tmpRepo}\0${sha1.toLowerCase()}`)).toEqual(['initial.ts'])
            expect(prefetched.get(`${tmpRepo}\0${sha2.toLowerCase()}`)).toEqual(['café.ts'])

            const anchors = await resolveEntryAnchors(
                undefined,
                JSON.stringify({ commits: [sha2] }),
                'utf8-repo',
                context
            )
            expect(anchors).toEqual([{ anchorPath: 'café.ts', anchorType: 'file' }])
        } finally {
            adapter.close()
            fs.rmSync(tmpRepo, { recursive: true, force: true })
        }
    }, 30_000)
})
