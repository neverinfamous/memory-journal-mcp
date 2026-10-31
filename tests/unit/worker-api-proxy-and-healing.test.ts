import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { getDummyHealingTools, searchDirectory } from '../../src/handlers/tools/core/dummy-healing.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

describe('Worker API Proxy (buildApiProxy)', () => {
    it('supports group methods, _topLevel, introspection, callable groups, aliases, and cross-group routing', async () => {
        const calls: { group: string; method: string; args: unknown[] }[] = []
        const rpcCall = async (group: string, method: string, args: unknown[]): Promise<unknown> => {
            calls.push({ group, method, args })
            if (method === 'throw_err') throw new Error('RPC boom')
            return { success: true, group, method, args }
        }

        const methods: Record<string, string[]> = {
            _topLevel: ['top_action'],
            core: ['create_entry', 'get_recent_entries', 'list_tags', 'throw_err'],
            search: ['search_entries'],
            semantic: ['semantic_search', 'vector_stats'],
            admin: [
                'list_projects',
                'get_project',
                'register_project',
                'update_project',
                'delete_project',
                'merge_tags',
                'search_audit_log',
                'list_deleted_entries',
                'update_configuration',
            ],
            analytics: ['get_statistics', 'get_cross_project_insights'],
            team: ['team_custom_only'],
            emptyGroup: [],
        }

        const schemas: Record<string, Record<string, string>> = {
            core: { create_entry: '{ content: string }' },
        }

        const mj = buildApiProxy(rpcCall, methods, schemas, false, {
            project_number: 5,
            session_id: 'sess-123',
            workspace_id: 'ws-abc',
        })

        // Top-level & group calls + introspection
        const topFn = mj['top_action'] as ((...a: unknown[]) => Promise<Record<string, unknown>>) & {
            schema: () => Promise<string>
            help: () => Promise<Record<string, unknown>>
            describe: () => Promise<Record<string, unknown>>
        }
        const topRes = await topFn({ a: 1 })
        expect(topRes['success']).toBe(true)
        expect(await topFn.schema()).toBe('unknown')
        expect((await topFn.help())['name']).toBe('top_action')
        expect((await topFn.describe())['name']).toBe('top_action')

        // Intercept error on top-level
        const topErrFn = mj['top_action'] as (...a: unknown[]) => Promise<Record<string, unknown>>
        expect(topErrFn).toBeDefined()

        const core = mj['core'] as Record<string, unknown> & ((...a: unknown[]) => Promise<unknown>)
        const createFn = core['create_entry'] as ((...a: unknown[]) => Promise<Record<string, unknown>>) & {
            schema: () => Promise<string>
        }
        expect(await createFn.schema()).toBe('{ content: string }')

        // Callable group invokes primary method (create_entry)
        const callableRes = (await core('Callable content')) as Record<string, unknown>
        expect(callableRes['method']).toBe('create_entry')

        // Empty group callable returns validation error
        const emptyCallable = mj['emptyGroup'] as (...a: unknown[]) => Promise<Record<string, unknown>>
        const emptyRes = await emptyCallable()
        expect(emptyRes['success']).toBe(false)

        // Group help/describe
        const coreHelp = await (core['help'] as () => Promise<Record<string, unknown>>)()
        expect(coreHelp['group']).toBe('core')

        // RPC rejection caught by safeRpcCall
        const errRes = await (core['throw_err'] as () => Promise<Record<string, unknown>>)()
        expect(errRes['success']).toBe(false)
        expect(errRes['code']).toBe('EXECUTION_ERROR')

        // camelCase to snake_case fallback & METHOD_ALIASES
        const recentFn = core['getRecentEntries'] as (...a: unknown[]) => Promise<Record<string, unknown>>
        expect((await recentFn())['method']).toBe('get_recent_entries')
        const aliasFn = core['recent'] as (...a: unknown[]) => Promise<Record<string, unknown>>
        expect((await aliasFn())['method']).toBe('get_recent_entries')

        // Cross-group constructor wiring on core
        expect(core['projects']).toBe(mj['projects'])
        expect(core['semanticSearch']).toBeDefined()
        expect(core['vectorStats']).toBeDefined()
        expect(core['searchAuditLog']).toBeDefined()
        expect(core['listDeletedEntries']).toBeDefined()

        // getConfig, getBriefing, readResource hallucinations on group
        const cfgRes = await (core['getConfig'] as () => Promise<Record<string, unknown>>)()
        expect(cfgRes['success']).toBe(false)
        const brfRes = await (core['getBriefing'] as () => Promise<Record<string, unknown>>)()
        expect(brfRes['success']).toBe(false)
        const rrRes = await (core['readResource'] as (u?: string) => Promise<Record<string, unknown>>)(
            'memory://recent'
        )
        expect(rrRes['error']).toContain('mj.core.getRecentEntries()')

        // Team prefix routing & cross-group routing from core
        const teamRouted = core['customOnly'] as () => Promise<Record<string, unknown>>
        expect((await teamRouted())['method']).toBe('team_custom_only')

        const crossRouted = core['searchEntries'] as (p: unknown) => Promise<Record<string, unknown>>
        expect((await crossRouted({ query: 'hi' }))['method']).toBe('search_entries')

        // Unknown method in group
        const unknownGroupFn = core['totallyNonExistentMethod'] as () => Promise<Record<string, unknown>>
        const unknownGroupRes = await unknownGroupFn()
        expect(unknownGroupRes['success']).toBe(false)
    })

    it('supports schema, projects, tags, system, context, factory shims, unawaited promise traps, and top-level errors', async () => {
        const rpcCall = async (group: string, method: string, args: unknown[]): Promise<unknown> => ({
            success: true,
            group,
            method,
            args,
        })

        const methods: Record<string, string[]> = {
            core: ['create_entry', 'list_tags'],
            admin: [
                'list_projects',
                'get_project',
                'register_project',
                'update_project',
                'delete_project',
                'merge_tags',
                'update_configuration',
            ],
            analytics: ['get_statistics'],
            team: ['team_only_func'],
        }

        const mj = buildApiProxy(rpcCall, methods, {}, true, { project_number: 5 })

        // Readonly unknown method message
        const core = mj['core'] as Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>>
        const roRes = await core['missingWriteOp']!()
        expect(roRes['error']).toContain('blocked in readonly mode')

        // Schema proxy
        const schema = mj['schema'] as Record<string, unknown> & (() => Promise<Record<string, unknown>>)
        expect((await schema())['method']).toBe('get_statistics')
        expect(((await (schema['help'] as () => Promise<Record<string, unknown>>)())['tables'] as string[]).length).toBeGreaterThan(0)
        expect(((await (schema['listTables'] as () => Promise<Record<string, unknown>>)())['tables'] as string[])).toContain('entries')
        expect(schema['tables']).toContain('entries')

        // Top-level help
        const topHelp = await (mj['help'] as () => Promise<Record<string, unknown>>)()
        expect(topHelp['totalMethods']).toBeGreaterThan(0)

        // Projects proxy
        const projects = mj['projects'] as Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>> &
            (() => Promise<Record<string, unknown>>)
        expect((await projects())['method']).toBe('list_projects')
        expect((await projects['get']!('my-proj'))['method']).toBe('get_project')
        expect((await projects['register']!({ name: 'p' }))['method']).toBe('register_project')
        expect((await projects['update']!({ name: 'p' }))['method']).toBe('update_project')
        expect((await projects['delete']!({ name: 'p' }))['method']).toBe('delete_project')
        expect((await projects['dynamicListAll']!())['method']).toBe('list_projects')
        expect((await projects['dynamicFindOne']!('p'))['method']).toBe('get_project')
        expect((await projects['dynamicAddProj']!({}))['method']).toBe('register_project')
        expect((await projects['dynamicEditProj']!({}))['method']).toBe('update_project')
        expect((await projects['dynamicRemoveProj']!({}))['method']).toBe('delete_project')

        // Tags proxy
        const tags = mj['tags'] as Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>> &
            (() => Promise<Record<string, unknown>>)
        expect((await tags())['method']).toBe('list_tags')
        expect((await tags['merge']!({ source_tag: 'a', target_tag: 'b' }))['method']).toBe('merge_tags')
        expect((await tags['dynamicMerge']!({ source_tag: 'a', target_tag: 'b' }))['method']).toBe('merge_tags')
        expect((await tags['dynamicSearchTags']!())['method']).toBe('list_tags')

        // System proxy
        const sys = mj['system'] as Record<string, () => Promise<Record<string, unknown>>> &
            (() => Promise<Record<string, unknown>>)
        expect((await sys())['method']).toBe('get_statistics')
        expect((await sys['ping']!())['status']).toBe('pong')
        expect((await sys['version']!())['name']).toBe('memory-journal-mcp')
        expect((await sys['customSysCheck']!())['method']).toBe('get_statistics')

        // Context proxy
        const ctx = mj['context'] as Record<string, unknown> & ((k?: string) => Promise< unknown>)
        expect(await ctx('project_number')).toBe(5)
        expect(((await ctx()) as Record<string, unknown>)['project_number']).toBe(5)
        expect(ctx['project_number']).toBe(5)

        // Shims & Factory
        const dbShim = (mj['getDatabase'] as () => Record<string, unknown>)()
        expect(dbShim['core'] === mj['core']).toBe(true)
        expect(mj['journal'] === mj['core']).toBe(true)
        const sqliteShim = mj['sqlite'] as Record<string, unknown>
        expect(sqliteShim['core'] === mj['core']).toBe(true)
        const getClient = mj['getClient'] as (() => Record<string, unknown>) &
            (new () => Record<string, unknown>) &
            Record<string, unknown>
        expect(getClient()['core'] === mj['core']).toBe(true)
        expect(new getClient()['core'] === mj['core']).toBe(true)
        expect(getClient['core'] === mj['core']).toBe(true)

        // Top-level alias, team routing, and cross-group routing
        expect(((await (mj['recent'] as () => Promise<Record<string, unknown>>)?.()) ?? {})).toBeDefined()
        const topTeam = mj['onlyFunc'] as () => Promise<Record<string, unknown>>
        expect((await topTeam())['method']).toBe('team_only_func')
        const topCross = mj['updateConfiguration'] as (p: unknown) => Promise<Record<string, unknown>>
        expect((await topCross({ tool_filter: 'core' }))['method']).toBe('update_configuration')

        // Unawaited Promise property access errors
        const pendingPromise = core['list_tags']!() as unknown as Record<string | symbol, unknown>
        expect(() => pendingPromise['prepare']).toThrow(/database method 'prepare'/)
        expect(() => pendingPromise['someProp']).toThrow(/forget to 'await'/)
        expect(() => pendingPromise[Symbol.iterator]).toThrow(/iterate over a Promise/)
        await (pendingPromise as unknown as Promise<unknown>)

        // Unknown top-level prompt vs mj_ vs generic group
        const promptFn = mj['session_summary'] as () => Promise<Record<string, unknown>>
        expect((await promptFn())['error']).toContain('MCP Prompt')

        const mjRootFn = mj['mj_invalid'] as () => Promise<Record<string, unknown>>
        expect((await mjRootFn())['error']).toContain('not a valid root tool')

        const unknownTop = mj['nonexistentGroup'] as Record<string, () => Promise<Record<string, unknown>>>
        expect((await unknownTop['subMethod']!())['error']).toContain('Attempted to access')
    })
})

describe('Dummy Healing Tools (getDummyHealingTools & searchDirectory)', () => {
    const tmpDir = path.join(process.cwd(), `.test-output/dummy-healing-${Date.now()}`)
    const dbPath = path.join(tmpDir, 'test.db')
    let db: DatabaseAdapter
    let context: ToolContext

    beforeEach(async () => {
        fs.mkdirSync(tmpDir, { recursive: true })
        fs.writeFileSync(path.join(tmpDir, 'sample.ts'), 'const alpha = 1;\nconst beta = 2;\n', 'utf-8')
        db = new DatabaseAdapter(dbPath)
        await db.initialize()
        context = {
            db,
            teamDb: db,
            config: {
                allowedIoRoots: [tmpDir],
            },
        }
    })

    afterEach(() => {
        try {
            db.close()
        } catch {
            // ignore
        }
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('executes searchDirectory and dummy healing tool categories with and without context', async () => {
        const dirMatches = searchDirectory(tmpDir, 'alpha', {
            filePattern: '*.ts',
            caseInsensitive: true,
            isRegex: false,
        })
        expect(dirMatches.length).toBe(1)
        expect(dirMatches[0]?.line).toBe(1)

        const tools = getDummyHealingTools(context)
        const findTool = (name: string): ToolDefinition => {
            const t = tools.find((x) => x.name === name)
            if (!t) throw new Error(`Missing dummy tool ${name}`)
            return t
        }

        // 1. Create entry fallback with rich aliases
        const addEntryRes = (await findTool('add_entry').handler({
            topic: 'testing',
            type: 'technical_note',
            text: 'Body from text',
            title: 'My Heading',
            project: '5',
            confidence: '0.9',
            impact: '0.8',
            validation: 'passed',
            workspace: 'ws-1',
            session_id: 'sess-123',
        })) as Record<string, unknown>
        expect(addEntryRes['_healing_note']).toContain('AUTONOMOUS HEALING')

        // Seed an entry directly so get_entry_by_id / update_entry have ID 1
        db.createEntry({
            content: 'Seeded Heading entry',
            entryType: 'technical_note',
            projectNumber: 5,
            workspaceId: 'ws-1',
            sessionId: 'sess-123',
        })

        // 2. Direct CRUD fallbacks
        expect(
            ((await findTool('search_entries').handler({ query: 'Heading' })) as Record<string, unknown>)[
                '_healing_note'
            ]
        ).toContain('AUTONOMOUS HEALING')
        expect(
            ((await findTool('get_recent_entries').handler({ limit: 5 })) as Record<string, unknown>)[
                'entries'
            ]
        ).toBeDefined()
        expect(
            ((await findTool('get_entry_by_id').handler({ entry_id: 1 })) as Record<string, unknown>)[
                'entry'
            ]
        ).toBeDefined()
        expect(
            await findTool('update_entry').handler({ entry_id: 1, content: 'Updated' })
        ).toBeDefined()
        expect(await findTool('delete_entry').handler({ entry_id: 1 })).toBeDefined()

        // 3. Resource & Prompt fallbacks
        const readRes = (await findTool('read_resource').handler({
            ServerName: 'memory-journal-mcp',
            resource: 'recent',
        })) as Record<string, unknown>
        expect(readRes['success']).toBe(true)

        const promptRes = (await findTool('load-briefing').handler({
            project: '5',
        })) as Record<string, unknown>
        expect(promptRes['success']).toBe(true)

        const getPromptRes = (await findTool('get_prompt').handler({
            name: 'load-briefing',
            arguments: { projects: '5' },
        })) as Record<string, unknown>
        expect(getPromptRes['success']).toBe(true)

        const badPromptRes = (await findTool('get_prompt').handler({
            name: 'non-existent-prompt',
        })) as Record<string, unknown>
        expect(badPromptRes['success']).toBe(false)

        // 4. List resources, prompts, tools, server_info, list_adapters, list_projects
        expect(
            ((await findTool('list_resources').handler({})) as Record<string, unknown>)['success']
        ).toBe(true)
        expect(
            ((await findTool('list_prompts').handler({})) as Record<string, unknown>)['success']
        ).toBe(true)
        expect(
            ((await findTool('list_tools').handler({})) as Record<string, unknown>)['success']
        ).toBe(true)
        expect(
            ((await findTool('server_info').handler({})) as Record<string, unknown>)['status']
        ).toBe('healthy')
        expect(
            ((await findTool('list_adapters').handler({})) as Record<string, unknown>)['default_adapter']
        ).toBe('sqlite')
        expect(
            ((await findTool('list_projects').handler({})) as Record<string, unknown>)['success']
        ).toBe(true)

        // 5. mj_core_* and dotted tool names
        for (const name of [
            'mj_core_create_entry',
            'mj_core_search_entries',
            'mj_core_get_recent_entries',
            'mj_core_get_entry_by_id',
            'mj_core_update_entry',
            'mj_admin_get_project',
            'mj_admin_list_projects',
            'mj.core.createEntry',
            'mj.core.searchEntries',
            'mj.core.getRecentEntries',
            'mj.core.getEntryById',
            'mj.core.updateEntry',
            'mj.core.deleteEntry',
            'mj.admin.getProject',
            'mj.admin.listProjects',
        ]) {
            const res = (await findTool(name).handler({
                entry_id: 1,
                content: 'Test content',
                workspace_id: 'ws-1',
                query: 'Test',
                name: 'test',
            })) as Record<string, unknown>
            expect(res).toBeDefined()
        }

        // 6. Grep search, view_file, list_dir
        const grepFs = (await findTool('grep_search').handler({
            search_path: tmpDir,
            query: 'beta',
        })) as Record<string, unknown>
        expect(grepFs['totalMatches']).toBe(1)

        const grepJournal = (await findTool('grep_search').handler({
            query: 'Updated',
        })) as Record<string, unknown>
        expect(grepJournal['success']).toBe(true)

        const viewFileRes = (await findTool('view_file').handler({
            path: path.join(tmpDir, 'sample.ts'),
            start_line: 1,
            end_line: 1,
        })) as Record<string, unknown>
        expect(viewFileRes['content']).toContain('alpha')

        const viewUriRes = (await findTool('view_file').handler({
            path: 'memory://recent',
        })) as Record<string, unknown>
        expect(viewUriRes['success']).toBe(true)

        const listDirRes = (await findTool('list_dir').handler({
            dir_path: tmpDir,
        })) as Record<string, unknown>
        expect(listDirRes['success']).toBe(true)

        // 7. Without context fallbacks
        const noCtxTools = getDummyHealingTools(undefined)
        for (const name of [
            'create_entry',
            'search_entries',
            'get_recent_entries',
            'get_entry_by_id',
            'update_entry',
            'delete_entry',
            'read_resource',
            'load-briefing',
            'get_prompt',
            'sqlite_execute_code',
            'list_projects',
            'mj_core_create_entry',
            'mj.core.createEntry',
        ]) {
            const t = noCtxTools.find((x) => x.name === name)
            const res = (await t?.handler({})) as Record<string, unknown>
            expect(res['success']).toBe(false)
        }
    })
})
