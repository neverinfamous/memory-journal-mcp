import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { buildEntryPayload, parseFrontmatter } from '../../src/cli/commands/entry-payload.js'

describe('Pass 64 Commit Pipeline Hardening & Prompts (P-L1, Q-M4, AP1–AP2)', () => {
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

    it('P-L1: parses frontmatter and object anchors cleanly via hoisted UNKNOWN_RECORD_SCHEMA', () => {
        const parsed = parseFrontmatter(
            '---\ntype: technical_note\nworkspace_id: memory-journal-mcp\nproject: 5\nanchors:\n  - anchor_path: src/cli/index.ts\n    anchor_type: file\n---\nBody\n'
        )
        const payload = buildEntryPayload({}, parsed.frontmatter, {
            projectRegistry: {
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
            },
        })
        expect(payload.anchors).toEqual([{ anchor_path: 'src/cli/index.ts', anchor_type: 'file' }])
    })

    it('Q-M4: memory-journal-mcp --json commit preserves commit flags even when a trailing "commit" token appears', () => {
        const cliScript = path.resolve(process.cwd(), 'src', 'cli', 'index.ts')
        const tsxCli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
        const res = spawnSync(
            process.execPath,
            [
                tsxCli,
                cliScript,
                '--json',
                'commit',
                '--msg',
                'feat(cli): commit word test',
                '--impact',
                'invalid_num',
                '--confidence',
                '0.9',
                '--validation',
                'passed',
                'commit',
            ],
            { cwd: process.cwd(), encoding: 'utf8', windowsHide: true }
        )
        expect(res.status).not.toBe(0)
        // Must validate --impact rather than mis-slicing at the trailing "commit" token and reporting Missing Commit Message
        expect(res.stderr).toContain('--impact:')
        expect(res.stderr).not.toContain('Missing Commit Message')
    }, 30_000)

    it('AP1–AP2: bumps AUDIT_PROMPT_REVISION to pass64 and embeds Pass 64 performance and code-quality checks', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass90')

        const dbPath = path.join(
            os.tmpdir(),
            `mj-pass64-prompts-${String(process.pid)}-${String(Date.now())}.db`
        )
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()
            const perfRes = await getPerformanceAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const perfText = perfRes.messages[0]?.content.text ?? ''
            expect(perfText).toContain('Prompt revision: 2026-11-24-audit-pass90')
            expect(perfText).toContain('inside-loop Zod schema constructors')
            expect(perfText).toContain('redundant pre-filter `git ls-files` subprocesses')
            expect(perfText).toContain('explore')
            expect(perfText).toContain('generalPurpose')
            expect(perfText).not.toMatch(/[A-Z]:\\Users\\/i)

            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass90')
            expect(cqText).toContain('case-sensitive scratch/private-path guards')
            expect(cqText).toContain('per-entry registry sanitization')
            expect(cqText).toContain('shorter short-flag prefix checks (`-m*`)')
            expect(cqText).toContain('boolean global flags like `--json`')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
            for (const suffix of ['', '-wal', '-shm']) {
                const f = `${dbPath}${suffix}`
                if (fs.existsSync(f)) fs.rmSync(f, { force: true })
            }
        }
    })
})
