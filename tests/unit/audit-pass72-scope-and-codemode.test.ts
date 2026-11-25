import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { clearActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { applyEntryAndSearchInterceptions } from '../../src/codemode/normalizers/entry-and-search-interceptions.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { postProcessNormalizedKeys } from '../../src/codemode/api/key-normalizer-postprocess.js'
import { createChildProcessShims } from '../../src/codemode/worker/sandbox-process-shims.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { serializeAndEnforceEgress } from '../../src/codemode/worker/result-compactor.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { ExecuteCodeSchemaMcp } from '../../src/handlers/tools/codemode/schemas.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { rewriteModuleImportsAndExports } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { resolveEffectiveRpcScope } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { healSearchPayload } from '../../src/handlers/tools/schemas/hallucination-healer-search.js'
import { GetProjectSchemaMcp } from '../../src/handlers/tools/admin/schemas/project-and-ops-schemas.js'
import { updateConfigurationSchema } from '../../src/handlers/tools/admin/update_configuration.js'
import { AddToVectorIndexSchema } from '../../src/handlers/tools/admin/vector-tools.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY', 'DB_PATH'] as const

describe('Pass 72 Audit — Move Scope, Metadata Alias Precedence, Code Mode & Healers', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(() => {
        for (const k of SAVED_ENV_KEYS) savedEnv.set(k, process.env[k])
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        clearActiveSessionProject()
        for (const k of SAVED_ENV_KEYS) {
            const orig = savedEnv.get(k)
            if (orig !== undefined) process.env[k] = orig
            else delete process.env[k]
        }
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('C1: resolveMoveUpdateScope rejects conflicting destination project_number and preserves explicit unregistered project_number', async () => {
        const tmpDir = makeTempDir('mj-p72-c1-')
        const repoADir = path.join(tmpDir, 'memory-journal-mcp')
        const repoBDir = path.join(tmpDir, 'other-repo')
        fs.mkdirSync(repoADir, { recursive: true })
        fs.mkdirSync(repoBDir, { recursive: true })

        const db = new DatabaseAdapter(path.join(tmpDir, 'journal.db'))
        await db.initialize()
        try {
            const runtime = new ServerRuntime()
            const cfg = {
                runtime,
                projectRegistry: {
                    'memory-journal-mcp': { path: repoADir, project_number: 5 },
                    'other-repo': { path: repoBDir, project_number: 9 },
                },
            }
            const unassigned = db.createEntry({ content: 'default row', workspaceId: 'default' })
            const conflictWildcard = (await callTool(
                'update_entry',
                {
                    entry_id: unassigned.id,
                    workspace_id: '*',
                    target_workspace_id: 'memory-journal-mcp',
                    project_number: 9,
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(conflictWildcard['success']).toBe(false)
            expect(db.getEntryById(unassigned.id, '*')?.workspaceId).toBe('default')

            const unreg = db.createEntry({ content: 'scratch row', workspaceId: 'scratch-ws' })
            const conflictOther = (await callTool(
                'update_entry',
                {
                    entry_id: unreg.id,
                    workspace_id: 'scratch-ws',
                    target_workspace_id: 'scratch-ws',
                    project_number: 9,
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(conflictOther['success']).toBe(false)

            const validUnreg = (await callTool(
                'update_entry',
                {
                    entry_id: unreg.id,
                    workspace_id: 'scratch-ws',
                    target_workspace_id: 'scratch-ws',
                    project_number: 77,
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(validUnreg['success']).toBe(true)
            expect(db.getEntryById(unreg.id, 'scratch-ws')?.projectNumber).toBe(77)

            const matchingMove = (await callTool(
                'update_entry',
                {
                    entry_id: unassigned.id,
                    workspace_id: '*',
                    target_workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(matchingMove['success']).toBe(true)
            expect(db.getEntryById(unassigned.id, 'memory-journal-mcp')?.projectNumber).toBe(5)
        } finally {
            db.close()
        }
    })

    it('C2: extractMetadataContextAliases never overwrites top-level camelCase/alias scope or type fields', () => {
        const single = applyArgInterceptions('create_entry', [
            {
                content: 'Note',
                workspaceId: 'default',
                projectNumber: 5,
                metadata: { workspace_id: 'other-repo', project_number: 9 },
            },
        ])
        expect('args' in single).toBe(true)
        if ('args' in single) {
            const rec = single.args[0] as Record<string, unknown>
            expect(rec['workspace_id']).toBe('default')
            expect(rec['project_number']).toBe(5)
        }

        const wsOnly = applyArgInterceptions('create_entry', [
            {
                content: 'Note',
                workspaceId: 'default',
                metadata: { workspace_id: 'other-repo' },
            },
        ])
        expect('args' in wsOnly).toBe(true)
        if ('args' in wsOnly) {
            const rec = wsOnly.args[0] as Record<string, unknown>
            expect(rec['workspace_id']).toBe('default')
        }

        const batch = applyArgInterceptions('batch_create_entries', [
            {
                entries: [
                    {
                        content: 'Batch note',
                        workspace: 'memory-journal-mcp',
                        projectNumber: 5,
                        sessionId: 'top-sess',
                        entryType: 'bug_fix',
                        context: {
                            workspace_id: 'other-repo',
                            project_number: 9,
                            session_id: 'nested-sess',
                            type: 'other',
                        },
                    },
                ],
            },
        ])
        expect('args' in batch).toBe(true)
        if ('args' in batch) {
            const first = ((batch.args[0] as Record<string, unknown>)['entries'] as Record<string, unknown>[])[0]
            expect(first?.['workspace_id']).toBe('memory-journal-mcp')
            expect(first?.['project_number']).toBe(5)
            expect(first?.['sessionId']).toBe('top-sess')
            expect(first?.['session_id']).toBeUndefined()
            expect(first?.['entryType']).toBe('bug_fix')
            expect(first?.['type']).toBeUndefined()
        }
    })

    it('C-M1 to C-M8: sandbox shims, schema defaults, INSERT SELECT, unwrapper, nested update, RPC bounds, Error egress, ASI block comment', async () => {
        const shims = createChildProcessShims()
        const spawnChild = (shims['spawn'] as (cmd: string) => Record<string, unknown>)('ls')
        expect(Object.isFrozen(spawnChild['on'])).toBe(true)
        expect(Object.isFrozen(spawnChild['stdout'])).toBe(true)

        const mcpParsed = ExecuteCodeSchemaMcp.partial().loose().parse({ code: 'return 1', autoVersion: false })
        expect(mcpParsed.auto_version).toBeUndefined()

        const badInsert = parseSqlStatement('INSERT INTO memory_journal (content) SELECT content FROM other', [
            { content: 'x' },
        ])
        expect(badInsert.action).toBe('unmapped')

        expect(healCodeModeScript('await mj.executeCode("return 1"); return 42;')).not.toBe('return 1')
        expect(healCodeModeScript('await mj.executeCode("const a = 1;\\nreturn a")')).toContain('\nreturn a')

        const calls: Array<{ method: string; payload: unknown }> = []
        const exec = createSandboxExecutor({
            shimMj: {
                core: {
                    createEntry: (p: unknown) => {
                        calls.push({ method: 'createEntry', payload: p })
                        return { success: true }
                    },
                },
                admin: {
                    updateEntry: (p: unknown) => {
                        calls.push({ method: 'updateEntry', payload: p })
                        return { success: true }
                    },
                },
            },
            vmContextRef: { current: vm.createContext({}) },
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: { alpha: { path: process.cwd(), project_number: 1 } },
            runIsolatedNestedCode: async () => ({ success: true }),
        })
        await exec({ entry_id: 42, content: 'upd' }, { workspace_id: 'alpha' })
        expect(calls[0]?.method).toBe('updateEntry')
        const conflictOpts = (await exec(
            { content: 'x', workspace_id: 'alpha' },
            { workspace_id: 'beta' }
        )) as Record<string, unknown>
        expect(conflictOpts['success']).toBe(false)

        const nestedScopeErr = validateNestedExecScope(
            { project_number: 999 },
            'alpha',
            undefined,
            { alpha: { path: process.cwd(), project_number: 1 } }
        )
        expect(nestedScopeErr?.error).toMatch(/conflicts/i)

        const rpcErr = resolveEffectiveRpcScope(
            { workspaceId: undefined, projectId: undefined },
            { workspaceId: 'alpha', projectNumber: 999 },
            { alpha: { path: process.cwd(), project_number: 1 } }
        )
        expect('errorResult' in rpcErr).toBe(true)

        const boom = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
        const selfErr = new Error('cyclic') as Error & { self?: unknown }
        selfErr.self = selfErr
        const egress = {
            success: true,
            result: { err: boom, a: boom, cyc: selfErr },
            metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
        }
        serializeAndEnforceEgress(egress, 100 * 1024)
        expect(egress.success).toBe(true)
        const outRec = egress.result as Record<string, Record<string, unknown>>
        expect(outRec['err']).toEqual({ name: 'Error', message: 'timeout', code: 'ETIMEDOUT' })
        expect(outRec['a']).toEqual({ name: 'Error', message: 'timeout', code: 'ETIMEDOUT' })
        expect(outRec['cyc']?.['self']).toBe('[Circular]')

        expect(transformAutoReturn('await mj.core.getRecentEntries() /* c\n*/ await mj.core.listTags()')).toBe(
            'await mj.core.getRecentEntries() /* c\n*/\nreturn await mj.core.listTags()'
        )
    })

    it('C-L1 to C-L5 & D-M4/D-L2: team two-arg update, sealed proxies, export default strings, filter order, and signed IDs/undef aliases', () => {
        const twoArg = applyArgInterceptions('teamUpdateEntry', [7, { content: 'upd', version: 2 }])
        expect('args' in twoArg).toBe(true)
        if ('args' in twoArg) {
            expect((twoArg.args[0] as Record<string, unknown>)['entry_id']).toBe(7)
            expect((twoArg.args[0] as Record<string, unknown>)['expected_version']).toBe(2)
        }
        const directTwoArg = applyEntryAndSearchInterceptions('teamUpdateEntry', ['#7', { content: 'upd' }])
        expect('args' in directTwoArg).toBe(true)
        if ('args' in directTwoArg) expect((directTwoArg.args[0] as Record<string, unknown>)['entry_id']).toBe(7)

        const sealed = wrapResult(Object.seal({ success: false, error: 'x' })) as object
        expect(Object.isExtensible(sealed)).toBe(true)
        const aliasRev = wrapResult({
            history: [Object.seal({ revisionId: 2, content: 'c' })],
        }) as { revisions: object[] }
        expect(Object.isExtensible(aliasRev.revisions[0])).toBe(true)

        const rewritten = rewriteModuleImportsAndExports(
            'export default async function(mj) { return await mj.core.createEntry({ content: "See export default docs" }); }'
        )
        expect(rewritten).not.toMatch(/^export\s+default/m)
        expect(rewritten).toContain(')(mj)')

        const postObj: Record<string, unknown> = { filter: { tag: 'decision', limit: '5' } }
        postProcessNormalizedKeys(postObj, 'searchEntries')
        expect(postObj['tags']).toEqual(['decision'])

        expect(healAgentHallucinations({ entry_id: '#-5' })).toMatchObject({ entry_id: '#-5' })
        expect(healAgentHallucinations({ entry_id: 'id:-5', entry_ids: ['entry--5', '#5'] })).toMatchObject({
            entry_id: 'id:-5',
            entry_ids: ['entry--5', 5],
        })
        expect(healSearchPayload({ workspace_id: undefined, workspaceId: 'alpha' })).toMatchObject({
            workspace_id: 'alpha',
        })
        expect(GetProjectSchemaMcp.parse({ name: undefined, project: 'alpha' })).toEqual({ name: 'alpha' })
        expect(updateConfigurationSchema.parse({ tool_filter: undefined, filter: 'starter' })).toMatchObject({
            tool_filter: 'starter',
        })
        expect(AddToVectorIndexSchema.parse({ entry_id: undefined, id: 5 }).entry_id).toBe(5)
    })
})
