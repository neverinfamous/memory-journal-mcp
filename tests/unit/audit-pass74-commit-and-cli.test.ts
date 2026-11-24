import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { execFileSpy } = vi.hoisted(() => {
    const spy = vi.fn(
        (
            _file: string,
            _args: readonly string[],
            _optsOrCb: unknown,
            maybeCb?: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
            const cb = typeof _optsOrCb === 'function' ? (_optsOrCb as typeof maybeCb) : maybeCb
            cb?.(new Error('fatal: bad object'), '', 'fatal: bad object')
        }
    )
    return { execFileSpy: spy }
})

vi.mock('node:child_process', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    return {
        ...actual,
        execFile: execFileSpy,
    }
})

import { normalizeCliArgv } from '../../src/cli/program.js'
import { applyCliEntryFlagAliases } from '../../src/cli/commands/entry-payload-helpers.js'
import { prefetchBatchCommitFiles, resolveEntryAnchors } from '../../src/handlers/tools/core/entry-anchors.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('audit pass74 negative anchor caching, default-command argv normalization, and prompt invariants', () => {
    beforeEach(() => {
        execFileSpy.mockClear()
    })

    it('B-H1: prefetchBatchCommitFiles negatively caches failed SHAs and deduplicates case variations', async () => {
        const context = {
            config: {
                projectRegistry: {
                    'sample-repo': { path: os.tmpdir(), project_number: 16 },
                },
            },
        } as never

        const items = Array.from({ length: 5 }, () => ({
            autoContext: JSON.stringify({ commits: ['deadbeef1234', 'DEADBEEF1234'] }),
            workspaceId: 'sample-repo',
        }))

        const prefetched = await prefetchBatchCommitFiles(items, context)
        expect(execFileSpy).toHaveBeenCalledTimes(1)
        expect(prefetched.get(`${os.tmpdir()}\0deadbeef1234`)).toEqual([])

        for (const item of items) {
            const anchors = await resolveEntryAnchors(
                undefined,
                item.autoContext,
                item.workspaceId,
                context,
                prefetched
            )
            expect(anchors).toBeUndefined()
        }
        expect(execFileSpy).toHaveBeenCalledTimes(1)
    })

    it('B-M1: normalizeCliArgv includes default serve command flags and skips value tokens during subcommand discovery', () => {
        const program = new Command('memory-journal-mcp')
        program
            .option('--json', 'Output help as JSON')
            .command('serve [args...]', { isDefault: true })
            .option('--auth-token <token>', 'Auth token')
            .option('--default-workspace-id <id>', 'Default workspace')
            .option('--log-level <level>', 'Log level')
        program.command('commit [args...]').allowUnknownOption(true).allowExcessArguments(true)

        expect(
            normalizeCliArgv(['node', 'cli.js', '--auth-token', '--my_secret_token'], program)
        ).toEqual(['node', 'cli.js', '--auth-token', '--my_secret_token'])

        expect(
            normalizeCliArgv(['node', 'cli.js', '--auth_token', '--', '--log_level', 'debug'], program)
        ).toEqual(['node', 'cli.js', '--auth-token', '--', '--log-level', 'debug'])

        expect(
            normalizeCliArgv(
                ['node', 'cli.js', '--default-workspace-id', 'commit', '--log_level', 'debug'],
                program
            )
        ).toEqual(['node', 'cli.js', '--default-workspace-id', 'commit', '--log-level', 'debug'])

        expect(
            normalizeCliArgv(
                ['node', 'cli.js', '--json', 'commit', '--msg', '--foo_bar', '--journal_project', '5'],
                program
            )
        ).toEqual([
            'node',
            'cli.js',
            '--json',
            'commit',
            '--msg',
            '--foo_bar',
            '--journal-project',
            '5',
        ])

        const cliIndexSrc = fs.readFileSync(
            path.resolve(process.cwd(), 'src/cli/index.ts'),
            'utf8'
        )
        const commitRegPos = cliIndexSrc.indexOf(".command('commit [args...]')")
        const normCallPos = cliIndexSrc.indexOf('normalizeCliArgv(process.argv, program)')
        expect(commitRegPos).toBeGreaterThan(-1)
        expect(normCallPos).toBeGreaterThan(commitRegPos)
    })

    it('B-L3: applyCliEntryFlagAliases prefers workspace_id ahead of workspace', () => {
        const opts = { workspace: 'ws-a', workspace_id: 'ws-b' }
        applyCliEntryFlagAliases(opts)
        expect(opts.workspaceId).toBe('ws-b')
    })

    it('AP1-AP2: exports pass74 revision and portable guardrails', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass81')
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const perfText =
                (await getPerformanceAuditPromptDefinition().handler({ target: 'src', copilot: 'false' }, db))
                    .messages[0]?.content.text ?? ''
            const cqText =
                (await getCodeQualityAuditPromptDefinition().handler({ target: 'src', copilot: 'false' }, db))
                    .messages[0]?.content.text ?? ''

            expect(perfText).toContain('Prompt revision: 2026-11-24-audit-pass81')
            expect(perfText).toContain('negative `[]` hits')
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass81')
            expect(cqText).toContain('isDefault: true')
            expect(cqText).toContain('received NaN')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
        } finally {
            db.close()
        }
    })
})
