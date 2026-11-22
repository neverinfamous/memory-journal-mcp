import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { BatchCreateEntriesSchema } from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import { prepareBatchCreateInputs } from '../../src/handlers/tools/admin/batch-create-helpers.js'
import {
    parseCanonicalMoveEntryId,
    normalizeBatchDispatchItems,
} from '../../src/handlers/tools/codemode/dispatch-batch-scope.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { resolveEffectiveRpcScope } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { hasUnsupportedSqlTrailingClause } from '../../src/codemode/sql-clause-validator.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import { compactOversizedResult } from '../../src/codemode/worker/result-compactor.js'
import { createEntriesDomainProxy } from '../../src/codemode/worker/mj-shim-domains.js'
import { createShimMjProxy } from '../../src/codemode/worker/mj-shim-proxy.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { synthesizeNaturalLanguageOrEntryPayload } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/regex-safety.js'
import { setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { isDefaultWorkspaceName } from '../../src/utils/write-scope.js'
import type { SafeFsShim } from '../../src/codemode/worker/node-shims.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    adamic: { path: process.cwd(), project_number: 16 },
}

describe('Pass 68 Audit — Code Mode Recovery, SQL Guards, Proxies, Auto-Return & Regex Safety', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('TB-C1: batch_create_entries refuses wildcard/mismatched workspace inheritance onto item project_number', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const runtime = new ServerRuntime()
            const context: ToolContext = {
                db,
                runtime,
                config: {
                    runtime,
                    defaultWorkspaceId: 'memory-journal-mcp',
                    projectRegistry: TEST_REGISTRY,
                },
            }

            const wildcardBatch = BatchCreateEntriesSchema.parse({
                workspace_id: '*',
                entries: [{ content: 'explicit proj under wildcard', project_number: 16 }],
            })
            await expect(
                prepareBatchCreateInputs(
                    wildcardBatch.entries,
                    wildcardBatch.project_number,
                    context,
                    wildcardBatch.workspace_id
                )
            ).rejects.toThrow(/workspace_id/i)

            const omittedRootBatch = BatchCreateEntriesSchema.parse({
                entries: [{ content: 'item proj without item ws', project_number: 16 }],
            })
            const prepared = await prepareBatchCreateInputs(
                omittedRootBatch.entries,
                omittedRootBatch.project_number,
                context,
                omittedRootBatch.workspace_id
            )
            expect(prepared[0]?.input.workspaceId).toBe('adamic')
            expect(prepared[0]?.input.projectNumber).toBe(16)

            const mismatchedRootBatch = BatchCreateEntriesSchema.parse({
                workspace_id: 'memory-journal-mcp',
                entries: [{ content: 'mismatch root ws and item proj', project_number: 16 }],
            })
            await expect(
                prepareBatchCreateInputs(
                    mismatchedRootBatch.entries,
                    mismatchedRootBatch.project_number,
                    context,
                    mismatchedRootBatch.workspace_id
                )
            ).rejects.toThrow(/does not match workspace/i)

            const foreignDefaultItemBatch = BatchCreateEntriesSchema.parse({
                project_number: 5,
                entries: [{ content: 'explicit default item under root proj', workspace_id: 'default' }],
            })
            await expect(
                prepareBatchCreateInputs(
                    foreignDefaultItemBatch.entries,
                    foreignDefaultItemBatch.project_number,
                    context,
                    foreignDefaultItemBatch.workspace_id
                )
            ).rejects.toThrow()
        } finally {
            db.close()
        }
    })

    it('TB-C2: cross-workspace moves fail closed on missing/invalid numeric entry_id under * and default', async () => {
        expect(parseCanonicalMoveEntryId({ entry_id: 42 })).toBe(42)
        expect(parseCanonicalMoveEntryId({ entry_id: '42' })).toBe(42)
        expect(parseCanonicalMoveEntryId({ id: 'abc' })).toBeUndefined()
        expect(parseCanonicalMoveEntryId({ entry_id: -5 })).toBeUndefined()

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const sessionContext: ToolContext = {
                db,
                runtime: new ServerRuntime(),
                config: { projectRegistry: TEST_REGISTRY },
            }
            const batchErr = normalizeBatchDispatchItems(
                'updates',
                { updates: [{ id: 'not-a-number', content: 'moved', target_workspace_id: 'adamic' }] },
                TEST_REGISTRY,
                {
                    projectId: 5,
                    workspaceId: '*',
                    toolName: 'batch_update_entries',
                    sessionContext,
                    isDefaultWorkspaceName,
                    coerceProjectNumberField: () => undefined,
                }
            )
            expect(batchErr).toBeDefined()
            expect(batchErr?.errorResult['code']).toBe('VALIDATION_ERROR')

            const fakeUpdateTool: ToolDefinition = {
                name: 'update_entry',
                description: 'update',
                group: 'admin',
                inputSchema: z.object({ entry_id: z.number(), workspace_id: z.string().optional() }),
                handler: () => Promise.resolve({ success: true }),
            }
            const singleMoveErr = await normalizeDispatchParams(
                fakeUpdateTool,
                { entry_id: 'bad-id', workspace_id: '*', target_workspace_id: 'adamic' },
                { sessionContext, projectId: 5, workspaceId: '*', explicitWorkspace: true }
            )
            expect('errorResult' in singleMoveErr).toBe(true)
            if ('errorResult' in singleMoveErr) {
                expect(singleMoveErr.errorResult['code']).toBe('VALIDATION_ERROR')
            }
        } finally {
            db.close()
        }
    })

    it('TB-H1 & TB-H2: rejects intervening prepared statements and unsupported SQL trailing clauses/CTEs', () => {
        expect(
            extractAndRecoverPreparedStatementCode(
                "const s = db.prepare('INSERT INTO memory_journal (content) VALUES (?)'); doSomething(); s.run('x');"
            )
        ).toBeNull()
        expect(
            extractAndRecoverPreparedStatementCode(
                "const s = db.prepare('INSERT INTO memory_journal (content) VALUES (?)'); s.run('clean note');"
            )
        ).toContain('clean note')

        expect(hasUnsupportedSqlTrailingClause('SELECT id FROM memory_journal UNION SELECT id FROM tags', 'select')).toBe(true)
        expect(hasUnsupportedSqlTrailingClause('SELECT a.id FROM memory_journal a JOIN tags b ON a.id = b.id', 'select')).toBe(true)
        expect(hasUnsupportedSqlTrailingClause('SELECT id FROM memory_journal GROUP BY entry_type HAVING COUNT(*) > 1', 'select')).toBe(true)
        expect(hasUnsupportedSqlTrailingClause('SELECT * FROM memory_journal WHERE workspace_id = "adamic" ORDER BY id DESC LIMIT 10', 'select')).toBe(false)
        expect(hasUnsupportedSqlTrailingClause('DELETE FROM memory_journal WHERE id = 1 LIMIT 1', 'mutation')).toBe(true)

        expect(extractAndRecoverSqlCode('WITH cte AS (SELECT id FROM memory_journal) SELECT * FROM cte')).toBeNull()
        expect(extractAndRecoverSqlCode('SELECT * FROM memory_journal WHERE id IN (SELECT entry_id FROM entry_tags)')).toBeNull()
        expect(
            parseSqlStatement('SELECT CASE WHEN 1=1 THEN id ELSE 0 END FROM memory_journal', []).action
        ).toBe('unmapped')

        const validSelect = parseSqlStatement(
            "SELECT * FROM memory_journal WHERE id = 42 AND workspace_id = 'adamic' LIMIT 5",
            []
        )
        expect(validSelect.action).toBe('get_by_id')
        expect(validSelect.params['entry_id']).toBe(42)
    })

    it('TB-M10 & TB-M11: preserves default session projectNumber and enforces nested RPC/registry ownership', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const runtime = new ServerRuntime()
            setActiveSessionProject('default', 99, runtime)
            const ctx: ToolContext = {
                db,
                runtime,
                config: {
                    runtime,
                    defaultWorkspaceId: 'default',
                    projectRegistry: TEST_REGISTRY,
                },
            }
            const resolvedUnclaimed = await resolveCodeModeSessionContext(ctx, { code: 'return 1' })
            expect('errorResponse' in resolvedUnclaimed).toBe(false)
            if (!('errorResponse' in resolvedUnclaimed)) {
                expect(resolvedUnclaimed.workspaceId).toBe('default')
                expect(resolvedUnclaimed.numericProjectId).toBe(99)
            }

            setActiveSessionProject('default', 5, runtime)
            const resolvedClaimed = await resolveCodeModeSessionContext(ctx, { code: 'return 1' })
            expect('errorResponse' in resolvedClaimed).toBe(false)
            if (!('errorResponse' in resolvedClaimed)) {
                expect(resolvedClaimed.workspaceId).toBe('memory-journal-mcp')
                expect(resolvedClaimed.numericProjectId).toBe(5)
            }
        } finally {
            db.close()
        }

        const scopeMismatch = resolveEffectiveRpcScope(
            { workspaceId: '*', projectId: 5 },
            { workspaceId: 'adamic' },
            TEST_REGISTRY
        )
        expect('errorResult' in scopeMismatch).toBe(true)

        const nestedConflict = validateNestedExecScope(
            { workspace_id: 'adamic' },
            undefined,
            5,
            TEST_REGISTRY
        )
        expect(nestedConflict).not.toBeNull()
        expect(nestedConflict?.error).toContain('conflicts with pinned session project_number 5')
    })

    it('TB-M12, TB-M13 & TB-M14: compactor skips functions, synthesizers keep target_workspace_id, shims freeze & map readFile', () => {
        const bigText = 'x'.repeat(2500)
        const compacted = compactOversizedResult(
            {
                id: 1,
                body: bigText,
                toJSON: () => ({ hacked: true }),
                helperFn: () => 42,
            },
            300
        ) as Record<string, unknown>
        expect(compacted['toJSON']).toBeUndefined()
        expect(compacted['helperFn']).toBeUndefined()

        const recRecovered = extractAndRecoverEntryCode(
            "mj.core.updateEntry({ entry_id: 10, workspace_id: '*', target_workspace_id: 'adamic', content: 'moved' })"
        )
        expect(recRecovered).toContain('"target_workspace_id":"adamic"')

        const jsonRecovered = recoverStructuredJsonCode(
            JSON.stringify({
                entry_id: 11,
                workspace_id: '*',
                targetWorkspaceId: 'adamic',
                content: 'json moved',
            })
        )
        expect(jsonRecovered).toContain('"target_workspace_id":"adamic"')

        const nlRecovered = synthesizeNaturalLanguageOrEntryPayload(
            'move this entry cleanly',
            { code: 'move this entry cleanly', workspace_id: '*', target_workspace_id: 'adamic' },
            { target_workspace_id: 'adamic', content: 'moved' }
        )
        expect(nlRecovered).toContain('"target_workspace_id":"adamic"')

        const entriesProxy = createEntriesDomainProxy({
            core: {
                getRecentEntries: vi.fn(),
                createEntry: vi.fn(),
                getEntryById: vi.fn(),
            },
        }) as Record<string, unknown> | undefined
        expect(entriesProxy).toBeDefined()
        if (entriesProxy !== undefined) {
            expect(() => {
                entriesProxy['injected'] = 1
            }).toThrow(TypeError)
            expect(() => {
                delete entriesProxy['create']
            }).toThrow(TypeError)
            expect(() => {
                Object.setPrototypeOf(entriesProxy, {})
            }).toThrow(TypeError)
        }

        const readFileFn = vi.fn().mockResolvedValue('async-file')
        const readFileSyncFn = vi.fn().mockReturnValue('sync-file')
        const fsShim = {
            readFile: readFileFn,
            readFileSync: readFileSyncFn,
            writeFile: vi.fn(),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
            appendFileSync: vi.fn(),
            unlinkSync: vi.fn(),
            stat: vi.fn(),
            statSync: vi.fn(),
            lstatSync: vi.fn(),
            readdirSync: vi.fn(),
            existsSync: vi.fn(),
            promises: {
                readFile: readFileFn,
                writeFile: vi.fn(),
                stat: vi.fn(),
                readdir: vi.fn(),
            },
        } as unknown as SafeFsShim
        const shim = createShimMjProxy({
            mjApi: {},
            safeFsShim: fsShim,
            executeCodeFnRef: {},
            getUpdateMemoryFn: () => vi.fn(),
        })
        expect(shim['readFile']).toBe(readFileFn)
        expect(shim['readFileSync']).toBe(readFileSyncFn)
    })

    it('TB-M15, TB-M16 & payload recovery: handles binary auto-return, named/nullable regex groups & context recovery', () => {
        const arith = transformAutoReturn('const a = 1\na\n+ 2')
        expect(arith).toContain('return a\n+ 2')
        expect(arith).not.toContain('return a;')

        const divOp = transformAutoReturn('const a = 4\na\n/ 2')
        expect(divOp).toContain('return a\n/ 2')

        const cmp = transformAutoReturn('const a = 1\na\n=== 1')
        expect(cmp).toContain('return a\n=== 1')

        const inExpr = transformAutoReturn('const obj = { k: 1 }\n"k"\nin obj')
        expect(inExpr).toContain('return "k"\nin obj')

        const commentNext = transformAutoReturn('foo()\n// trailing comment')
        expect(commentNext).toBe('foo()\n// trailing comment')
        expect(commentNext).not.toContain('return //')

        const unaryInc = transformAutoReturn('foo()\n++count')
        expect(unaryInc).toContain('return ++count')

        expect(isSafeUserRegex('(?<w1>[a-z])+(?<w2>[a-z])+')).toBe(false)
        expect(isSafeUserRegex('a+(?:bc)?a+')).toBe(false)
        expect(isSafeUserRegex('(?:ab)+(?:cd)+(?:ef)+(?:gh)+(?:ij)+(?:kl)+')).toBe(false)
        expect(isSafeUserRegex('(?<tag>feat|fix)\\s+\\w+')).toBe(true)

        const ctxQuery = resolveExecutionPayload(
            { context: { query: 'auth bug' } },
            { workspace_id: 'adamic', project_number: 16, context: { query: 'auth bug' } },
            true,
            Date.now()
        )
        expect('executionCode' in ctxQuery).toBe(true)
        if ('executionCode' in ctxQuery) {
            expect(ctxQuery.executionCode).toContain('"workspace_id":"adamic"')
            expect(ctxQuery.executionCode).toContain('"project_number":16')
        }

        const blankBodyCtx = resolveExecutionPayload(
            { context: { content: '   ' } },
            { context: { content: '   ' } },
            true,
            Date.now()
        )
        expect('earlyReturn' in blankBodyCtx).toBe(true)
        if ('earlyReturn' in blankBodyCtx) {
            expect(JSON.stringify(blankBodyCtx.earlyReturn)).not.toContain('createEntry')
        }
    })
})
