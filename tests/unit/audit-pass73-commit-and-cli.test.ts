import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import * as os from 'node:os'

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
import { resolveEntryAnchors } from '../../src/handlers/tools/core/entry-anchors.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('audit pass73 commit CLI, anchor batching, and prompt invariants', () => {
    beforeEach(() => {
        execFileSpy.mockClear()
    })

    it('preserves commit subcommand string flag values and normalizes flags after --msg -- (Q-M4)', () => {
        const program = new Command('memory-journal-mcp')
        program.command('commit [args...]').allowUnknownOption(true).allowExcessArguments(true)

        expect(
            normalizeCliArgv(
                [
                    'node',
                    'cli.js',
                    'commit',
                    '--history',
                    '--fix_bug',
                    '--tags',
                    '--foo_bar',
                    '--history-file',
                    '--tmp_hist.txt',
                ],
                program
            )
        ).toEqual([
            'node',
            'cli.js',
            'commit',
            '--history',
            '--fix_bug',
            '--tags',
            '--foo_bar',
            '--history-file',
            '--tmp_hist.txt',
        ])

        expect(
            normalizeCliArgv(
                ['node', 'cli.js', 'commit', '--msg', '--', '--journal_project', '16'],
                program
            )
        ).toEqual(['node', 'cli.js', 'commit', '--msg', '--', '--journal-project', '16'])
    })

    it('avoids duplicate single-SHA git show retry in resolveEntryAnchors (P-M1)', async () => {
        const result = await resolveEntryAnchors(
            undefined,
            JSON.stringify({ commits: ['deadbeef1234'] }),
            'companion',
            {
                config: {
                    projectRegistry: {
                        companion: { path: os.tmpdir(), project_number: 16 },
                    },
                },
            } as never
        )
        expect(result).toBeUndefined()
        expect(execFileSpy).toHaveBeenCalledTimes(1)
    })

    it('exports pass73 revision and portable AP1-AP2 prompt guardrails', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass79')
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const perfText =
                (await getPerformanceAuditPromptDefinition().handler({ target: 'src', copilot: 'false' }, db))
                    .messages[0]?.content.text ?? ''
            const cqText =
                (await getCodeQualityAuditPromptDefinition().handler({ target: 'src', copilot: 'false' }, db))
                    .messages[0]?.content.text ?? ''

            expect(perfText).toContain('Prompt revision: 2026-11-24-audit-pass79')
            expect(perfText).toContain('shas.length <= 1')
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass79')
            expect(cqText).toContain('expectValue')
            expect(cqText).toContain('repoRoot')
            expect(cqText).toContain('UTF-8 BOM')
            expect(cqText).toContain('non-blank string/project alias precedence')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
        } finally {
            db.close()
        }
    })
})
