import * as vm from 'node:vm'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rewriteModuleImportsAndExports } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { synthesizeNaturalLanguageOrEntryPayload } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/regex-safety.js'
import { createIsolatedNestedRunner } from '../../src/codemode/worker/nested-exec-runner.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY'] as const

describe('Pass 69 Audit — Code Mode Rewrites, Recovery Synthesizers, ReDoS & Worker Contracts', () => {
    const savedEnv = new Map<string, string | undefined>()

    beforeEach(() => {
        for (const k of SAVED_ENV_KEYS) savedEnv.set(k, process.env[k])
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        for (const k of SAVED_ENV_KEYS) {
            const orig = savedEnv.get(k)
            if (orig !== undefined) process.env[k] = orig
            else delete process.env[k]
        }
    })

    it('TB2-M3: rewrites default export function(mj) with balanced braces and zero TDZ error', async () => {
        const commentTrailing = [
            'export default async function(mj) {',
            '  if (mj.ping() === 42) { return "ok"; }',
            '  return "miss";',
            '}',
            '// trailing brace { } in comment',
        ].join('\n')

        const rewrittenComment = rewriteModuleImportsAndExports(commentTrailing)
        expect(rewrittenComment).not.toContain('mj = mj')
        expect(rewrittenComment).toContain('(mj)')

        const result = (await vm.runInNewContext(rewrittenComment, {
            mj: { ping: () => 42 },
        })) as unknown
        expect(result).toBe('ok')

        const withTrailingHelper = [
            'export default async function(mj) {',
            '  if (mj.ping() === 42) { return "ok"; }',
            '}',
            'function trailingHelper() { return 1; }',
        ].join('\n')
        const rewrittenHelper = rewriteModuleImportsAndExports(withTrailingHelper)
        expect(rewrittenHelper).toContain('function trailingHelper() { return 1; }')
        expect(() => new vm.Script(rewrittenHelper)).not.toThrow()
    })

    it('TB2-M4: json-entry-recovery ignores nested auto_context type and tags during top-level extraction', () => {
        const recovered = extractAndRecoverEntryCode(
            `mj.core.createEntry({
                content: "Top body",
                auto_context: { type: "deploy", tags: ["nested-only"] },
                tags: ["outer-tag"]
            })`
        )
        expect(recovered).not.toBeNull()
        expect(recovered).toContain('"entry_type":"technical_note"')
        expect(recovered).toContain('"tags":["outer-tag"]')
        expect(recovered).not.toContain('"entry_type":"deploy"')
        expect(recovered).toContain('"auto_context":{"type":"deploy","tags":["nested-only"]}')
    })

    it('TB2-M5 & TB2-M6: omits unrequested entry_type/tags on updates and routes entry_id in payload-synthesizer', () => {
        const recUpdate = extractAndRecoverEntryCode(
            'mj.core.updateEntry({ entry_id: 7, content: "Patched body" })'
        )
        expect(recUpdate).toContain('mj.updateEntry')
        expect(recUpdate).not.toContain('"entry_type"')
        expect(recUpdate).not.toContain('"tags"')

        const jsonUpdate = recoverStructuredJsonCode(
            JSON.stringify({ entry_id: 7, content: 'Patched JSON' })
        )
        expect(jsonUpdate).toContain('mj.admin.updateEntry')
        expect(jsonUpdate).not.toContain('"title"')
        expect(jsonUpdate).not.toContain('"entry_type"')
        expect(jsonUpdate).not.toContain('"tags"')

        const nlUpdate = synthesizeNaturalLanguageOrEntryPayload(
            'patch entry 7 body cleanly',
            { code: 'patch entry 7 body cleanly', entry_id: 7 },
            { entry_id: 7, content: 'Updated NL' }
        )
        expect(nlUpdate).toContain('mj.updateEntry')
        expect(nlUpdate).not.toContain('"title"')
        expect(nlUpdate).not.toContain('"entry_type"')
        expect(nlUpdate).not.toContain('"tags"')

        const recoveredParams = resolveExecutionPayload(
            { entry_id: 42, learned_context: 'Root cause note' },
            { entry_id: 42, learned_context: 'Root cause note' },
            true,
            Date.now()
        )
        expect('executionCode' in recoveredParams).toBe(true)
        if ('executionCode' in recoveredParams) {
            expect(recoveredParams.executionCode).toContain('mj.updateEntry')
            expect(recoveredParams.executionCode).toContain('"entry_id":42')
            expect(recoveredParams.executionCode).not.toContain('"title"')
            expect(recoveredParams.executionCode).not.toContain('"entry_type"')
        }
    })

    it('TB2-M7: regex-safety classifies (?=) as zero-width, rejects repeating lookarounds, and restores entryPrev', () => {
        expect(isSafeUserRegex('^a+(?!b)a+(?!b)a+(?!b)a+(?!b)a+$')).toBe(false)
        expect(isSafeUserRegex('^a+(?=a)a+(?=a)a+(?=a)a+(?=a)a+$')).toBe(false)
        expect(isSafeUserRegex('^(?=a)+$')).toBe(false)
        expect(isSafeUserRegex('foo(?=\\s*bar)')).toBe(true)
    })

    it('TB2-L13: nested-exec-runner ignores non-safe integer pinnedProjectRaw values', async () => {
        const captured: Array<{ projectNumber?: number; workspaceId?: string }> = []
        const runner = createIsolatedNestedRunner(
            {
                sendRpcRequest: async () => ({}),
                rpcFn: async () => ({}),
                methodList: [],
                schemaList: [],
                timeoutMs: 1000,
                maxResultSize: 10_000,
                contextObj: {},
                readonlyMode: true,
                dryRunMode: false,
                useTestDbMode: false,
                pinnedWorkspaceRaw: 'adamic',
                pinnedProjectRaw: Number.MAX_SAFE_INTEGER + 1,
                activeTimers: new Set(),
            },
            async () => ({}),
            (opts) => {
                captured.push({
                    projectNumber: opts.pinnedProjectRaw,
                    workspaceId: opts.pinnedWorkspaceRaw,
                })
                return vm.createContext({ result: 1 })
            }
        )
        await runner('const x = 1;', true, false, false)
        expect(captured.length).toBe(1)
        expect(captured[0]?.workspaceId).toBe('adamic')
        expect(captured[0]?.projectNumber).toBeUndefined()
    })
})
