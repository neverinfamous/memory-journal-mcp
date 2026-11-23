import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { Command } from 'commander'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import { createRegisterProjectFn } from '../../src/codemode/api/project-registry-ops.js'
import { createProjectsProxy } from '../../src/codemode/proxy-namespaces.js'
import { formatVmErrorResult } from '../../src/codemode/worker/script-and-metadata-cache.js'
import { compactOversizedResult } from '../../src/codemode/worker/result-compactor.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import {
    PARAM_ALIASES,
    ENTRY_TYPE_ALIASES,
    TAG_ALIASES,
} from '../../src/codemode/normalizers/shared-utils.js'
import { createEmptyFallback, DB_TO_JOURNAL } from '../../src/codemode/worker/namespace-shims.js'
import { createShimProjectsDomain } from '../../src/codemode/worker/mj-shim-domains.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { resolveWrappedAliasProp } from '../../src/codemode/worker/result-proxy-aliases.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import { applyProjectNameAlias } from '../../src/codemode/normalizers/project-alias-helpers.js'
import {
    runWithRpcExecutionOverrides,
    getRpcExecutionOverrides,
} from '../../src/codemode/rpc-context.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { prepareCliEntryUpdate } from '../../src/cli/commands/entry-update-helpers.js'
import { withIsolatedProjectConfigEnv } from '../../src/cli/commands/project-config-helper.js'
import { CANONICAL_SERVER_ENV_KEYS } from '../../src/cli/server-options-groups.js'
import { addBriefingOptions, addOutputOptions } from '../../src/cli/option-groups.js'
import { safeCoerceDefaultProject } from '../../src/cli/schemas.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { buildCommitInvocation } from '../../scripts/update-badges.js'

const REGISTRY_FIXTURE = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: path.resolve(process.cwd(), '..', 'companion'), project_number: 16 },
}

describe('Pass 60 Code Mode, CLI, Worker & Script Remediations (M1, M5–M8, M12, L1–L2, L4–L5, O1–O5, O14–O17)', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let savedConfigPath: string | undefined
    let savedMetricsPort: string | undefined
    let tempDirs: string[] = []

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        savedConfigPath = process.env['MEMORY_JOURNAL_CONFIG']
        savedMetricsPort = process.env['MJ_METRICS_PORT']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedConfigPath !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = savedConfigPath
        else delete process.env['MEMORY_JOURNAL_CONFIG']
        if (savedMetricsPort !== undefined) process.env['MJ_METRICS_PORT'] = savedMetricsPort
        else delete process.env['MJ_METRICS_PORT']
        for (const dir of tempDirs) {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
        }
        tempDirs = []
    })

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    it('M1: wrapTeamAutoRoute normalizes positional ID and camelCase keys before routing to team', async () => {
        const teamCalls: Record<string, unknown>[] = []
        const core: Record<string, unknown> = {
            getEntryById: async () => ({
                success: false,
                code: 'RESOURCE_NOT_FOUND',
                suggestion: 'Call team_get_entry_by_id instead.',
            }),
        }
        const relationships: Record<string, unknown> = {
            visualizeRelationships: async () => ({
                success: false,
                code: 'RESOURCE_NOT_FOUND',
                suggestion: 'Call team_visualize_relationships instead.',
            }),
        }
        const team: Record<string, unknown> = {
            teamGetEntryById: async (args: Record<string, unknown>) => {
                teamCalls.push(args)
                return { success: true, entry: { id: args['entry_id'] } }
            },
            teamVisualizeRelationships: async (args: Record<string, unknown>) => {
                teamCalls.push(args)
                return { success: true, nodes: [], edges: [] }
            },
        }
        wireProjectAndTeamAliasesHelper({
            core,
            search: {},
            admin: {},
            relationships,
            team,
            hasDispatcher: true,
            registryProvider: undefined,
            copyFnSchema: () => undefined,
        })
        const getFn = core['getEntryById'] as (...a: unknown[]) => Promise<Record<string, unknown>>
        const visFn = relationships['visualizeRelationships'] as (...a: unknown[]) => Promise<Record<string, unknown>>
        const r1 = await getFn(42, { workspaceId: 'alpha', includeRelationships: true })
        const r2 = await visFn({ entryId: 99, projectNumber: 7 })
        expect(r1['_healed']).toEqual({ routedTo: 'team' })
        expect(r2['_healed']).toEqual({ routedTo: 'team' })
        expect(teamCalls).toEqual([
            { entry_id: 42, include_relationships: true, workspace_id: 'alpha' },
            { entry_id: 99, project_number: 7 },
        ])
    })

    it('M5–M7: cross-realm VM error detection, regex-span healer safety, and multiline auto-return', () => {
        const crossRealmErr: unknown = vm.runInNewContext('new TypeError("cross-realm boom")')
        const vmRes = formatVmErrorResult(crossRealmErr, performance.now(), process.cpuUsage())
        expect(vmRes.success).toBe(false)
        expect(vmRes.error).toContain('cross-realm boom')

        const compacted = compactOversizedResult({ err: crossRealmErr }, 1024) as {
            name?: string
            message?: string
            err?: { name?: string; message?: string }
        }
        expect(compacted.err?.message).toBe('cross-realm boom')

        const regexScript = 'const re = /fs.readFileSync(a)\\s+process.env.X/;\nconst x = obj.fs.existsSync("a");\nconst y = cfg.process.env.HOME;\n'
        const healed = healCodeModeScript(regexScript)
        expect(healed).toContain('/fs.readFileSync(a)')
        expect(healed).toContain('obj.fs.existsSync("a")')
        expect(healed).toContain('cfg.process.env.HOME')

        const chained = 'const items = await mj.core.getRecentEntries()\n  .map((e) => e.id)'
        expect(transformAutoReturn(chained)).toBe(chained)
        const nullish = 'const x = await getVal()\n  ?? "fallback"'
        expect(transformAutoReturn(nullish)).toBe(nullish)
    })

    it('M8, L1, L2: prototype-key safety, unavailable projects proxy, and init entry failure surfacing', async () => {
        expect(Object.getPrototypeOf(PARAM_ALIASES)).toBeNull()
        expect(Object.getPrototypeOf(ENTRY_TYPE_ALIASES)).toBeNull()
        expect(Object.getPrototypeOf(TAG_ALIASES)).toBeNull()
        expect(Object.getPrototypeOf(DB_TO_JOURNAL)).toBeNull()
        expect(PARAM_ALIASES['constructor']).toBeUndefined()

        const shimProjects = createShimProjectsDomain({}, {}) as Record<string, unknown>
        expect(shimProjects['toString']).not.toBeTypeOf('string')

        const apiProxy = buildApiProxy(
            async () => ({ success: true }),
            { core: ['create_entry'] },
            { core: { create_entry: '{}' } },
            false
        )
        expect(apiProxy['__proto__']).not.toBe(Object.prototype)

        const disabledProj = createProjectsProxy(
            {},
            async () => ({ success: true })
        ) as Record<string, (() => Promise<Record<string, unknown>>) | undefined>
        const listFn = disabledProj['list']
        expect(typeof listFn).toBe('function')
        const listRes = listFn !== undefined ? await listFn() : {}
        expect(listRes['success']).toBe(false)
        expect('projects' in listRes).toBe(false)
        expect('items' in listRes).toBe(false)
        expect(() => listRes['projects']).toThrow(/list_projects/)

        const cfgDir = makeTempDir('mj-p60-l2-')
        const cfgFile = path.join(cfgDir, 'mj.config.json')
        const targetRepoDir = makeTempDir('mj-p60-l2-repo-')
        fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: {} }), 'utf-8')
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
        const regFn = createRegisterProjectFn({
            createEntry: async () => ({ success: false, error: 'write rejected' }),
        })
        const regRes = await regFn('sample-repo', targetRepoDir, 99)
        expect(regRes.success).toBe(true)
        expect(regRes.warning).toContain('write rejected')
    })

    it('L4, L5, O1–O5, M12: CLI anchors scope, canonical env isolation, --no-json, briefing flags, port 0, codemode doc, recursive vendor mtime', async () => {
        const dir = makeTempDir('mj-p60-cli-')
        const adapter = new DatabaseAdapter(path.join(dir, 'cli.db'), { projectRegistry: REGISTRY_FIXTURE })
        await adapter.initialize()
        try {
            const created = adapter.createEntry({
                content: 'CLI update base',
                entryType: 'technical_note',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
                isPersonal: true,
            })
            const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
            const moveRegistry = {
                'memory-journal-mcp': { path: dir, project_number: 5 },
                companion: { path: process.cwd(), project_number: 16 },
            }
            const updates = await prepareCliEntryUpdate({
                entryId: created.id,
                version: 1,
                existingEntry: created,
                rawWorkspaceOpt: 'memory-journal-mcp',
                trimmedTargetWs: 'companion',
                metaSourceWs: undefined,
                content: 'Moved entry',
                payload: {
                    hasExplicitWorkspace: false,
                    projectNumber: 16,
                    autoContextStr: JSON.stringify({ commits: [headSha] }),
                },
                config: { projectRegistry: moveRegistry },
                db: adapter,
                isTeam: false,
            })
            expect(updates.targetWorkspaceId).toBe('companion')
            expect(updates.anchors?.length ?? 0).toBeGreaterThan(0)
        } finally {
            adapter.close()
        }

        expect(CANONICAL_SERVER_ENV_KEYS).toContain('BRIEFING_INCLUDE_TEAM')
        expect(CANONICAL_SERVER_ENV_KEYS).not.toContain('BRIEFING_TEAM_ENABLED')
        const isoFile = path.join(dir, 'isolated.json')
        fs.writeFileSync(isoFile, '{}', 'utf-8')
        process.env['MJ_METRICS_PORT'] = '9090'
        withIsolatedProjectConfigEnv({ config: isoFile }, () => {
            expect(process.env['MJ_METRICS_PORT']).toBe('')
        })
        expect(process.env['MJ_METRICS_PORT']).toBe('9090')

        const outCmd = addOutputOptions(new Command('list')).exitOverride()
        outCmd.parse(['node', 'list', '--no-json'])
        expect((outCmd.opts() as { json?: boolean }).json).toBe(false)

        const brCmd = addBriefingOptions(new Command('serve')).exitOverride()
        brCmd.parse(['node', 'serve', '--briefing-graph', '--briefing-insights'])
        const brOpts = brCmd.opts() as { briefingGraph?: boolean; briefingInsights?: boolean }
        expect(brOpts.briefingGraph).toBe(true)
        expect(brOpts.briefingInsights).toBe(true)

        expect(safeCoerceDefaultProject.safeParse('p5').data).toBe(5)
        expect(safeCoerceDefaultProject.safeParse('0').success).toBe(false)

        const cliCmd: CliCommandLike = { name: () => 'serve', getOptionValueSource: (k) => (k === 'metricsPort' ? 'cli' : undefined) }
        delete process.env['MJ_METRICS_PORT']
        const built = buildServerOptions(new ConfigResolver(cliCmd, { metricsPort: '0' }, isoFile), {}, cliCmd, [])
        expect(built.serverOptions.metricsPort).toBe(0)
        expect(process.env['MJ_METRICS_PORT']).toBe('0')

        const compiledCommit = path.join(dir, 'dist', 'vendor', 'commit', 'commit.js')
        const commitScript = path.join(dir, 'scripts', 'commit.ts')
        const nestedVendor = path.join(dir, 'src', 'vendor', 'commit', 'nested', 'helper.ts')
        fs.mkdirSync(path.dirname(compiledCommit), { recursive: true })
        fs.mkdirSync(path.dirname(commitScript), { recursive: true })
        fs.mkdirSync(path.dirname(nestedVendor), { recursive: true })
        fs.writeFileSync(compiledCommit, 'export {}\n', 'utf-8')
        fs.writeFileSync(commitScript, 'export {}\n', 'utf-8')
        fs.writeFileSync(nestedVendor, 'export {}\n', 'utf-8')
        const tOld = new Date(Date.now() - 60_000)
        const tMid = new Date(Date.now() - 30_000)
        const tNew = new Date()
        fs.utimesSync(commitScript, tOld, tOld)
        fs.utimesSync(compiledCommit, tMid, tMid)
        fs.utimesSync(nestedVendor, tNew, tNew)
        expect(buildCommitInvocation(dir, ['README.md']).args[0]).toContain('cli.mjs')
    })

    it('O14–O17: BigInt scope errors, autoVersion inheritance, frozen revisions proxy, SQL & negative single IDs', async () => {
        const nestedErr = validateNestedExecScope({ project_number: 1n }, 'companion', 16, REGISTRY_FIXTURE)
        expect(nestedErr?.error).toContain('Invalid project_number')
        const aliasConflict = applyProjectNameAlias('1', { project_number: 2n })
        expect(typeof aliasConflict === 'object' && 'conflict' in aliasConflict).toBe(true)

        let innerAutoVersion: boolean | undefined
        await runWithRpcExecutionOverrides({ autoVersion: true }, async () => {
            await runWithRpcExecutionOverrides({}, async () => {
                innerAutoVersion = getRpcExecutionOverrides()?.autoVersion
            })
        })
        expect(innerAutoVersion).toBe(true)

        const fallback = createEmptyFallback() as { set(k: string, v: unknown): unknown }
        expect(fallback.set('a', 1)).toBe(fallback)
        const revMatch = resolveWrappedAliasProp(
            { history: [Object.freeze({ revisionId: 3, content: 'snap' })] },
            'revisions',
            (v) => v
        )
        expect(revMatch.matched).toBe(true)
        if (revMatch.matched) {
            const first = (revMatch.value as Record<string, unknown>[])[0]
            expect(first?.['revisionNumber']).toBe(3)
        }

        const negId = applyArgInterceptions('delete_entry', [-5])
        expect('error' in negId).toBe(true)

        expect(parseSqlStatement("INSERT INTO memory_journal (content) VALUES ('hi')", []).action).toBe('create')
        expect(parseSqlStatement('INSERT INTO memory_journal (entry_type) VALUES (?)', [123]).action).toBe('unmapped')
    })
})
