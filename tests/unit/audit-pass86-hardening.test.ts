/**
 * Pass 86 Audit — Pretest E2E Script, Code Mode Scope Mixing, GitHub Truncation,
 * CLI Precedence & Fail-Closed Option Guards, Vector/Alias Transactions, & Date Validation.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractAndRecoverRecordCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { freezeInnerVmContext } from '../../src/codemode/worker/prototype-hardening.js'
import { deepFreezeContextClone } from '../../src/codemode/worker/result-proxy-aliases.js'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import { getGitHubReadTools } from '../../src/handlers/tools/github/read-tools.js'
import { getCopilotReviewTools } from '../../src/handlers/tools/github/copilot-tools.js'
import { getGitHubMilestoneTools } from '../../src/handlers/tools/github/milestone-tools.js'
import { createGitHubMilestoneResources } from '../../src/handlers/resources/github-milestones.js'
import { getAnalyticsTools } from '../../src/handlers/tools/analytics.js'
import { getSearchEntriesTool } from '../../src/handlers/tools/search/search-entries.js'
import { executeSemanticSearch } from '../../src/handlers/tools/search/semantic-search-helpers.js'
import { handleCrossTeamSearch } from '../../src/handlers/tools/search/cross-team.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { normalizeValidationStatus } from '../../src/cli/commands/entry-payload-helpers.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'

function parseNamedToolCallArgs(code: string): Record<string, unknown> {
    const m = /^return await \(mj\.[^)]+\)\(([\s\S]*)\);$/.exec(code.trim())
    expect(m, `Expected named call wrapper in: ${code}`).not.toBeNull()
    return JSON.parse(m?.[1] ?? '{}') as Record<string, unknown>
}

function makeCliCommand(providedKeys: string[] = []): CliCommandLike {
    const provided = new Set(providedKeys)
    return {
        name: () => 'serve',
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    }
}

describe('Pass 86 Audit — High, Moderate & Low Regressions', () => {
    const tempDirs: string[] = []
    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('P7-D-H1: pretest:e2e explicitly requires node:fs instead of relying on bare fs', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
            scripts: Record<string, string>
        }
        expect(pkg.scripts['pretest:e2e']).toContain("require('node:fs').rmSync")
    })

    it('P7-A-M1: recoverNamedToolCall avoids hybrid original+target scope mixing and omits repo* wrapper aliases', () => {
        const recovered = extractAndRecoverRecordCode({
            repo: 'repo-outer',
            workspace_id: 'ws-outer',
            project_number: 5,
            payload: {
                tool: 'search_entries',
                workspace_id: 'ws-inner',
                params: { query: 'hello' },
            },
        })
        expect(recovered).not.toBeNull()
        const args = parseNamedToolCallArgs(recovered ?? '')
        expect(args['workspace_id']).toBe('ws-inner')
        expect(args['project_number']).toBeUndefined()
        expect(args['repo']).toBeUndefined()

        const inheritedFromOuter = extractAndRecoverRecordCode({
            workspace_id: 'ws-outer',
            project_number: 9,
            payload: {
                tool: 'search_entries',
                params: { query: 'hello' },
            },
        })
        const inheritedArgs = parseNamedToolCallArgs(inheritedFromOuter ?? '')
        expect(inheritedArgs['workspace_id']).toBe('ws-outer')
        expect(inheritedArgs['project_number']).toBe(9)
    })

    it('P7-B-M1: truncates untrusted GitHub issue comments, copilot review comments, and milestone descriptions before fencing', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const hugeComment = 'x'.repeat(9000)
            const hugeDesc = 'y'.repeat(5000)
            const fakeGithub = {
                getIssue: vi.fn().mockResolvedValue({
                    number: 10,
                    title: 'Test issue',
                    body: 'short body',
                    state: 'open',
                    labels: [],
                    assignees: [],
                    author: 'octocat',
                    url: 'https://github.com/o/r/issues/10',
                    createdAt: '2026-01-01T00:00:00Z',
                    updatedAt: '2026-01-01T00:00:00Z',
                }),
                getIssueComments: vi.fn().mockResolvedValue([
                    { author: 'alice', body: hugeComment, createdAt: '2026-01-01T00:00:00Z' },
                ]),
                getPullRequest: vi.fn().mockResolvedValue({ number: 12, state: 'open' }),
                getCopilotReviewSummary: vi.fn().mockResolvedValue({
                    prNumber: 12,
                    state: 'commented',
                    commentCount: 1,
                    comments: [{ body: hugeComment, path: 'src/a.ts', line: 5 }],
                }),
                getMilestones: vi.fn().mockResolvedValue([
                    {
                        number: 1,
                        title: 'M1',
                        description: hugeDesc,
                        state: 'open',
                        openIssues: 1,
                        closedIssues: 0,
                        dueOn: null,
                        creator: 'octocat',
                        url: 'https://github.com/o/r/milestone/1',
                        createdAt: '2026-01-01T00:00:00Z',
                        updatedAt: '2026-01-01T00:00:00Z',
                    },
                ]),
                isApiAvailable: () => true,
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r', branch: 'main' }),
                getCachedRepoInfo: () => ({ owner: 'o', repo: 'r', branch: 'main' }),
            }
            const ctx = {
                db: adapter,
                config: { projectRegistry: {} },
                github: fakeGithub,
            } as unknown as Parameters<typeof getGitHubReadTools>[0]

            const issueTool = getGitHubReadTools(ctx).find((t) => t.name === 'get_github_issue')
            const issueRes = (await issueTool?.handler({
                owner: 'o',
                repo: 'r',
                issue_number: 10,
                include_comments: true,
                truncate_body: 200,
            })) as { comments?: { body: string }[] }
            expect(issueRes.comments?.[0]?.body.length ?? 0).toBeLessThan(600)
            expect(issueRes.comments?.[0]?.body).toContain('Truncated...')

            const copilotTool = getCopilotReviewTools(ctx).find((t) => t.name === 'get_copilot_reviews')
            const copilotRes = (await copilotTool?.handler({
                owner: 'o',
                repo: 'r',
                pr_number: 12,
            })) as { comments?: { body: string }[] }
            expect(copilotRes.comments?.[0]?.body.length ?? 0).toBeLessThan(8300)
            expect(copilotRes.comments?.[0]?.body).toContain('Truncated...')

            const msTool = getGitHubMilestoneTools(ctx).find((t) => t.name === 'get_github_milestones')
            const msRes = (await msTool?.handler({ owner: 'o', repo: 'r' })) as {
                milestones?: { description?: string }[]
            }
            expect(msRes.milestones?.[0]?.description?.length ?? 0).toBeLessThan(4300)
            expect(msRes.milestones?.[0]?.description).toContain('... [truncated]')

            const msResource = createGitHubMilestoneResources(20).find(
                (r) => r.uri === 'memory://github/milestones'
            )
            const msResData = (await msResource?.handler('memory://github/milestones', {
                db: adapter,
                github: fakeGithub,
                briefing: {},
            } as never)) as { data: { milestones?: { description?: string }[] } }
            expect(msResData.data.milestones?.[0]?.description?.length ?? 0).toBeLessThan(4300)
            expect(msResData.data.milestones?.[0]?.description).toContain('... [truncated]')
        } finally {
            adapter.close()
        }
    })

    it('P7-D-M1/M2/M3 & P7-D-L1: restores host Env>Config precedence and fails closed on blank/invalid CLI & config options', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p86-cli-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'config.json')

        fs.writeFileSync(cfgFile, JSON.stringify({ serverHost: '0.0.0.0' }), 'utf8')
        process.env['MCP_HOST'] = '127.0.0.1'
        const envOverCfgCmd = makeCliCommand([])
        const envOverCfgErrors: string[] = []
        const envOverCfg = buildServerOptions(
            new ConfigResolver(envOverCfgCmd, {}, cfgFile),
            {},
            envOverCfgCmd,
            envOverCfgErrors
        )
        expect(envOverCfgErrors).toEqual([])
        expect(envOverCfg.host).toBe('127.0.0.1')

        delete process.env['MCP_HOST']
        delete process.env['HOST']
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({
                serverHost: '   ',
                defaultProjectNumber: '',
                pruneImportanceThreshold: '',
                metricsExport: '',
            }),
            'utf8'
        )
        const cfgBlankCmd = makeCliCommand([])
        const cfgBlankErrors: string[] = []
        buildServerOptions(new ConfigResolver(cfgBlankCmd, {}, cfgFile), {}, cfgBlankCmd, cfgBlankErrors)
        expect(cfgBlankErrors.some((e) => /serverHost/i.test(e))).toBe(true)
        expect(cfgBlankErrors.some((e) => /defaultProjectNumber/i.test(e))).toBe(true)
        expect(cfgBlankErrors.some((e) => /pruneImportanceThreshold/i.test(e))).toBe(true)
        expect(cfgBlankErrors.some((e) => /--metrics-export/i.test(e))).toBe(true)

        fs.writeFileSync(cfgFile, '{}', 'utf8')
        const cliBlankCmd = makeCliCommand(['authScopes', 'codemodeMaxResultSize'])
        const cliBlankErrors: string[] = []
        buildServerOptions(
            new ConfigResolver(
                cliBlankCmd,
                { authScopes: '   ', codemodeMaxResultSize: '   ' },
                cfgFile
            ),
            {},
            cliBlankCmd,
            cliBlankErrors
        )
        expect(cliBlankErrors.some((e) => /--auth-scopes/i.test(e))).toBe(true)
        expect(cliBlankErrors.some((e) => /--codemode-max-result-size/i.test(e))).toBe(true)

        expect(() => normalizeValidationStatus('   ')).toThrow(/Invalid validation_status/i)
        expect(() => normalizeValidationStatus({})).toThrow(/Invalid validation_status/i)
    })

    it('P7-A-L1 & P7-A-L3: prototype hardening uses prototype-less arrow function and deepFreezeContextClone works cleanly', async () => {
        const innerCtx = vm.createContext({})
        freezeInnerVmContext(innerCtx)
        const innerCheck = vm.runInContext(
            `(() => {
                const c = Object.getPrototypeOf(async function() {})['con' + 'structor'];
                let err = '';
                try { c('return 1'); } catch (e) { err = e.message; }
                return { protoType: typeof c.prototype, err };
            })()`,
            innerCtx
        ) as { protoType: string; err: string }
        expect(innerCheck.protoType).toBe('undefined')
        expect(innerCheck.err).toMatch(/disabled in sandbox/i)

        const sandbox = new WorkerSandbox()
        try {
            const workerCheck = await sandbox.execute(
                `const c = Object['getPrototype' + 'Of'](sleep)['con' + 'structor'];
                 let err = '';
                 try { c(); } catch (e) { err = e.message; }
                 return { protoType: typeof c.prototype, err };`,
                {},
                undefined,
                15_000,
                {},
                false
            )
            expect(workerCheck.success).toBe(true)
            expect(workerCheck.result).toEqual({
                protoType: 'undefined',
                err: 'Dynamic code generation is disabled in sandbox',
            })
        } finally {
            sandbox.dispose()
        }

        const frozen = deepFreezeContextClone({ nested: { arr: [1, 2] } })
        expect(Object.isFrozen(frozen)).toBe(true)
        expect(Object.isFrozen(frozen['nested'])).toBe(true)
    })

    it('P7-B-L1: rejects start_date > end_date across analytics and search handlers', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const ctx = { db: adapter, config: { projectRegistry: {} } } as unknown as Parameters<
                typeof getAnalyticsTools
            >[0]
            const statsTool = getAnalyticsTools(ctx).find((t) => t.name === 'get_statistics')
            const statsRes = (await statsTool?.handler({
                start_date: '2026-12-01',
                end_date: '2026-01-01',
            })) as { success: boolean; code?: string }
            expect(statsRes.success).toBe(false)
            expect(statsRes.code).toBe('VALIDATION_ERROR')

            const insightsTool = getAnalyticsTools(ctx).find(
                (t) => t.name === 'get_cross_project_insights'
            )
            const insightsRes = (await insightsTool?.handler({
                start_date: '2026-12-01',
                end_date: '2026-01-01',
            })) as { success: boolean; code?: string }
            expect(insightsRes.success).toBe(false)
            expect(insightsRes.code).toBe('VALIDATION_ERROR')

            const searchTool = getSearchEntriesTool(ctx).find((t) => t.name === 'search_entries')
            const searchRes = (await searchTool?.handler({
                query: 'test',
                start_date: '2026-12-01',
                end_date: '2026-01-01',
            })) as { success: boolean; code?: string }
            expect(searchRes.success).toBe(false)
            expect(searchRes.code).toBe('VALIDATION_ERROR')

            const semCtx = { ...ctx, vectorManager: {} } as unknown as Parameters<
                typeof executeSemanticSearch
            >[0]
            const semRes = (await executeSemanticSearch(semCtx, {
                query: 'test',
                start_date: '2026-12-01',
                end_date: '2026-01-01',
            })) as { success: boolean; code?: string }
            expect(semRes.success).toBe(false)
            expect(semRes.code).toBe('VALIDATION_ERROR')

            await expect(
                handleCrossTeamSearch(
                    {
                        query: 'test',
                        start_date: '2026-12-01',
                        end_date: '2026-01-01',
                        limit: 10,
                        sort_by: 'timestamp',
                    } as never,
                    ctx
                )
            ).rejects.toThrow(/start_date.*after end_date/i)
        } finally {
            adapter.close()
        }
    })

    it('P7-C-L1 & P7-C-L2: transactional multi-chunk deleteVectors and explicit alias/member column queries', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const ids = Array.from({ length: 650 }, (_, i) => i + 1)
            expect(adapter.deleteVectors(ids)).toBe(0)

            const addedAlias = adapter.addAuthorAlias('ally', 'Alice', 'tester', 'ws-test')
            expect(addedAlias.alias).toBe('ally')
            expect(addedAlias.canonicalAuthor).toBe('Alice')
            expect(adapter.listAuthorAliases('Alice', 'ws-test')).toHaveLength(1)

            adapter.addTeamMember('Alice', 'admin', 'tester', 'Alice Dev')
            expect(adapter.getTeamMember('Alice')?.displayName).toBe('Alice Dev')
            expect(adapter.listTeamMembers()).toHaveLength(1)
        } finally {
            adapter.close()
        }
    })

    it('bumps AUDIT_PROMPT_REVISION to Pass 86', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')
        expect(getCodeQualityAuditPromptDefinition().name).toBe('adversarial-audit-code-quality')
    })
})
