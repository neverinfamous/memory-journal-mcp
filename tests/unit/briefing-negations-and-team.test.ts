/**
 * Briefing audit follow-ups: `--no-` negations, BRIEFING_COPILOT env alias, team-query skip.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { addBriefingOptions, addCoreOptions } from '../../src/cli/option-groups.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { buildTeamContext } from '../../src/handlers/resources/core/briefing/team-and-graph-context.js'

const ENV_KEYS = [
    'BRIEFING_COPILOT',
    'BRIEFING_COPILOT_REVIEWS',
    'BRIEFING_PR_STATUS',
    'BRIEFING_WORKFLOW_STATUS',
    'BRIEFING_INCLUDE_TEAM',
    'BRIEFING_GRAPH',
    'BRIEFING_INSIGHTS',
    'BRIEFING_PR_COUNT',
] as const

function resolveBriefingWithErrors(
    argv: string[],
    fileConfig: Record<string, unknown> = {}
): {
    bc: NonNullable<ReturnType<typeof buildServerOptions>['serverOptions']['briefingConfig']>
    errors: string[]
} {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-briefing-neg-'))
    const file = path.join(dir, 'cfg.json')
    try {
        fs.writeFileSync(file, JSON.stringify(fileConfig), 'utf-8')
        const cmd = addBriefingOptions(addCoreOptions(new Command('serve')))
        cmd.parse(['node', 'mj', ...argv])
        const errors: string[] = []
        const options = buildServerOptions(
            new ConfigResolver(cmd, cmd.opts(), file),
            cmd.opts(),
            cmd,
            errors
        )
        const bc = options.serverOptions.briefingConfig
        if (bc === undefined) throw new Error('briefingConfig missing')
        return { bc, errors }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

function resolveBriefing(
    argv: string[],
    fileConfig: Record<string, unknown> = {}
): NonNullable<ReturnType<typeof buildServerOptions>['serverOptions']['briefingConfig']> {
    const { bc, errors } = resolveBriefingWithErrors(argv, fileConfig)
    expect(errors.filter((e) => e.toLowerCase().includes('briefing'))).toEqual([])
    return bc
}

describe('briefing boolean negations and env alias', () => {
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}
    beforeEach(() => {
        for (const k of ENV_KEYS) {
            saved[k] = process.env[k]
            delete process.env[k]
        }
    })
    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
        }
    })

    it('--no-* flags override env and config-file true', () => {
        process.env['BRIEFING_PR_STATUS'] = 'true'
        process.env['BRIEFING_WORKFLOW_STATUS'] = 'true'
        process.env['BRIEFING_INCLUDE_TEAM'] = 'true'
        const bc = resolveBriefing(
            [
                '--no-briefing-pr-status',
                '--no-briefing-workflow-status',
                '--no-briefing-include-team',
                '--no-briefing-copilot',
            ],
            { briefingCopilot: true }
        )
        expect(bc.prStatusBreakdown).toBe(false)
        expect(bc.workflowStatusBreakdown).toBe(false)
        expect(bc.includeTeam).toBe(false)
        expect(bc.copilotReviews).toBe(false)
    })

    it('positive flags still enable and omitted flags keep defaults', () => {
        const on = resolveBriefing([
            '--briefing-pr-status',
            '--briefing-workflow-status',
            '--briefing-include-team',
            '--briefing-copilot',
        ])
        expect(on.prStatusBreakdown).toBe(true)
        expect(on.workflowStatusBreakdown).toBe(true)
        expect(on.includeTeam).toBe(true)
        expect(on.copilotReviews).toBe(true)

        const off = resolveBriefing([])
        expect(off.prStatusBreakdown).toBe(false)
        expect(off.workflowStatusBreakdown).toBe(false)
        expect(off.includeTeam).toBe(false)
        expect(off.copilotReviews).toBe(false)
    })

    it('accepts BRIEFING_COPILOT as an alias; legacy BRIEFING_COPILOT_REVIEWS wins when both set', () => {
        process.env['BRIEFING_COPILOT'] = 'true'
        expect(resolveBriefing([]).copilotReviews).toBe(true)

        process.env['BRIEFING_COPILOT_REVIEWS'] = 'false'
        expect(resolveBriefing([]).copilotReviews).toBe(false)

        delete process.env['BRIEFING_COPILOT']
        process.env['BRIEFING_COPILOT_REVIEWS'] = 'true'
        expect(resolveBriefing([]).copilotReviews).toBe(true)
    })

    it('supports positive and negative --briefing-graph / --briefing-insights overrides and CLI briefingPrs precedence', () => {
        process.env['BRIEFING_GRAPH'] = 'false'
        process.env['BRIEFING_INSIGHTS'] = 'false'
        const reEnabled = resolveBriefing(['--briefing-graph', '--briefing-insights'])
        expect(reEnabled.graphPivots).toBe(true)
        expect(reEnabled.insights).toBe(true)

        const disabled = resolveBriefing(['--no-briefing-graph', '--no-briefing-insights'], {
            briefingGraph: true,
            briefingInsights: true,
        })
        expect(disabled.graphPivots).toBe(false)
        expect(disabled.insights).toBe(false)

        const prPrecedence = resolveBriefing(['--briefing-prs', '7', '--briefing-pr-count', '2'])
        expect(prPrecedence.prCount).toBe(7)
    })

    it('rejects out-of-range (>100), negative, and explicit blank briefing numeric values', () => {
        const tooHigh = resolveBriefingWithErrors(['--briefing-entries', '101'])
        expect(tooHigh.errors.some((e) => e.includes('briefingEntries'))).toBe(true)

        const negative = resolveBriefingWithErrors(['--briefing-commits', '-1'])
        expect(negative.errors.some((e) => e.includes('briefingCommits'))).toBe(true)

        const blankThreshold = resolveBriefingWithErrors(['--briefing-importance-threshold', '   '])
        expect(blankThreshold.errors.some((e) => e.includes('briefingImportanceThreshold'))).toBe(true)
    })
})

describe('buildTeamContext with briefingEntries: 0', () => {
    it('skips team entry queries but keeps the team total', () => {
        const searchEntries = vi.fn().mockReturnValue([])
        const getActiveEntryCount = vi.fn().mockReturnValue(42)
        const context = {
            teamDb: { searchEntries, getActiveEntryCount },
            runtime: { teamDefaultRole: 'admin' },
        } as never
        const config = {
            entryCount: 0,
            includeTeam: true,
            defaultWorkspaceId: 'ws',
            defaultProjectNumber: 5,
            projectRegistry: { ws: { path: '/x', project_number: 5 } },
        } as never

        const result = buildTeamContext(context, config, 5, 'ws')
        expect(searchEntries).not.toHaveBeenCalled()
        expect(result).toBeDefined()
        expect(result?.teamInfo.totalEntries).toBe(42)
        expect(result?.teamLatestEntries).toEqual([])
    })
})
