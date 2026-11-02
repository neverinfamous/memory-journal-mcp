/**
 * Unit Tests for Code Mode Worker Core Modules:
 * - src/codemode/worker/prototype-hardening.ts
 * - src/codemode/worker/result-compactor.ts
 * - src/codemode/worker/node-shims.ts
 * - src/codemode/api/project-registry-ops.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as vm from 'node:vm'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import {
    hardenOuterFunctionPrototypes,
    freezeInnerVmContext,
} from '../../src/codemode/worker/prototype-hardening.js'
import {
    compactOversizedResult,
    serializeAndEnforceEgress,
} from '../../src/codemode/worker/result-compactor.js'
import {
    createSafeFsShim,
    pathShim,
    consoleShim,
    createPreparedStatementShim,
} from '../../src/codemode/worker/node-shims.js'
import {
    createGetConfigFn,
    createRegisterProjectFn,
    createUpdateProjectFn,
    createDeleteProjectFn,
    createListProjectsFn,
    createGetProjectFn,
} from '../../src/codemode/api/project-registry-ops.js'
import type { SandboxResult } from '../../src/codemode/types.js'

describe('Code Mode Worker Core & Project Registry Ops', () => {
    describe('prototype-hardening', () => {
        it('should freeze inner VM context prototypes and neuter dynamic constructor escapes', () => {
            const context = vm.createContext({ result: null })
            freezeInnerVmContext(context)

            expect(() =>
                vm.runInContext(
                    `const c = 'con' + 'structor'; (function(){})[c]('return 1')()`,
                    context
                )
            ).toThrow(/Dynamic code generation is disabled in sandbox/)

            expect(vm.runInContext(`Object.isFrozen(Array.prototype)`, context)).toBe(true)
            expect(vm.runInContext(`Object.isFrozen(Object.prototype)`, context)).toBe(true)
        })

        it('should export hardenOuterFunctionPrototypes as a function', () => {
            expect(typeof hardenOuterFunctionPrototypes).toBe('function')
        })
    })

    describe('result-compactor', () => {
        it('should handle primitives, depth limits, circular refs, large arrays, and large objects in compactOversizedResult', () => {
            expect(compactOversizedResult(null, 1024)).toBeNull()
            expect(compactOversizedResult('short', 1024)).toBe('short')
            expect(compactOversizedResult(123, 1024)).toBe(123)
            expect(compactOversizedResult({ a: 1 }, 1024, 7)).toBe('[MaxDepthExceeded]')

            const circular: Record<string, unknown> = { name: 'node' }
            circular['self'] = circular
            const compactedCirc = compactOversizedResult(circular, 4096) as Record<string, unknown>
            expect(compactedCirc['self']).toBe('[Circular]')
            expect(compactedCirc['_compaction_notice']).toContain('automatically compacted')

            const longStr = 'x'.repeat(500)
            const bigArr = Array.from({ length: 30 }, (_, i) => (i === 0 ? longStr : { idx: i }))
            const compactedArr = compactOversizedResult(bigArr, 10240) as unknown[]
            expect(compactedArr.length).toBe(21)
            expect(String(compactedArr[0])).toContain('[truncated by Code Mode result size guardrail]')
            expect(compactedArr[20]).toMatchObject({
                _truncated: true,
                omitted_items_count: 10,
            })

            const manyKeysObj: Record<string, unknown> = { longText: longStr, num: 42 }
            for (let i = 0; i < 105; i++) {
                manyKeysObj[`k_${i}`] = i
            }
            const compactedMany = compactOversizedResult(manyKeysObj, 20480) as Record<
                string,
                unknown
            >
            expect(String(compactedMany['longText'])).toContain(
                '[truncated by Code Mode result size guardrail]'
            )
            expect(compactedMany['_omitted_keys_count']).toBe(7)
        })

        it('should serialize valid results, handle BigInt/circular, compact oversized objects, and fail oversized strings in serializeAndEnforceEgress', () => {
            const failedRes: SandboxResult = {
                success: false,
                error: 'existing error',
                metrics: { wallTimeMs: 1, cpuTimeMs: 1, memoryUsedMb: 0 },
            }
            serializeAndEnforceEgress(failedRes, 1024)
            expect(failedRes.error).toBe('existing error')

            const circObj: Record<string, unknown> = {
                big: BigInt(9007199254740991),
                flag: true,
                count: 5,
            }
            circObj['loop'] = circObj
            const okRes: SandboxResult = {
                success: true,
                result: circObj,
                metrics: { wallTimeMs: 1, cpuTimeMs: 1, memoryUsedMb: 0 },
            }
            serializeAndEnforceEgress(okRes, 10240)
            expect(okRes.success).toBe(true)
            expect((okRes.result as Record<string, unknown>)['big']).toBe('9007199254740991')
            expect((okRes.result as Record<string, unknown>)['loop']).toBe('[Circular]')

            const undefRes: SandboxResult = {
                success: true,
                result: undefined,
                metrics: { wallTimeMs: 1, cpuTimeMs: 1, memoryUsedMb: 0 },
            }
            serializeAndEnforceEgress(undefRes, 1024)
            expect(undefRes.result).toBeUndefined()

            const oversizedObj: Record<string, unknown> = {
                entries: Array.from({ length: 30 }, (_, i) => ({
                    id: i,
                    content: 'A'.repeat(450),
                })),
            }
            const compactableRes: SandboxResult = {
                success: true,
                result: oversizedObj,
                metrics: { wallTimeMs: 1, cpuTimeMs: 1, memoryUsedMb: 0 },
            }
            serializeAndEnforceEgress(compactableRes, 8000)
            expect(compactableRes.success).toBe(true)
            expect(
                (compactableRes.result as Record<string, unknown>)['_compaction_notice']
            ).toBeDefined()

            const hugeStrRes: SandboxResult = {
                success: true,
                result: 'S'.repeat(5000),
                metrics: { wallTimeMs: 1, cpuTimeMs: 1, memoryUsedMb: 0 },
            }
            serializeAndEnforceEgress(hugeStrRes, 1024)
            expect(hugeStrRes.success).toBe(false)
            expect(hugeStrRes.error).toContain('Output limit exceeded')
        })
    })

    describe('node-shims', () => {
        it('should provide safe fs, path, and console shims', async () => {
            const fsShim = createSafeFsShim({ content: 'hello-from-context' })
            expect(fsShim.existsSync(undefined)).toBe(false)
            expect(fsShim.existsSync('memory_journal.db')).toBe(true)
            expect(fsShim.statSync('test.db').isFile()).toBe(true)
            expect(fsShim.statSync('test.db').isDirectory()).toBe(false)
            expect(fsShim.lstatSync('test.db').isFile()).toBe(true)
            expect(fsShim.lstatSync('test.db').isDirectory()).toBe(false)

            let statCbCalled = false
            await fsShim.stat('test.db', (err, s) => {
                expect(err).toBeNull()
                expect(s).toBeDefined()
                statCbCalled = true
            })
            expect(statCbCalled).toBe(true)

            expect(fsShim.readFileSync('any.txt')).toBe('hello-from-context')
            let readCbData = ''
            await fsShim.readFile('any.txt', (_err, data) => {
                readCbData = data ?? ''
            })
            expect(readCbData).toBe('hello-from-context')

            expect(fsShim.writeFileSync()).toBeUndefined()
            await expect(fsShim.writeFile()).resolves.toBeUndefined()
            expect(fsShim.mkdirSync()).toBeUndefined()
            expect(fsShim.unlinkSync()).toBeUndefined()
            expect(fsShim.readdirSync()).toEqual([])

            const pStat = await fsShim.promises.stat()
            expect(pStat.isFile()).toBe(true)
            expect(pStat.isDirectory()).toBe(false)
            await expect(fsShim.promises.readFile()).resolves.toBe('hello-from-context')
            await expect(fsShim.promises.writeFile()).resolves.toBeUndefined()

            expect(pathShim.join('a', 'b', 'c.txt')).toBe('a/b/c.txt')
            expect(pathShim.resolve('/root', 'sub')).toBe('/root/sub')
            expect(pathShim.basename('/a/b/file.md', '.md')).toBe('file')
            expect(pathShim.dirname('/a/b/file.md')).toBe('/a/b')
            expect(pathShim.dirname('file.md')).toBe('.')
            expect(pathShim.extname('/a/b/file.md')).toBe('.md')
            expect(pathShim.extname('noext')).toBe('')
            expect(pathShim.normalize('a\\b\\c')).toBe('a/b/c')
            expect(pathShim.isAbsolute('/usr/bin')).toBe(true)
            expect(pathShim.isAbsolute('C:\\Users')).toBe(true)
            expect(pathShim.isAbsolute('relative/path')).toBe(false)

            expect(consoleShim.log('a', 1)).toEqual(['a', 1])
            expect(consoleShim.warn('w')).toEqual(['w'])
            expect(consoleShim.error('e')).toEqual(['e'])
            expect(consoleShim.info('i')).toEqual(['i'])
            expect(consoleShim.debug('d')).toEqual(['d'])
        })

        it('should translate SQL UPDATE, INSERT, DELETE, SELECT, and other statements via createPreparedStatementShim', async () => {
            const mockUpdate = vi.fn().mockResolvedValue({ updated: true })
            const mockCreate = vi.fn().mockResolvedValue({ created: true })
            const mockDelete = vi.fn().mockResolvedValue({ deleted: true })
            const mockGetById = vi.fn().mockResolvedValue({ entry: { id: 10 } })
            const mockList = vi.fn().mockResolvedValue({ entries: [] })

            const fakeShimMj: Record<string, unknown> = {
                core: {
                    createEntry: mockCreate,
                    getEntryById: mockGetById,
                    getRecentEntries: mockList,
                },
                admin: {
                    updateEntry: mockUpdate,
                    deleteEntry: mockDelete,
                },
            }

            const updateStmt = createPreparedStatementShim(
                'UPDATE memory_journal SET content = ?, tags = ? WHERE id = 42',
                fakeShimMj
            )
            await (updateStmt['get'] as (...a: unknown[]) => Promise<unknown>)(
                'Updated body',
                '["tag1","tag2"]',
                'Custom Title'
            )
            expect(mockUpdate).toHaveBeenCalledWith({
                entry_id: 42,
                content: 'Updated body',
                tags: ['tag1', 'tag2'],
                title: 'Custom Title',
            })

            const updateInlineStmt = createPreparedStatementShim(
                `UPDATE memory_journal SET content = 'Literal SQL Content' WHERE id = ?`,
                fakeShimMj
            )
            await (updateInlineStmt['all'] as (...a: unknown[]) => Promise<unknown>)({
                id: 99,
                tags: ['rec-tag'],
            })
            expect(mockUpdate).toHaveBeenLastCalledWith({
                entry_id: 99,
                content: 'Literal SQL Content',
                tags: ['rec-tag'],
            })

            const insertStmt = createPreparedStatementShim(
                'INSERT INTO memory_journal (content, title, tags) VALUES (?, ?, ?)',
                fakeShimMj
            )
            const runRes = await (insertStmt['run'] as (...a: unknown[]) => Promise<unknown>)(
                'Inserted body',
                'Inserted Title',
                '["ins-tag"]'
            )
            expect(runRes).toBeDefined()
            expect(mockCreate).toHaveBeenCalledWith({
                content: 'Inserted body',
                title: 'Inserted Title',
                tags: ['ins-tag'],
                entry_type: 'technical_decision',
            })

            await (insertStmt['get'] as (...a: unknown[]) => Promise<unknown>)({
                content: 'Obj body',
                title: 'Obj title',
                tags: ['t'],
                entry_type: 'bug_fix',
            })
            expect(mockCreate).toHaveBeenLastCalledWith({
                content: 'Obj body',
                title: 'Obj title',
                tags: ['t'],
                entry_type: 'bug_fix',
            })

            const deleteStmt = createPreparedStatementShim(
                'DELETE FROM memory_journal WHERE entry_id = 77',
                fakeShimMj
            )
            await (deleteStmt['get'] as (...a: unknown[]) => Promise<unknown>)()
            expect(mockDelete).toHaveBeenCalledWith({ entry_id: 77 })

            const selectByIdStmt = createPreparedStatementShim(
                'SELECT * FROM memory_journal WHERE id = ?',
                fakeShimMj
            )
            await (selectByIdStmt['get'] as (...a: unknown[]) => Promise<unknown>)(10)
            expect(mockGetById).toHaveBeenCalledWith({ entry_id: 10 })

            const selectAllStmt = createPreparedStatementShim(
                'SELECT * FROM memory_journal LIMIT 10',
                fakeShimMj
            )
            await (selectAllStmt['all'] as () => Promise<unknown>)()
            expect(mockList).toHaveBeenCalledWith({ limit: 50 })

            const pragmaStmt = createPreparedStatementShim(
                'PRAGMA table_info(memory_journal)',
                fakeShimMj
            )
            await expect((pragmaStmt['iterate'] as () => Promise<unknown>)()).resolves.toEqual({
                success: true,
                changes: 1,
            })
            expect((pragmaStmt['bind'] as () => unknown)()).toBe(pragmaStmt)
            expect((pragmaStmt['columns'] as () => unknown[])()).toEqual([])
            expect((pragmaStmt['raw'] as () => unknown)()).toBe(pragmaStmt)
            expect((pragmaStmt['pluck'] as () => unknown)()).toBe(pragmaStmt)
            expect((pragmaStmt['expand'] as () => unknown)()).toBe(pragmaStmt)
            expect((pragmaStmt['safeIntegers'] as () => unknown)()).toBe(pragmaStmt)
        })
    })

    describe('project-registry-ops', () => {
        let tmpDir: string
        let configPath: string
        let origConfigEnv: string | undefined
        let origRegistryEnv: string | undefined

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-proj-reg-test-'))
            configPath = path.join(tmpDir, 'memory-journal.config.json')
            origConfigEnv = process.env['MEMORY_JOURNAL_CONFIG']
            origRegistryEnv = process.env['PROJECT_REGISTRY']
            process.env['MEMORY_JOURNAL_CONFIG'] = configPath
            delete process.env['PROJECT_REGISTRY']
        })

        afterEach(() => {
            if (origConfigEnv !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = origConfigEnv
            else delete process.env['MEMORY_JOURNAL_CONFIG']
            if (origRegistryEnv !== undefined) process.env['PROJECT_REGISTRY'] = origRegistryEnv
            else delete process.env['PROJECT_REGISTRY']
            fs.rmSync(tmpDir, { recursive: true, force: true })
        })

        it('should register, update, list, get, and delete projects in the registry config', async () => {
            const getConfigFn = createGetConfigFn()
            const cfg = await getConfigFn()
            expect(cfg.dbPath).toBe('memory://internal')

            const mockCreateEntry = vi.fn().mockResolvedValue({ success: true })
            const registerFn = createRegisterProjectFn({ createEntry: mockCreateEntry })

            expect((await registerFn('', tmpDir)).success).toBe(false)
            expect((await registerFn('__proto__', tmpDir)).success).toBe(false)
            expect((await registerFn('alpha', 'relative/path')).success).toBe(false)

            const regRes = await registerFn('alpha', tmpDir, 10)
            expect(regRes.success).toBe(true)
            expect(mockCreateEntry).toHaveBeenCalled()

            const updateFn = createUpdateProjectFn()
            expect((await updateFn('', 'beta')).success).toBe(false)
            expect((await updateFn('nonexistent', 'beta')).success).toBe(false)
            expect(
                (await updateFn('alpha', 'alpha-renamed', 'bad/relative/path')).success
            ).toBe(false)

            const updRes = await updateFn('alpha', 'alpha-renamed', tmpDir, 20)
            expect(updRes.success).toBe(true)

            delete process.env['PROJECT_REGISTRY']
            const listFn = createListProjectsFn({})
            const listed = (await listFn()) as Record<string, unknown>[]
            expect(listed.length).toBe(1)
            expect(listed[0]?.['name']).toBe('alpha-renamed')
            expect(listed[0]?.['project_number']).toBe(20)

            const getProjectFn = createGetProjectFn(listFn)
            const foundByNum = (await getProjectFn(20)) as Record<string, unknown>
            expect(foundByNum['name']).toBe('alpha-renamed')
            const foundByName = (await getProjectFn({ name: 'alpha' })) as Record<string, unknown>
            expect(foundByName['project_number']).toBe(20)
            await expect(getProjectFn('does-not-exist')).rejects.toThrow(/Project not found/)

            const deleteFn = createDeleteProjectFn()
            expect((await deleteFn('')).success).toBe(false)
            expect((await deleteFn('missing-proj')).success).toBe(false)
            const delRes = await deleteFn('alpha-renamed')
            expect(delRes.success).toBe(true)
        })
    })
})
