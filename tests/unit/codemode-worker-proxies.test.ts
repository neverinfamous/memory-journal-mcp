/**
 * Unit Tests for Code Mode Worker Proxies & Globals:
 * - src/codemode/worker/namespace-shims.ts
 * - src/codemode/worker/mj-shim-domains.ts
 * - src/codemode/worker/mj-shim-proxy.ts
 * - src/codemode/worker/sandbox-globals.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { createSafeFsShim, consoleShim } from '../../src/codemode/worker/node-shims.js'
import {
    DB_TO_JOURNAL,
    createCallableShim,
    createUpdateMemoryFn,
    wrapDelegatingTool,
    schemaHelpFn,
    createSchemaShim,
    createEmptyFallback,
    createContextProxy,
} from '../../src/codemode/worker/namespace-shims.js'
import {
    createAdaptersShim,
    createShimReadResourceHandler,
    createEntriesDomainProxy,
    createGetReadFindInterceptor,
    createShimProjectsDomain,
    createDbDomainProxy,
    createSystemDatabaseDomainProxy,
    createSearchDomainProxy,
    createAppendInterceptor,
} from '../../src/codemode/worker/mj-shim-domains.js'
import { createShimMjProxy } from '../../src/codemode/worker/mj-shim-proxy.js'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'

describe('Code Mode Worker Proxies & Globals', () => {
    it('should route calls through namespace shims, domain proxies, shimMj, and sandbox globals', async () => {
        const createEntryMock = Object.assign(
            vi.fn().mockResolvedValue({ success: true, entry: { id: 1 } }),
            { schema: () => Promise.resolve('{ content: string }') }
        )
        const updateEntryMock = vi.fn().mockResolvedValue({ success: true, entry: { id: 1 } })
        const deleteEntryMock = vi.fn().mockResolvedValue({ success: true })
        const getEntryByIdMock = vi.fn().mockResolvedValue({ success: true, entry: { id: 1 } })
        const getRecentEntriesMock = vi.fn().mockResolvedValue({ success: true, entries: [] })
        const searchEntriesMock = vi.fn().mockResolvedValue({ success: true, entries: [] })
        const getStatsMock = vi.fn().mockResolvedValue({ totalEntries: 5 })
        const getInsightsMock = vi.fn().mockResolvedValue({ projects: [] })
        const updateConfigMock = vi.fn().mockResolvedValue({ success: true })

        const mjApi: Record<string, unknown> = {
            core: {
                createEntry: createEntryMock,
                create_entry: createEntryMock,
                getEntryById: getEntryByIdMock,
                get_entry_by_id: getEntryByIdMock,
                getRecentEntries: getRecentEntriesMock,
                get_recent_entries: getRecentEntriesMock,
                updateEntry: updateEntryMock,
                deleteEntry: deleteEntryMock,
            },
            admin: {
                updateEntry: updateEntryMock,
                deleteEntry: deleteEntryMock,
                updateConfiguration: updateConfigMock,
            },
            search: {
                searchEntries: searchEntriesMock,
                search_entries: searchEntriesMock,
            },
            analytics: {
                getStatistics: getStatsMock,
                getCrossProjectInsights: getInsightsMock,
            },
            tags: { listTags: vi.fn() },
            help: () => Promise.resolve({ groups: ['core'] }),
        }

        const safeFsShim = createSafeFsShim({ content: 'ctx' })
        const executeCodeFnRef: { current?: (arg: unknown) => Promise<unknown> } = {
            current: vi.fn().mockResolvedValue({ executed: true }),
        }
        const updateMemoryHolder: { current?: (arg: unknown) => unknown } = {}

        const shimMj = createShimMjProxy({
            mjApi,
            safeFsShim,
            executeCodeFnRef,
            getUpdateMemoryFn: () => updateMemoryHolder.current ?? (() => undefined),
        })
        const updateMemoryFn = createUpdateMemoryFn(shimMj)
        updateMemoryHolder.current = updateMemoryFn

        // 1. createCallableShim & wrapDelegatingTool
        const callable = createCallableShim(shimMj, 'CustomName') as unknown as {
            (): unknown
            new (): object
            name: string
            length: number
            core: unknown
        }
        expect(callable()).toBe(shimMj)
        expect(new callable()).toBe(shimMj)
        expect(callable.name).toBe('CustomName')
        expect(callable.length).toBe(0)
        expect(callable.core).toBe(mjApi['core'])

        const wrappedDelegated = wrapDelegatingTool(
            (a: unknown) => createEntryMock(a),
            () => createEntryMock
        ) as unknown as { schema: () => Promise<string> }
        expect(await wrappedDelegated.schema()).toBe('{ content: string }')

        // 2. createUpdateMemoryFn
        await (updateMemoryFn({ entry_id: 5, content: 'upd' }) as Promise<unknown>)
        expect(updateEntryMock).toHaveBeenCalledWith({ entry_id: 5, content: 'upd' })
        await (updateMemoryFn({ content: 'new' }) as Promise<unknown>)
        expect(createEntryMock).toHaveBeenCalledWith({ content: 'new' })
        const umWithMeta = updateMemoryFn as unknown as {
            help: () => Promise<{ name: string }>
            describe: () => Promise<{ name: string }>
            schema: () => Promise<string>
        }
        expect((await umWithMeta.help()).name).toBe('updateMemory')
        expect((await umWithMeta.describe()).name).toBe('updateMemory')
        expect(await umWithMeta.schema()).toBe('{ content: string }')

        // 3. createSchemaShim & schemaHelpFn
        expect(DB_TO_JOURNAL['listTables']).toEqual(['analytics', 'getStatistics'])
        const sHelp = (await schemaHelpFn()) as { group: string }
        expect(sHelp.group).toBe('schema')
        const schemaShim = createSchemaShim(shimMj) as unknown as {
            (): Promise<unknown>
            listTables: () => Promise<{ tables: string[] }>
            tables: string[]
            entries: Promise<string>
        }
        await schemaShim()
        expect(getStatsMock).toHaveBeenCalled()
        expect((await schemaShim.listTables()).tables).toContain('memory_journal')
        expect(schemaShim.tables).toContain('tags')
        expect(await schemaShim.entries).toBe('{ content: string }')

        // 4. createEmptyFallback & createContextProxy
        const emptyCol = createEmptyFallback('items') as Record<string, unknown>
        expect(emptyCol['size']).toBe(0)
        expect(emptyCol['length']).toBe(0)
        expect((emptyCol['map'] as () => unknown[])()).toEqual([])
        expect((emptyCol['filter'] as () => unknown[])()).toEqual([])
        expect((emptyCol['find'] as () => unknown)()).toBeUndefined()
        expect((emptyCol['findIndex'] as () => number)()).toBe(-1)
        expect((emptyCol['some'] as () => boolean)()).toBe(false)
        expect((emptyCol['every'] as () => boolean)()).toBe(true)
        expect((emptyCol['includes'] as () => boolean)()).toBe(false)
        expect((emptyCol['join'] as () => string)()).toBe('')
        expect([...(emptyCol as unknown as Iterable<unknown>)]).toEqual([])

        const ctxProxy = createContextProxy({ customKey: 'val1' })
        expect(ctxProxy['customKey']).toBe('val1')
        expect((ctxProxy['toString'] as () => string)()).toContain('val1')
        expect((ctxProxy['toJSON'] as () => unknown)()).toEqual({ customKey: 'val1' })
        const getCtxRes = await (ctxProxy['get'] as (k?: string) => Promise<unknown>)('customKey')
        expect(getCtxRes).toBe('val1')
        const promptErr = await (ctxProxy['executePrompt'] as () => Promise<{
            success: boolean
            code: string
        }>)()
        expect(promptErr.success).toBe(false)
        expect(promptErr.code).toBe('VALIDATION_ERROR')
        expect((ctxProxy['entries'] as { length: number }).length).toBe(0)

        // 5. mj-shim-domains & shimMj
        expect(shimMj['mj']).toBe(shimMj)
        expect(shimMj['logger']).toBe(consoleShim)
        const adaptersShim = createAdaptersShim('list_adapters') as () => Promise<{
            success: boolean
            default_adapter: string
        }>
        expect((await adaptersShim()).default_adapter).toBe('sqlite')

        const readResHandler = createShimReadResourceHandler()
        const readResErr = (await readResHandler('memory://recent')) as {
            success: boolean
            error: string
        }
        expect(readResErr.success).toBe(false)
        expect(readResErr.error).toContain('mj.core.getRecentEntries()')

        const entriesDomain = createEntriesDomainProxy(mjApi) as Record<string, unknown> &
            (() => Promise<unknown>)
        await entriesDomain()
        expect(entriesDomain['findByQuery']).toBe(searchEntriesMock)
        expect(entriesDomain['insertNew']).toBe(createEntryMock)
        expect(entriesDomain['fetchById']).toBe(getEntryByIdMock)
        expect(entriesDomain['patchEntry']).toBe(updateEntryMock)
        expect(entriesDomain['removeItem']).toBe(deleteEntryMock)
        expect(entriesDomain['listAll']).toBe(getRecentEntriesMock)

        const getRead = createGetReadFindInterceptor(mjApi, shimMj)
        await expect(getRead()).resolves.toBe(shimMj)
        await getRead(12)
        expect(getEntryByIdMock).toHaveBeenCalledWith({ entry_id: 12 })
        await getRead({ query: 'find-me' })
        expect(searchEntriesMock).toHaveBeenCalledWith({ query: 'find-me' })

        const projDomain = createShimProjectsDomain(mjApi, shimMj) as Record<string, unknown> &
            (() => Promise<unknown>)
        await expect(projDomain()).resolves.toMatchObject({ success: true })
        await (projDomain['insights'] as () => Promise<unknown>)()
        expect(getInsightsMock).toHaveBeenCalled()

        const dbDomain = createDbDomainProxy(mjApi, shimMj) as Record<string, unknown>
        await expect((dbDomain['ping'] as () => Promise<unknown>)()).resolves.toEqual({
            success: true,
            status: 'pong',
        })
        await expect(
            (dbDomain['version'] as () => Promise<{ success: boolean }>)()
        ).resolves.toMatchObject({
            success: true,
        })
        expect((dbDomain['close'] as () => { success: boolean })().success).toBe(true)
        expect((dbDomain['getDb'] as () => unknown)()).toBe(shimMj)
        const unknownDbCall = await (dbDomain['rawCustom'] as () => Promise<{
            success: boolean
        }>)()
        expect(unknownDbCall.success).toBe(false)

        const sysDomain = createSystemDatabaseDomainProxy(mjApi, shimMj) as Record<string, unknown>
        await expect((sysDomain['ping'] as () => Promise<unknown>)()).resolves.toEqual({
            success: true,
            status: 'pong',
        })

        const searchDomain = createSearchDomainProxy(mjApi) as (() => Promise<unknown>) &
            Record<string, unknown>
        await searchDomain()
        expect(searchDomain['queryEntries']).toBe(searchEntriesMock)

        const appendFn = createAppendInterceptor(mjApi)!
        await (appendFn(['tagA'], { key: 'val' }, { type: 'bug_fix', extra: 1 }) as Promise<unknown>)
        expect(createEntryMock).toHaveBeenLastCalledWith({
            type: 'bug_fix',
            tags: ['tagA'],
            content: '{"key":"val"}',
            metadata: { extra: 1 },
        })

        await (shimMj['loadBriefing'] as (a?: Record<string, unknown>) => Promise<unknown>)({
            limit: 3,
        })
        expect(getRecentEntriesMock).toHaveBeenCalledWith({
            limit: 3,
            sort_by: 'importance',
        })
        expect((shimMj['close'] as () => { success: boolean })().success).toBe(true)
        expect((shimMj['execSync'] as () => string)()).toBe('')
        const spawnRes = (shimMj['spawn'] as (c: string, cb: () => void) => { kill: () => boolean })(
            'ls',
            () => undefined
        )
        expect(spawnRes.kill()).toBe(true)
        expect((shimMj['join'] as (...p: string[]) => string)('x', 'y')).toBe('x/y')
        expect((shimMj['format'] as (...a: unknown[]) => string)('hi', 5)).toBe('hi 5')
        expect(shimMj['list_tables']).toBe(getStatsMock)

        // 6. buildSandboxGlobals
        const activeTimers = new Set<NodeJS.Timeout>()
        const globals = buildSandboxGlobals({
            mjApi,
            shimMj,
            safeFsShim,
            frozenContext: ctxProxy,
            executeCodeFn: (arg) => Promise.resolve(arg),
            updateMemoryFn,
            activeTimers,
        })

        expect(globals['mj']).toBe(shimMj)
        await (globals['processOperation'] as (a: unknown) => Promise<unknown>)({
            operation: 'add_entry',
            content: 'op1',
        })
        await (globals['processOperation'] as (a: unknown) => Promise<unknown>)({
            op: 'update_entry',
            entry_id: 1,
        })
        await (globals['processOperation'] as (a: unknown) => Promise<unknown>)({
            action: 'delete_entry',
            entry_id: 1,
        })
        await (globals['processOperation'] as (a: unknown) => Promise<unknown>)({
            type: 'search_entries',
            query: 'q',
        })

        const fetchRes = await (globals['fetch'] as () => Promise<{
            ok: boolean
            status: number
            json: () => Promise<{ code: string }>
        }>)()
        expect(fetchRes.ok).toBe(false)
        expect(fetchRes.status).toBe(403)
        expect((await fetchRes.json()).code).toBe('VALIDATION_ERROR')

        await (globals['sleep'] as (ms: number) => Promise<void>)(1)
        const procObj = globals['process'] as {
            exit: (c?: number) => { exited: boolean; exitCode: number }
        }
        expect(procObj.exit(0)).toEqual({ success: true, exited: true, exitCode: 0 })
    })
})
