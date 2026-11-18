import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
import {
    compactOversizedResult,
    serializeAndEnforceEgress,
} from '../../src/codemode/worker/result-compactor.js'
import { sanitizeAuditEntryForEgress } from '../../src/audit/audit-resource.js'
import type { AuditEntry } from '../../src/audit/types.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { autoPopulateGithubUrls } from '../../src/handlers/tools/codemode/dispatch-github-urls.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { resolveDatabasePaths, type CatchConfig } from '../../src/cli/server-options-groups.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { parseByteSizeValue } from '../../src/codemode/shared-context-parsers.js'
import { extractNestedMaxResultSize } from '../../src/codemode/worker/nested-exec-payload.js'
import type { SandboxResult } from '../../src/codemode/types.js'
import type { ToolContext } from '../../src/types/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function makeTempDir(prefix: string): string {
    const dir = path.join(
        process.cwd(),
        '.test-output',
        `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    )
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

const catchConfig: CatchConfig = <T>(fn: () => T, fallback: T): T => {
    try {
        return fn()
    } catch {
        return fallback
    }
}

describe('Pass 40 Adversarial Code-Quality Audit — Core, Sandbox & CLI (H1-H4, M9/L8)', () => {
    const tempDirs: string[] = []
    let savedEncKey: string | undefined
    let savedConfig: string | undefined
    let savedDbPath: string | undefined
    let savedTeamDbPath: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['DB_ENCRYPTION_KEY']
        savedConfig = process.env['MEMORY_JOURNAL_CONFIG']
        savedDbPath = process.env['DB_PATH']
        savedTeamDbPath = process.env['TEAM_DB_PATH']
        process.env['DB_ENCRYPTION_KEY'] = ''
        delete process.env['MEMORY_JOURNAL_CONFIG']
        delete process.env['DB_PATH']
        delete process.env['TEAM_DB_PATH']
    })

    afterEach(() => {
        if (savedEncKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
        else process.env['DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedConfig === undefined) delete process.env['MEMORY_JOURNAL_CONFIG']
        else process.env['MEMORY_JOURNAL_CONFIG'] = savedConfig
        if (savedDbPath === undefined) delete process.env['DB_PATH']
        else process.env['DB_PATH'] = savedDbPath
        if (savedTeamDbPath === undefined) delete process.env['TEAM_DB_PATH']
        else process.env['TEAM_DB_PATH'] = savedTeamDbPath

        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) {
                fs.rmSync(dir, { recursive: true, force: true })
            }
        }
    })

    it('H1: distinguishes shared DAG references from true cycles and handles BigInt safely', () => {
        const shared = { tag: 'shared-leaf' }
        const dagPayload = { first: shared, second: shared, count: BigInt(42) }

        const compacted = compactOversizedResult(dagPayload, 4096)
        expect(isRecord(compacted)).toBe(true)
        if (!isRecord(compacted)) return

        expect(compacted['first']).toEqual({ tag: 'shared-leaf' })
        expect(compacted['second']).toEqual({ tag: 'shared-leaf' })
        expect(compacted['count']).toBe('42')

        const sandboxRes: SandboxResult = {
            success: true,
            result: dagPayload,
            metrics: { wallTimeMs: 1, cpuTimeMs: 0, memoryUsedMb: 1 },
        }
        expect(() => serializeAndEnforceEgress(sandboxRes, 4096)).not.toThrow()
        const serializedJson = JSON.stringify(sandboxRes.result)
        expect(serializedJson).not.toContain('[Circular]')
        expect(serializedJson).toContain('"count":"42"')

        const cyclic: Record<string, unknown> = { ok: true }
        cyclic['self'] = cyclic
        const cyclicCompacted = compactOversizedResult(cyclic, 4096)
        expect(isRecord(cyclicCompacted)).toBe(true)
        if (isRecord(cyclicCompacted)) {
            expect(cyclicCompacted['self']).toBe('[Circular]')
        }

        const dagAudit: AuditEntry = {
            timestamp: '2026-11-18T00:00:00.000Z',
            requestId: 'req-1',
            tool: 'create_entry',
            category: 'write',
            scope: 'write',
            user: null,
            scopes: [],
            durationMs: 2,
            success: true,
            args: { first: shared, second: shared, cyc: cyclic },
        }
        const safeAudit = sanitizeAuditEntryForEgress(dagAudit)
        expect(isRecord(safeAudit.args)).toBe(true)
        if (isRecord(safeAudit.args)) {
            expect(safeAudit.args['first']).toEqual({
                tag: '<untrusted_remote_content>shared-leaf</untrusted_remote_content>',
            })
            expect(safeAudit.args['second']).toEqual({
                tag: '<untrusted_remote_content>shared-leaf</untrusted_remote_content>',
            })
            expect(isRecord(safeAudit.args['cyc'])).toBe(true)
            if (isRecord(safeAudit.args['cyc'])) {
                expect(safeAudit.args['cyc']['self']).toBe('[Circular]')
            }
        }

        const issueSanitized = sanitizeIssueInput({ first: shared, second: shared, cyc: cyclic })
        expect(isRecord(issueSanitized)).toBe(true)
        if (isRecord(issueSanitized)) {
            expect(issueSanitized['first']).toEqual({ tag: 'shared-leaf' })
            expect(issueSanitized['second']).toEqual({ tag: 'shared-leaf' })
            expect(isRecord(issueSanitized['cyc'])).toBe(true)
            if (isRecord(issueSanitized['cyc'])) {
                expect(issueSanitized['cyc']['self']).toBe('[Circular]')
            }
        }
    })

    it('H2: blocks cross-workspace GitHub issue_url leakage and skips null issue_number', async () => {
        const tmpDir = makeTempDir('pass40-h2')
        tempDirs.push(tmpDir)
        const unmatchedPath = path.join(tmpDir, 'other-repo')
        fs.mkdirSync(unmatchedPath, { recursive: true })

        const db = new DatabaseAdapter(path.join(tmpDir, 'journal.db'))
        await db.initialize()
        try {
            const github = new GitHubIntegration(process.cwd())
            github.setCachedRepoInfo({
                owner: 'neverinfamous',
                repo: 'memory-journal-mcp',
                branch: 'main',
                remoteUrl: 'https://github.com/neverinfamous/memory-journal-mcp.git',
            })

            const ctx: ToolContext = {
                db,
                github,
                config: {
                    defaultProjectNumber: 5,
                    githubOwner: 'neverinfamous',
                    githubRepo: 'memory-journal-mcp',
                    projectRegistry: {
                        alpha: { path: unmatchedPath, project_number: 7 },
                        current: { path: process.cwd(), project_number: 5 },
                    },
                },
            }

            const alphaParams: Record<string, unknown> = {
                workspace_id: 'alpha',
                issue_number: 42,
            }
            await autoPopulateGithubUrls(alphaParams, ctx, 'alpha', 7)
            expect(alphaParams['issue_url']).toBeUndefined()

            const unregisteredParams: Record<string, unknown> = {
                workspace_id: 'unregistered-repo',
                issue_number: 42,
            }
            await autoPopulateGithubUrls(unregisteredParams, ctx, 'unregistered-repo', undefined)
            expect(unregisteredParams['issue_url']).toBeUndefined()

            const nullIssueParams: Record<string, unknown> = {
                workspace_id: 'current',
                issue_number: null,
            }
            await autoPopulateGithubUrls(nullIssueParams, ctx, 'current', 5)
            expect(nullIssueParams['issue_url']).toBeUndefined()

            const matchingParams: Record<string, unknown> = {
                workspace_id: 'current',
                issue_number: 42,
            }
            await autoPopulateGithubUrls(matchingParams, ctx, 'current', 5)
            expect(matchingParams['issue_url']).toBe(
                'https://github.com/neverinfamous/memory-journal-mcp/issues/42'
            )
        } finally {
            db.close()
        }
    })

    it('H3: healCodeModeScript leaves string and template literals intact while rewriting top-level syntax', () => {
        const script = [
            "import { helper } from './mod.js';",
            "const dq = \"import x from 'y'; export const z = 1; require('fs'); <PROJECT_NUMBER>\";",
            'const sq = \'export default 1; JSON.parse("{bad");\';',
            'const tpl = `require(\'child_process\') <PROJECT_NUMBER>`;',
            'return { dq, sq, tpl };',
        ].join('\n')

        const healed = healCodeModeScript(script)
        expect(healed).not.toMatch(/^import\s+\{\s*helper/m)
        expect(healed).toContain(
            "const dq = \"import x from 'y'; export const z = 1; require('fs'); <PROJECT_NUMBER>\";"
        )
        expect(healed).toContain('const sq = \'export default 1; JSON.parse("{bad");\';')
        expect(healed).toContain('const tpl = `require(\'child_process\') <PROJECT_NUMBER>`;')
    })

    it('H4: resolveDatabasePaths preserves explicit CLI and env DB paths over config file paths', () => {
        const tmpDir = makeTempDir('pass40-h4')
        tempDirs.push(tmpDir)
        const cfgPath = path.join(tmpDir, 'config.json')
        const configDb = path.join(tmpDir, 'config-override.db')
        const configTeamDb = path.join(tmpDir, 'config-team.db')
        fs.writeFileSync(
            cfgPath,
            JSON.stringify({ db: configDb, teamDb: configTeamDb }),
            'utf-8'
        )

        const cliCmd = new Command()
            .option('--db <path>', 'db path')
            .option('--team-db <path>', 'team db path')
            .option('--test-db <path>', 'test db path')
            .option('--test-team-db <path>', 'test team db path')
        cliCmd.parse(
            ['node', 'cli', '--db', './memory_journal.db', '--team-db', './team.db'],
            { from: 'node' }
        )
        const cliResolver = new ConfigResolver(cliCmd, cliCmd.opts(), cfgPath)
        const cliPaths = resolveDatabasePaths(cliResolver, catchConfig)
        expect(cliPaths.db).toBe('./memory_journal.db')
        expect(cliPaths.teamDb).toBe('./team.db')

        process.env['DB_PATH'] = './explicit-env.db'
        const envCmd = new Command()
            .option('--db <path>', 'db path', './memory_journal.db')
            .option('--team-db <path>', 'team db path')
            .option('--test-db <path>', 'test db path')
            .option('--test-team-db <path>', 'test team db path')
        envCmd.parse(['node', 'cli'], { from: 'node' })
        const envResolver = new ConfigResolver(envCmd, envCmd.opts(), cfgPath)
        const envPaths = resolveDatabasePaths(envResolver, catchConfig)
        expect(envPaths.db).toBe('./explicit-env.db')
    })

    it('M9 & L8: parseByteSizeValue and extractNestedMaxResultSize enforce valid units and bounds', () => {
        expect(parseByteSizeValue('128kb')).toBe(128 * 1024)
        expect(parseByteSizeValue('2mb')).toBe(2 * 1024 * 1024)
        expect(parseByteSizeValue('128xyz')).toBeUndefined()
        expect(extractNestedMaxResultSize({ max_result_size_kb: 64 }, 32 * 1024)).toBe(32 * 1024)
        expect(extractNestedMaxResultSize({ max_result_size_kb: 16 }, 32 * 1024)).toBe(16 * 1024)
    })
})
