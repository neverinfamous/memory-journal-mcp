/**
 * Extended Unit Tests for Code Mode:
 * - TypeScript Declaration Generator (src/codemode/type-generator.ts)
 * - Git API Interceptions (src/codemode/api/git-api.ts)
 * - Worker Result Proxy (src/codemode/worker-result-proxy.ts)
 * - JournalApi Sandbox Bindings & Schemas (src/codemode/api/journal-api.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { z } from 'zod'
import {
    getZodTypeString,
    generateTypescriptDeclarations,
} from '../../src/codemode/type-generator.js'
import { applyGitInterceptions } from '../../src/codemode/api/git-api.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { createJournalApi } from '../../src/codemode/api/journal-api.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { collectNonCodeModeTools } from '../../src/handlers/tools/codemode/singleton-state.js'
import type { ToolDefinition } from '../../src/types/index.js'

describe('Code Mode Extended Coverage', () => {
    describe('TypeScript Declaration Generator (src/codemode/type-generator.ts)', () => {
        it('should convert Zod schemas into TypeScript type strings and generate .d.ts namespace declarations', () => {
            expect(getZodTypeString(z.string())).toBe('string')
            expect(getZodTypeString(z.number())).toBe('number')
            expect(getZodTypeString(z.boolean())).toBe('boolean')
            expect(getZodTypeString(z.array(z.string()))).toBe('string[]')
            expect(getZodTypeString(z.string().optional())).toBe('string')
            expect(getZodTypeString(z.string().nullable())).toBe('string | null')
            expect(getZodTypeString(z.string().default('x'))).toBe('string')
            expect(getZodTypeString(z.union([z.string(), z.number()]))).toBe('string | number')
            expect(getZodTypeString(z.enum(['a', 'b']))).toBe("'a' | 'b'")
            expect(
                getZodTypeString(
                    z.object({
                        req: z.string(),
                        opt: z.number().optional(),
                    })
                )
            ).toBe('{ req: string, opt?: number }')
            expect(getZodTypeString({})).toBe('unknown')

            const sampleTools: ToolDefinition[] = [
                {
                    name: 'create_entry',
                    title: 'Create Entry',
                    description: 'Create a journal entry',
                    group: 'core',
                    inputSchema: z.object({ content: z.string() }),
                    handler: () => ({}),
                },
                {
                    name: 'mj_execute_code',
                    title: 'Execute Code',
                    description: 'Skip codemode tools',
                    group: 'codemode',
                    inputSchema: z.object({ code: z.string() }),
                    handler: () => ({}),
                },
            ]

            const dts = generateTypescriptDeclarations(sampleTools)
            expect(dts).toContain('declare namespace mj {')
            expect(dts).toContain('namespace core {')
            expect(dts).toContain('function createEntry(args?: { content: string }): Promise<unknown>;')
            expect(dts).not.toContain('mj_execute_code')
        })
    })

    describe('Git API Interceptions (src/codemode/api/git-api.ts)', () => {
        it('should map search query aliases for searchCommits and reject query params on non-search git methods', () => {
            // 1. searchCommits maps text/q -> query and limit/keep -> maxCount
            const searchRes = applyGitInterceptions('searchCommits', [
                { q: 'feat', limit: 15 },
            ]) as { args: Record<string, unknown>[] }
            expect(searchRes.args[0]?.['query']).toBe('feat')
            expect(searchRes.args[0]?.['maxCount']).toBe(15)

            const keepRes = applyGitInterceptions('getCommitHistory', [{ keep: 5 }]) as {
                args: Record<string, unknown>[]
            }
            expect(keepRes.args[0]?.['maxCount']).toBe(5)

            // 2. Non-search git method with q/query returns validation error
            const errRes = applyGitInterceptions('getCommitHistory', [{ query: 'bad' }]) as {
                error: { success: boolean; code: string }
            }
            expect(errRes.error.success).toBe(false)
            expect(errRes.error.code).toBe('VALIDATION_ERROR')

            // 3. Unrelated method returns null
            expect(applyGitInterceptions('createEntry', [{}])).toBeNull()
        })
    })

    describe('Worker Result Proxy (src/codemode/worker-result-proxy.ts)', () => {
        it('should proxy failed results, array results, and success object results with DX shims', () => {
            // 1. Primitives & null pass through
            expect(wrapResult(null)).toBeNull()
            expect(wrapResult(42)).toBe(42)

            // 2. Failed result proxy
            const failed = wrapResult({
                success: false,
                code: 'VALIDATION_ERROR',
                error: 'Invalid input',
            }) as Record<string, unknown>
            expect(failed['error']).toBe('[VALIDATION_ERROR] Invalid input')
            expect(failed['length']).toBe(0)
            expect(failed['0']).toBeUndefined()
            expect(failed['entries']).toEqual([])
            expect(typeof failed['map']).toBe('function')
            expect((failed['map'] as () => unknown[])()).toEqual([])
            expect([...(failed as unknown as Iterable<unknown>)]).toEqual([])

            // 3. Array result proxy
            const arrProxy = wrapResult([{ id: 1 }, { id: 2 }]) as Record<string, unknown>
            expect(arrProxy['success']).toBe(true)
            expect(arrProxy['projects']).toBe(arrProxy)
            expect(arrProxy['results']).toBe(arrProxy)
            expect(arrProxy['length']).toBe(2)

            // 4. Success object with entries, pagination, and count shims
            const entriesRes = wrapResult({
                success: true,
                entries: [{ id: 10, content: 'A' }, { id: 20, content: 'B' }],
                count: 2,
                next_cursor: 'cursor-123',
            }) as Record<string, unknown>
            expect(entriesRes['hasMore']).toBe(true)
            expect(entriesRes['total']).toBe(2)
            expect(entriesRes['entryIds']).toEqual([10, 20])
            expect(entriesRes['length']).toBe(2)
            expect(entriesRes['0']).toEqual({ id: 10, content: 'A' })
            expect(entriesRes['items']).toEqual([
                { id: 10, content: 'A' },
                { id: 20, content: 'B' },
            ])
            expect(entriesRes['result']).toBe(entriesRes)
            expect(
                (entriesRes['map'] as (fn: (x: { id: number }) => number) => number[])((x) => x.id)
            ).toEqual([10, 20])
            expect([...(entriesRes as unknown as Iterable<unknown>)].length).toBe(2)

            // Mutator methods throw helpful validation error
            expect(() => (entriesRes['push'] as () => void)()).toThrow(/Array mutator method/)

            // 5. Single entry & single project shims
            const singleEntry = wrapResult({
                success: true,
                entry: { id: 77, content: 'Single' },
            }) as Record<string, unknown>
            expect(singleEntry['id']).toBe(77)
            expect(singleEntry['entryId']).toBe(77)

            const singleProj = wrapResult({
                success: true,
                project: { name: 'alpha', project_number: 5, path: '/alpha' },
            }) as Record<string, unknown>
            expect(singleProj['project_number']).toBe(5)
            expect(singleProj['name']).toBe('alpha')
            expect(singleProj['path']).toBe('/alpha')
            expect(singleProj['length']).toBe(1)
            expect(singleProj['0']).toEqual({ name: 'alpha', project_number: 5, path: '/alpha' })
            expect([...(singleProj as unknown as Iterable<unknown>)].length).toBe(1)

            // 6. Revisions history shim & deletedIds shim
            const histRes = wrapResult({
                success: true,
                history: [{ revisionId: 3, content: 'Snap' }],
                deleted: [5, 6],
                count: 2,
            }) as Record<string, unknown>
            const revisions = histRes['revisions'] as Record<string, unknown>[]
            expect(revisions[0]?.['revisionNumber']).toBe(3)
            expect(revisions[0]?.['contentSnapshot']).toBe('Snap')
            expect(histRes['deletedIds']).toEqual([5, 6])
            expect(histRes['deletedCount']).toBe(2)

            // 7. Statistics self-reference shim
            const statsRes = wrapResult({
                totalEntries: 100,
                entriesByType: { technical_note: 50 },
            }) as Record<string, unknown>
            expect(statsRes['statistics']).toBe(statsRes)
            expect(statsRes['total']).toBe(100)

            // 8. Projects dictionary conversion shim
            const projDictRes = wrapResult({
                success: true,
                projects: {
                    'my-proj': { project_number: 9, description: 'Desc' },
                },
            }) as Record<string, unknown>
            expect(projDictRes['length']).toBe(1)
            expect([...(projDictRes as unknown as Iterable<unknown>)].length).toBe(1)
        })
    })

    describe('JournalApi Sandbox Bindings & Schemas (src/codemode/api/journal-api.ts)', () => {
        let tmpDir: string
        let db: DatabaseAdapter

        beforeEach(async () => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-journal-api-test-'))
            db = new DatabaseAdapter(path.join(tmpDir, 'api-test.db'))
            await db.initialize()
        })

        afterEach(() => {
            try {
                db.close()
            } catch {
                // ignore
            }
            fs.rmSync(tmpDir, { recursive: true, force: true })
        })

        it('should create sandbox bindings, schemas, help, schema callable, and anti-hallucination interceptors', async () => {
            const tools = collectNonCodeModeTools({
                db,
                config: { defaultProjectNumber: 5 },
            })
            const api = createJournalApi(tools)

            expect(api.getGroups().length).toBeGreaterThan(5)
            expect(api.getGroupMethods('core').length).toBeGreaterThan(5)

            const schemas = api.createSandboxSchemas()
            expect(schemas['core']).toBeDefined()
            expect(schemas['core']?.['createEntry']).toBeDefined()

            const bindings = api.createSandboxBindings()
            expect(typeof bindings['help']).toBe('function')
            const helpRes = await (bindings['help'] as () => Promise<{ totalMethods: number }>)()
            expect(helpRes.totalMethods).toBeGreaterThan(20)

            // Factory shims return bindings
            expect((bindings['getInstance'] as () => unknown)()).toBe(bindings)
            expect((bindings['getClient'] as () => unknown)()).toBe(bindings)

            // Schema callable & methods
            const schemaObj = bindings['schema'] as {
                (): Promise<unknown>
                help: () => Promise<{ group: string }>
                listTables: () => Promise<{ tables: string[] }>
                describeTable: (t?: string) => Promise<{ table?: string; group?: string }>
            }
            const schemaHelp = await schemaObj.help()
            expect(schemaHelp.group).toBe('schema')
            const tables = await schemaObj.listTables()
            expect(tables.tables).toContain('entries')
            const descEntries = await schemaObj.describeTable('entries')
            expect(descEntries.group).toBe('schema')
            const descCustom = await schemaObj.describeTable('custom_table')
            expect(descCustom.table).toBe('custom_table')

            // readResource interceptor for supported and unsupported URIs
            const readResource = bindings['readResource'] as (uri?: string) => Promise<unknown>
            const recentRes = await readResource('memory://recent')
            expect(recentRes).toBeDefined()
            const statsRes = await readResource('memory://statistics')
            expect(statsRes).toBeDefined()
            const tagsRes = await readResource('memory://tags')
            expect(tagsRes).toBeDefined()
            await expect(readResource('memory://significant')).rejects.toThrow(/Try:/)

            // Agent.exec and setWorkspace anti-hallucination interceptors
            const agentObj = bindings['Agent'] as {
                exec: () => Promise<never>
                system: { exec: () => Promise<never> }
            }
            await expect(agentObj.exec()).rejects.toThrow(/AUTONOMOUS HEALING/)
            await expect(agentObj.system.exec()).rejects.toThrow(/AUTONOMOUS HEALING/)

            const setWorkspace = bindings['setWorkspace'] as () => Promise<never>
            await expect(setWorkspace()).rejects.toThrow(/workspace_id/)
        })
    })
})
