import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import { synthesizeEntryMutationFields } from '../../src/codemode/normalizers/entry-mutation-synthesis.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { postProcessNormalizedKeys } from '../../src/codemode/api/key-normalizer-postprocess.js'
import { extractAndRecoverJsonCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { extractAuditScopeFromArgs, extractAuditScopeFromUri } from '../../src/audit/audit-query-helpers.js'
import { resolveToolCallAuditScope } from '../../src/audit/audit-file-helpers.js'
import { auditOperation } from '../../src/audit/interceptor.js'
import type { AuditLogger } from '../../src/audit/audit-logger.js'
import { resolveActiveBriefingConfig } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { attachCallToolInterceptor } from '../../src/server/mcp-server/tool-registration/call-interceptor.js'
import { dispatchKnownGroupFallbackTools } from '../../src/server/mcp-server/tool-registration/fallback-interceptors.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { wrapPromise } from '../../src/codemode/proxy-helpers.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { createAppendInterceptor, createShimProjectsDomain } from '../../src/codemode/worker/mj-shim-domains.js'
import { createContextProxy } from '../../src/codemode/worker/namespace-shims.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { readNestedQuerySearch } from '../../src/codemode/worker/nested-exec-payload.js'
import { getTeamAnalyticsTools } from '../../src/handlers/tools/team/analytics-tools.js'
import { getTeamCoreTools } from '../../src/handlers/tools/team/core-tools.js'
import { pairStoredScope } from '../../src/utils/workspace-registry-match.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ToolContext } from '../../src/types/index.js'

const REGISTRY = {
    'repo-a': { project_number: 5, path: path.resolve(os.tmpdir(), 'mj-p76-a') },
    'repo-b': { project_number: 16, path: path.resolve(os.tmpdir(), 'mj-p76-b') },
}

describe('Pass 76 Audit — Code Mode, Proxies, Audit Scope & Prompts', () => {
    let savedEnvEnc: string | undefined
    let savedEnvDbEnc: string | undefined
    let savedNodeEnv: string | undefined
    let savedVitest: string | undefined
    let savedConfigPath: string | undefined
    const tempDirs: string[] = []

    beforeEach(() => {
        savedEnvEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedEnvDbEnc = process.env['DB_ENCRYPTION_KEY']
        savedNodeEnv = process.env['NODE_ENV']
        savedVitest = process.env['VITEST']
        savedConfigPath = process.env['MEMORY_JOURNAL_CONFIG']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (savedEnvEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnvEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedEnvDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedEnvDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedNodeEnv !== undefined) process.env['NODE_ENV'] = savedNodeEnv
        else delete process.env['NODE_ENV']
        if (savedVitest !== undefined) process.env['VITEST'] = savedVitest
        else delete process.env['VITEST']
        if (savedConfigPath !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = savedConfigPath
        else delete process.env['MEMORY_JOURNAL_CONFIG']
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('C-H1: partial update with title preserves omitted content instead of overwriting it', () => {
        const updateObj: Record<string, unknown> = { entry_id: 42, title: 'Renamed Heading', type: 'decision' }
        synthesizeEntryMutationFields(updateObj, true)
        expect(updateObj['title']).toBe('Renamed Heading')
        expect(updateObj['content']).toBeUndefined()
        expect(updateObj['entry_type']).toBe('project_decision')

        const intercepted = applyGenericInterceptions('updateEntry', [{ entry_id: 42, title: 'Keep Content' }])
        expect('args' in intercepted).toBe(true)
        if ('args' in intercepted) {
            const first = intercepted.args[0] as Record<string, unknown>
            expect(first['title']).toBe('Keep Content')
            expect(first['content']).toBeUndefined()
        }

        const snaked = convertKeysToSnakeCase({ entry_id: 42, title: 'Solo Title', name: 'Alt' }, 'updateEntry')
        expect(snaked['title']).toBe('Solo Title')
        expect(snaked['content']).toBeUndefined()

        const teamSnaked = convertKeysToSnakeCase({ entry_id: 9, name: 'Team Title' }, 'team_update_entry')
        expect(teamSnaked['title']).toBe('Team Title')
        expect(teamSnaked['content']).toBeUndefined()

        const recovered = extractAndRecoverJsonCode(JSON.stringify({ op: 'update_entry', entry_id: 7, title: 'Updated Only Title' }))
        expect(recovered).toContain('"title":"Updated Only Title"')
        expect(recovered).not.toContain('"content":')
    })

    it('M2 & M3: audit scope applies session fallback after merge and suppresses non-positive project params', async () => {
        const reqCtx = { ephemeralSessionProject: { workspaceId: 'repo-a', projectNumber: 5 } } as never
        const mergedScope = resolveToolCallAuditScope(
            'read_resource',
            { uri: 'memory://briefing/repo-a', workspace_id: 'repo-b' },
            true,
            undefined,
            reqCtx
        )
        expect(mergedScope).toEqual({ workspaceId: 'repo-b' })

        expect(extractAuditScopeFromUri('memory://audit?project_number=-5', reqCtx)).toEqual({})
        expect(extractAuditScopeFromUri('memory://audit?project_number=abc', reqCtx)).toEqual({})
        expect(extractAuditScopeFromArgs({ project_number: -5 }, reqCtx)).toEqual({})
        expect(extractAuditScopeFromArgs({ project_number: 'invalid' }, reqCtx)).toEqual({})

        const entries: Record<string, unknown>[] = []
        const fakeLogger = {
            config: { enabled: true, auditReads: true },
            log: (e: Record<string, unknown>) => entries.push(e),
        } as unknown as AuditLogger
        await auditOperation(
            fakeLogger,
            'resource',
            'briefing',
            () => 'ok',
            {
                resourceUri: 'memory://briefing/repo-a',
                workspaceId: 'repo-b',
                runtime: { activeSessionProject: { workspaceId: 'repo-a', projectNumber: 5 } } as never,
            }
        )
        expect(entries[0]?.['workspaceId']).toBe('repo-b')
        expect(entries[0]?.['projectNumber']).toBeUndefined()
    })

    it('M4 & M5: briefing resolution blocks foreign session project bleed and shim filter blocks filtered get_prompt targets', async () => {
        const resolved = resolveActiveBriefingConfig(
            {
                ...DEFAULT_BRIEFING_CONFIG,
                defaultWorkspaceId: 'unregistered-ws',
                projectRegistry: REGISTRY,
            },
            [],
            {
                activeSessionProject: { workspaceId: 'repo-a', projectNumber: 5 },
            } as unknown as object
        )
        expect(resolved.defaultProjectNumber).toBeUndefined()

        const configManager = new ConfigManager({
            rawToolFilter: 'full,-team',
            toolFilterConfig: parseToolFilter('full,-team'),
            briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: REGISTRY },
        })
        const handlers = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>()
        handlers.set('tools/call', async () => ({ content: [{ type: 'text', text: '{}' }] }))
        attachCallToolInterceptor(
            handlers,
            { db: {} as never, configManager, runtime: new ServerRuntime(), allowedIoRoots: [] },
            { name: 'test', version: '1.0.0', transport: 'stdio' },
            [
                {
                    name: 'team-session-summary',
                    description: 'Team summary',
                    arguments: [],
                    handler: async () => ({ messages: [] }),
                },
            ] as never,
            [],
            new Set(),
            { filterConfig: parseToolFilter('full,-team') }
        )
        const callHandler = handlers.get('tools/call')
        if (callHandler === undefined) throw new Error('Expected tools/call interceptor')
        const blocked = (await callHandler(
            { method: 'tools/call', params: { name: 'get_prompt', arguments: { name: 'team-session-summary' } } },
            {}
        )) as { isError?: boolean; content: { text: string }[] }
        expect(blocked.isError).toBe(true)
        expect(blocked.content[0]?.text).toContain('TOOL_DISABLED')
    })

    it('M6, M7 & L5, L8: proxies trap mutations, array mutators throw, append handles objects/strings, and context freezes deeply', async () => {
        const arrProxy = wrapResult([{ id: 1 }]) as Record<string, unknown> & unknown[]
        expect(() => arrProxy.push({ id: 2 })).toThrow(/Array mutator method/)
        expect(() => {
            arrProxy[0] = { id: 9 }
        }).toThrow()
        const objProxy = wrapResult({ count: 1 }) as Record<string, unknown>
        expect(() => {
            objProxy['count'] = 2
        }).toThrow()

        const p = wrapPromise(Promise.resolve({ ok: true }), 'list')
        expect(() => {
            (p as unknown as Record<string, unknown>)['extra'] = 1
        }).toThrow()
        await p

        const rootProxy = buildApiProxy(
            { core: ['getRecentEntries'], analytics: ['getCrossProjectInsights'] },
            async () => ({ success: true })
        )
        expect(() => Object.freeze(rootProxy)).not.toThrow()
        expect(() => {
            rootProxy['injected'] = 1
        }).toThrow()
        expect(() => Object.defineProperty(rootProxy, 'injected', { value: 1 })).toThrow()
        expect(() => {
            delete rootProxy['core']
        }).toThrow()
        expect(() => Object.setPrototypeOf(rootProxy, {})).toThrow()

        const createdPayloads: unknown[] = []
        const insightsFn = Object.assign(async () => ({ success: true }), {
            schema: () => 'insights-schema',
        })
        const target = {
            core: {
                createEntry: (arg: unknown) => {
                    createdPayloads.push(arg)
                    return Promise.resolve({ success: true })
                },
            },
            analytics: { getCrossProjectInsights: insightsFn },
        }
        const appendFn = createAppendInterceptor(target)
        if (appendFn === undefined) throw new Error('Expected append interceptor')
        await appendFn({ content: 'Obj note', entry_type: 'technical_note' })
        await appendFn('Single string note')
        await appendFn(['t'], 'Body', { type: 'decision', title: 'T', session_id: 's-1', impact_score: 0.7 })
        expect(createdPayloads[0]).toEqual({ content: 'Obj note', entry_type: 'technical_note' })
        expect(createdPayloads[1]).toBe('Single string note')
        expect(createdPayloads[2]).toMatchObject({
            type: 'decision',
            tags: ['t'],
            content: 'Body',
            title: 'T',
            session_id: 's-1',
            impact_score: 0.7,
        })

        const projectsDomain = createShimProjectsDomain(target, {}) as Record<string, unknown>
        expect(projectsDomain['insights']).toBe(insightsFn)

        const nested = { nested: { items: [1, 2] } }
        const ctxProxy = createContextProxy(nested)
        expect(() => Object.freeze(ctxProxy)).not.toThrow()
        expect(() => Object.isExtensible(ctxProxy)).not.toThrow()
        expect(Object.isExtensible(ctxProxy)).toBe(false)
        expect(() => {
            ((ctxProxy['nested'] as Record<string, unknown>)['items'] as number[]).push(3)
        }).toThrow()
    })

    it('M8, M10, L2, L3, L6: search synthesis forwards filters, team read tools resolve registered project, fallback registry loads on undefined only', async () => {
        const res = resolveExecutionPayload(
            { query: 'audit', tags: ['sec'], mode: 'hybrid', limit: '15' } as never,
            { query: 'audit', tags: ['sec'], mode: 'hybrid', sort_by: 'importance', offset: 2, limit: '15' },
            true,
            Date.now()
        )
        expect('executionCode' in res).toBe(true)
        if ('executionCode' in res) {
            expect(res.executionCode).toContain('"tags":["sec"]')
            expect(res.executionCode).toContain('"sort_by":"importance"')
            expect(res.executionCode).toContain('"limit":"15"')
        }
        const ctxRes = resolveExecutionPayload(
            { context: { query: 'ctx', exclude_tags: ['noise'], entry_type: 'bug_fix', limit: 5 } } as never,
            { context: { query: 'ctx', exclude_tags: ['noise'], entry_type: 'bug_fix', limit: 5 } },
            true,
            Date.now()
        )
        expect('executionCode' in ctxRes).toBe(true)
        if ('executionCode' in ctxRes) {
            expect(ctxRes.executionCode).toContain('"exclude_tags":["noise"]')
        }
        const nested = readNestedQuerySearch({ query: 'abc', mode: 'fts', tags: ['a'], limit: 10 })
        expect(nested).toMatchObject({ query: 'abc', mode: 'fts', tags: ['a'], limit: 10 })

        const seenInsights: unknown[] = []
        const seenTags: unknown[] = []
        const teamCtx: ToolContext = {
            db: {} as never,
            teamDb: {
                getCrossProjectInsights: (opts: unknown) => {
                    seenInsights.push(opts)
                    return { projects: [], inactiveProjects: [] }
                },
                listTags: (ws: string, proj?: number) => {
                    seenTags.push({ ws, proj })
                    return []
                },
            } as never,
            config: { projectRegistry: REGISTRY },
        }
        const insightsTool = getTeamAnalyticsTools(teamCtx).find((t) => t.name === 'team_get_cross_project_insights')
        const listTagsTool = getTeamCoreTools(teamCtx).find((t) => t.name === 'team_list_tags')
        if (!insightsTool || !listTagsTool) throw new Error('Expected team tools')
        expect(((await insightsTool.handler({ workspace_id: 'repo-a' })) as { success: boolean }).success).toBe(true)
        expect((seenInsights[0] as { projectNumber?: number }).projectNumber).toBe(5)
        expect(((await listTagsTool.handler({ workspace_id: 'repo-b' })) as { success: boolean }).success).toBe(true)
        expect(seenTags[0]).toEqual({ ws: 'repo-b', proj: 16 })

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p76-fb-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'cfg.json')
        fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: REGISTRY }), 'utf8')
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
        process.env['NODE_ENV'] = 'production'
        delete process.env['VITEST']
        const fromDisk = (await dispatchKnownGroupFallbackTools(
            'list_projects',
            {},
            teamCtx,
            null,
            {},
            [],
            new Set()
        )) as { content: { text: string }[] }
        expect(fromDisk.content[0]?.text).toContain('repo-a')
        const emptyExplicit = (await dispatchKnownGroupFallbackTools(
            'list_projects',
            {},
            teamCtx,
            null,
            { projectRegistry: {} },
            [],
            new Set()
        )) as { content: { text: string }[] }
        expect(emptyExplicit.content[0]?.text).not.toContain('repo-a')

        expect(pairStoredScope('*', -5, REGISTRY)).toEqual({ workspaceId: undefined, projectNumber: undefined })
        expect(pairStoredScope('unreg-ws', 0, REGISTRY)).toEqual({ workspaceId: 'unreg-ws', projectNumber: 0 })

        const batchObj: Record<string, unknown> = {
            workspace_id: 'foo',
            project_number: 5,
            entries: [{ repo: 'other-org/foo', content: 'other' }],
        }
        postProcessNormalizedKeys(batchObj, 'batchCreateEntries')
        const batchEntry = (batchObj['entries'] as Record<string, unknown>[])[0]
        expect(batchEntry?.['project_number']).toBeUndefined()
    })

    it('AP*: bumps AUDIT_PROMPT_REVISION to 2026-11-22-audit-pass76 with Pass 76 portable rules', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass81')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass81')
        const def = getCodeQualityAuditPromptDefinition()
        const rendered = await def.handler(
            { target: 'memory-journal-mcp' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof def.handler>[1]
        )
        const text = (rendered as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(text).toContain('partial-update `title`')
        expect(text).toContain('array mutators callable')
        expect(text).toContain('args-side `project_number: 0` (and non-positive project params)')
    })
})
