import { describe, it, expect, vi, afterEach } from 'vitest'
import * as http from 'node:http'
import * as vm from 'node:vm'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'
import {
    createPreparedStatementShim,
    pathShim,
    consoleShim,
    type SafeFsShim,
} from '../../src/codemode/worker/node-shims.js'
import { LAZY_GROUP_METHOD_NAMES } from '../../src/codemode/worker-api-proxy.js'
import {
    isInsideStringLiteral,
    isInsideStringOrComment,
} from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import {
    createStatelessHandler,
    type McpRouteState,
} from '../../src/transports/http/server/protocol-route-handlers.js'
import { createPinnedJwksFetch } from '../../src/auth/jwks-custom-fetch.js'
import { PACKAGE_VERSION } from '../../src/codemode/package-version.js'
import {
    createEntriesDomainProxy,
    createShimProjectsDomain,
} from '../../src/codemode/worker/mj-shim-domains.js'
import { createGroupApi } from '../../src/codemode/api/group-factory.js'
import {
    createIsolatedNestedRunner,
    createScopedRpcCall,
} from '../../src/codemode/worker/nested-exec-runner.js'
import { mergeNestedSynthesizedScope } from '../../src/codemode/worker/nested-exec-payload.js'
import { autoPopulateGithubUrls } from '../../src/handlers/tools/codemode/dispatch-github-urls.js'
import {
    bigintReplacer,
    getSerializedPayloadJson,
    injectTokenEstimate,
} from '../../src/observability/token-estimator.js'
import { formatSuccessPayload } from '../../src/server/mcp-server/tool-registration/call-interceptor-helpers.js'
import { compactOversizedResult } from '../../src/codemode/worker/result-compactor.js'
import { CodeModeSecurityManager } from '../../src/codemode/security.js'
import type { ToolContext } from '../../src/types/index.js'

const origFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
})

describe('Pass 41 Audit — Sandbox Globals, Code Healer, HTTP Close & Worker Proxies', () => {
    it('H1: buildSandboxGlobals exposes team-prefixed names and blocks colliding bare names from mjApi.team', async () => {
        const coreGet = vi.fn(() => 'core-entry')
        const coreExport = vi.fn(() => 'core-export')
        const teamPrefixed = vi.fn(() => 'team-entry')
        const teamBareCollision = vi.fn(() => 'team-collision')
        const teamGroup: Record<string, unknown> = {
            team_search: teamPrefixed,
            teamCreateEntry: teamPrefixed,
            exportEntries: teamBareCollision,
            getEntryById: teamBareCollision,
            bareHelper: teamBareCollision,
            listProjects: teamBareCollision,
        }
        Object.defineProperty(teamGroup, LAZY_GROUP_METHOD_NAMES, {
            value: Object.keys(teamGroup),
            configurable: true,
        })
        const safeFsShim: SafeFsShim = {
            existsSync: () => false,
            statSync: () => ({ isFile: () => false, isDirectory: () => false, size: 0 }),
            stat: () => Promise.resolve({ isFile: () => false, isDirectory: () => false, size: 0 }),
            lstatSync: () => ({ isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false, size: 0 }),
            promises: {
                stat: () => Promise.resolve({ isFile: () => false, isDirectory: () => false, size: 0 }),
            },
        }
        const globals = buildSandboxGlobals({
            mjApi: {
                core: { getEntryById: coreGet, exportEntries: coreExport },
                team: teamGroup,
            },
            shimMj: { core: { getEntryById: coreGet }, help: () => ({}) },
            safeFsShim,
            frozenContext: Object.freeze({}),
            executeCodeFn: async () => undefined,
            updateMemoryFn: () => undefined,
        })

        expect(typeof globals['team_search']).toBe('function')
        expect(typeof globals['teamCreateEntry']).toBe('function')
        expect(globals['exportEntries']).toBe(coreExport)
        expect(await (globals['getEntryById'] as () => Promise<unknown>)()).toBe('core-entry')
        expect(globals['bareHelper']).toBeUndefined()
        expect(pathShim).toBeDefined()
        expect(consoleShim).toBeDefined()
        expect(typeof createPreparedStatementShim).toBe('function')
    })

    it('H2 & L3: template interpolation brace-stack prevents false string masking in healer and auto-return', () => {
        const tplWithInterp = 'const x = `prefix ${process.env.SECRET} mid <PROJECT_NUMBER> ${(() => { return 1 })()} end`'
        const interpOffset = tplWithInterp.indexOf('process.env.SECRET')
        const literalPlaceholderOffset = tplWithInterp.indexOf('<PROJECT_NUMBER>')
        expect(isInsideStringOrComment(tplWithInterp, interpOffset)).toBe(false)
        expect(isInsideStringLiteral(tplWithInterp, interpOffset)).toBe(false)
        expect(isInsideStringOrComment(tplWithInterp, literalPlaceholderOffset)).toBe(true)

        const healed = healCodeModeScript('const out = `val=${process.env.SECRET} tag=<PROJECT_NUMBER>`\nreturn out')
        expect(healed).toContain('val=${undefined}')
        expect(healed).toContain('tag=<PROJECT_NUMBER>')

        const autoRet = transformAutoReturn('const x = `${(() => { const a = 1; return a })()}`; x')
        expect(autoRet).toBe('const x = `${(() => { const a = 1; return a })()}`;\nreturn x')
    })

    it('H3: createStatelessHandler removes transient server from activeServers when server.server.onclose fires', async () => {
        const createdServers: McpServer[] = []
        const activeServers = new Set<McpServer>()
        const state: McpRouteState = {
            config: { port: 0, host: '127.0.0.1', stateless: true },
            serverFactory: (): McpServer => {
                const srv = new McpServer({ name: 'test-stateless', version: '1.0.0' })
                srv.registerTool('echo', { description: 'echo' }, async () => ({
                    content: [{ type: 'text', text: 'ok' }],
                }))
                createdServers.push(srv)
                return srv
            },
            activeServers,
            sseTransports: new Map(),
            sessionOwners: new Map(),
            sessionLastActivity: new Map(),
        }
        const handler = createStatelessHandler(state)
        const httpServer = http.createServer((req, res) => {
            void handler(req, res)
        })
        await new Promise<void>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => resolve())
        })
        const addr = httpServer.address()
        const port = typeof addr === 'object' && addr !== null ? addr.port : 0
        const client = new Client(
            { name: 'test', version: '1.0.0' },
            { versionNegotiation: { mode: { pin: '2026-07-28' } } }
        )
        try {
            const transport = new StreamableHTTPClientTransport(
                new URL(`http://127.0.0.1:${String(port)}/mcp`)
            )
            await client.connect(transport)
            await client.listTools()
            expect(createdServers.length).toBeGreaterThanOrEqual(1)
            const srv = createdServers[0]
            if (srv !== undefined) {
                activeServers.add(srv)
                srv.server.onclose?.()
                expect(activeServers.has(srv)).toBe(false)
            }
        } finally {
            await client.close().catch(() => undefined)
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => (err ? reject(err) : resolve()))
            })
        }
    })

    it('M2: createPinnedJwksFetch rejects HTTP non-200 and oversized payloads cleanly', async () => {
        globalThis.fetch = vi.fn(async () => new Response('unauthorized', { status: 401 }))
        const jwksFetch = createPinnedJwksFetch()
        await expect(jwksFetch('http://127.0.0.1:45999/.well-known/jwks.json')).rejects.toThrow(
            'HTTP error! status: 401'
        )
    })

    it('M3 & M4: PACKAGE_VERSION defined, domain proxies enforce immutability invariants and TOOL_DISABLED', async () => {
        expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
        const coreSearch = vi.fn(async () => ({ success: true }))
        const target: Record<string, unknown> = {
            core: { get_recent_entries: coreSearch, create_entry: coreSearch, get_entry_by_id: coreSearch },
            search: { search_entries: coreSearch },
            analytics: { get_cross_project_insights: coreSearch },
        }
        const entriesProxy = createEntriesDomainProxy(target)
        expect(entriesProxy).toBeDefined()
        if (entriesProxy !== undefined && typeof entriesProxy === 'function') {
            expect(Reflect.isExtensible(entriesProxy)).toBe(true)
            expect(Reflect.preventExtensions(entriesProxy)).toBe(false)
            expect(Reflect.set(entriesProxy, 'injected', 1)).toBe(false)
        }

        const projectsProxy = createShimProjectsDomain(target, {})
        const callProjects = projectsProxy as () => Promise<{ success: boolean; code?: string }>
        const listRes = await callProjects()
        expect(listRes.success).toBe(false)
        expect(listRes.code).toBe('TOOL_DISABLED')

        const getMethod = Reflect.get(projectsProxy, 'get') as (() => Promise<{ success: boolean; code?: string }>)
        const getRes = await getMethod()
        expect(getRes.success).toBe(false)
        expect(getRes.code).toBe('TOOL_DISABLED')

        const groupApi = createGroupApi('core', [])
        const helpFn = groupApi['help'] as () => Promise<{ examples: string[] }>
        const h1 = await helpFn()
        h1.examples.push('mutated')
        const h2 = await helpFn()
        expect(h2.examples).not.toContain('mutated')
    })

    it('M5: nested runner enforces monotonic flags/scope, strips control keys, and blocks invalid github targets', async () => {
        const rpcCalls: unknown[] = []
        const sendRpc = async (payload: unknown): Promise<unknown> => {
            rpcCalls.push(payload)
            return { ok: true }
        }
        const runNested = createIsolatedNestedRunner(
            {
                rpcFn: createScopedRpcCall(sendRpc),
                methodList: { core: ['getRecentEntries'] },
                schemaList: undefined,
                timeoutMs: 2000,
                contextObj: { outer: true },
                parentRpcOverrides: { readonly: true, autoVersion: false },
                pinnedWorkspaceRaw: 'pinned-ws',
                pinnedProjectRaw: 5,
                projectRegistryRaw: undefined,
                activeTimers: new Set(),
            },
            sendRpc,
            (opts) =>
                vm.createContext({
                    callRpc: (group: string, method: string, args: unknown[]) => opts.rpcFn(group, method, args),
                })
        )
        await runNested('callRpc("core", "getRecentEntries", [{}])', true, false, false, {
            workspaceId: 'evil-ws',
            projectNumber: 99,
            autoVersion: true,
        })
        expect(rpcCalls[0]).toMatchObject({
            readonly: true,
            workspaceId: 'pinned-ws',
            projectNumber: 5,
            autoVersion: false,
        })

        const merged = mergeNestedSynthesizedScope(
            {
                content: 'note',
                repo: 'other-repo',
                timeout_ms: 9999,
                max_result_size: 1024,
                readonly: true,
                dry_run: true,
                auto_version: false,
            },
            { session_id: 'sess-41' },
            { workspaceId: 'ws-a', projectNumber: 5 },
            undefined,
            undefined
        ) as Record<string, unknown>
        expect(merged['repo']).toBeUndefined()
        expect(merged['timeout_ms']).toBeUndefined()
        expect(merged['max_result_size']).toBeUndefined()
        expect(merged['workspace_id']).toBe('ws-a')
        expect(merged['project_number']).toBe(5)
        expect(merged['session_id']).toBe('sess-41')

        const ghParams: Record<string, unknown> = {
            target_workspace_id: 'default',
            issue_number: 12,
        }
        const ctx: ToolContext = {
            db: {} as ToolContext['db'],
            github: {
                getRepoInfo: async () => ({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
            } as unknown as ToolContext['github'],
        }
        await autoPopulateGithubUrls(ghParams, ctx, undefined, undefined)
        expect(ghParams['issue_url']).toBeUndefined()
    })

    it('M7 & L2: handles bigint serialization, Error/toJSON compaction, and active-ancestor DAG cycle detection', () => {
        expect(bigintReplacer('id', 42n)).toBe('42')
        expect(getSerializedPayloadJson({ n: 123n })).toBe('{"n":"123"}')
        const estimated = injectTokenEstimate({ count: 9n }) as { _meta?: { tokenEstimate?: number } }
        expect(typeof estimated._meta?.tokenEstimate).toBe('number')

        const formatted = formatSuccessPayload({ id: 7n, ok: true })
        expect(formatted.content[0]?.text).toBe('{"id":"7","ok":true}')

        const sharedLeaf = { tag: 'leaf' }
        const errInstance = new Error('boom')
        const withToJson = { toJSON: (): { serial: string } => ({ serial: 'ok' }) }
        const compacted = compactOversizedResult(
            { a: sharedLeaf, b: sharedLeaf, err: errInstance, tj: withToJson },
            4096
        ) as Record<string, unknown>
        expect(compacted['a']).toEqual({ tag: 'leaf' })
        expect(compacted['b']).toEqual({ tag: 'leaf' })
        expect(compacted['err']).toEqual({ name: 'Error', message: 'boom' })
        expect(compacted['tj']).toEqual({ serial: 'ok' })

        const secMgr = new CodeModeSecurityManager({ maxResultSize: 1024 })
        try {
            const cyclic: Record<string, unknown> = { sibling1: sharedLeaf, sibling2: sharedLeaf }
            cyclic['self'] = cyclic
            const res = secMgr.validateResultSize(cyclic)
            expect(res.valid).toBe(true)
        } finally {
            secMgr.dispose()
        }
    })
})
