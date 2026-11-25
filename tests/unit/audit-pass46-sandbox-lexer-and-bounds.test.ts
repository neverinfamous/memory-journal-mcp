/**
 * Pass 46 Adversarial Security Regression Suite — Part 1:
 * Code Mode Strict Prologue, Lexer/Escapes, Filter Escalation, Batch Wildcards,
 * Input Bounds, Error Caps, Healer/Converter Linearization & Shim Freezing
 * (H1–H3, M1–M3, M8–M9, L4).
 */

import * as vm from 'node:vm'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getCoreTools } from '../../src/handlers/tools/core/index.js'
import { getSearchTools } from '../../src/handlers/tools/search/index.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { validateSandboxCode, stripCommentsAndStrings } from '../../src/codemode/security.js'
import { hasUnbalancedClosingDelimiter } from '../../src/codemode/security-stripper-state.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { enforceNestedResultLimit } from '../../src/codemode/worker/nested-exec-runner.js'
import { safeFormatSandboxError } from '../../src/codemode/worker/script-and-metadata-cache.js'
import { serializeAndEnforceEgress } from '../../src/codemode/worker/result-compactor.js'
import { consoleShim, pathShim } from '../../src/codemode/worker/node-shims.js'
import { schemaHelpFn } from '../../src/codemode/worker/namespace-shims.js'
import { getSchemaHelp, listJournalTables } from '../../src/codemode/api/schema-help.js'
import { exceedsMaxToolInputElements } from '../../src/utils/tool-input-bounds.js'
import { isNaturalLanguagePrompt } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import {
    isValidJsScript,
    rewriteModuleImportsAndExports,
} from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { convertFile } from '../../src/markdown/converters/index.js'
import type { ProjectRegistryEntry, ToolContext, ToolDefinition } from '../../src/types/index.js'

const TEST_REGISTRY: Record<string, ProjectRegistryEntry> = {
    'proj-alpha': { path: '/repos/proj-alpha', project_number: 5 },
    'proj-beta': { path: '/repos/proj-beta', project_number: 9 },
}

function field(obj: unknown, key: string): unknown {
    return typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined
}

function buildTestTools(ctx: ToolContext): ToolDefinition[] {
    return [
        ...getCoreTools(ctx),
        ...getSearchTools(ctx),
        ...getAdminTools(ctx),
        ...getGitTools(ctx),
    ]
}

describe('Pass 46 Code Mode Strict Prologue, Lexer & Bounds Regressions', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let db: DatabaseAdapter

    beforeEach(async () => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('H1: enforces line-1 strict directive, blocks early IIFE breakout, and blocks with()', async () => {
        expect(validateSandboxCode('with (Math) { return PI }').valid).toBe(false)
        expect(
            hasUnbalancedClosingDelimiter(
                stripCommentsAndStrings('}); (async () => { return 1 })(')
            )
        ).toBe(true)
        expect(
            hasUnbalancedClosingDelimiter(stripCommentsAndStrings('const s = "})"; return s'))
        ).toBe(false)

        const runIsolatedNestedCode = vi.fn(() => Promise.resolve({ success: true }))
        const nestedExecutor = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: null },
            timeoutMs: 1000,
            maxResultSize: 1024,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode,
            activeTimers: new Set(),
        })
        const breakoutRes = await nestedExecutor({
            project_number: 5,
            code: '})()\n(async () => { return 1 })(',
        })
        expect(field(breakoutRes, 'success')).toBe(false)
        expect(runIsolatedNestedCode).not.toHaveBeenCalled()

        const vmCtx = vm.createContext({})
        const strictScript = new vm.Script(
            '"use strict";\n(async () => {\nreturn (function () { return this })()\n})()'
        )
        const thisVal: unknown = await (strictScript.runInContext(vmCtx) as Promise<unknown>)
        expect(thisVal).toBeUndefined()
    })

    it('H2: decodes arbitrary zero-padded ES2015 unicode escapes in identifiers and sensitive literals', () => {
        const zeroPaddedIdent = '\\u{0000000052}eflect.get({}, "a")'
        expect(stripCommentsAndStrings(zeroPaddedIdent)).toContain('Reflect.get')
        expect(validateSandboxCode(zeroPaddedIdent).valid).toBe(false)

        const zeroPaddedProcess = '\\u{0000000070}rocess.exit()'
        expect(validateSandboxCode(zeroPaddedProcess).valid).toBe(false)

        const zeroPaddedString = 'const fn = ({})["\\u{0000000063}onstructor"]; return fn'
        expect(stripCommentsAndStrings(zeroPaddedString)).toContain('"constructor"')
        expect(validateSandboxCode(zeroPaddedString).valid).toBe(false)
    })

    it('H3: aligns contextual of, method/class bodies, ASI newlines, case ternaries, and Annex B -->', () => {
        const payloads = [
            'if (of / 2) { eval("1") }',
            'for (let of = 1; of / 2; ) { eval("1") }',
            '({ m() { eval("1") } / eval("2") })',
            'class A extends (class B {}) { static { eval("1") } }',
            'lbl: for (;;) { break lbl\n/abc/; eval("1") }',
            'switch (x) { case a ? b : c: eval("1") }',
            '/* */ --> "harmless\neval("1")',
            '\u00A0--> "harmless\nprocess.exit()',
        ]
        for (const payload of payloads) {
            expect(validateSandboxCode(payload).valid).toBe(false)
        }
        expect(stripCommentsAndStrings('const r = 10 / 2; return r')).not.toContain('/ /')
        expect(stripCommentsAndStrings('let x\n/^[a-z]+$/.test("a")')).toContain('/ /')
    })

    it('M1/M2: blocks update_configuration via filter/pinning and enforces session projectId on wildcard batch moves', async () => {
        const foreignEntry = db.createEntry({
            content: 'Beta project entry',
            workspaceId: 'proj-beta',
            projectNumber: 9,
        })
        const ctx: ToolContext = {
            db,
            config: {
                runtime: new ServerRuntime(),
                projectRegistry: TEST_REGISTRY,
                codemodeEnabled: true,
                codemodeInternalFullAccess: false,
                filterConfig: parseToolFilter('starter,admin,update_configuration'),
            },
        }
        const tools = buildTestTools(ctx)
        const dispatch = createSecureDispatcher({
            tools,
            sessionContext: ctx,
            projectId: 5,
            workspaceId: 'proj-alpha',
            explicitWorkspace: true,
            autoVersion: false,
            dryRun: false,
        })

        const updateCfgRes = await dispatch('update_configuration', { tool_filter: 'full' })
        expect(field(updateCfgRes, 'success')).toBe(false)
        expect(field(updateCfgRes, 'code')).toBe('PERMISSION_DENIED')

        const wildcardBatchRes = await dispatch('batch_update_entries', {
            workspace_id: '*',
            updates: [{ entry_id: foreignEntry.id, target_workspace_id: 'proj-alpha' }],
        })
        expect(field(wildcardBatchRes, 'success')).toBe(false)

        const cmTool = getCodeModeTools(ctx).find((t) => t.name === 'mj_execute_code')
        expect(cmTool).toBeDefined()
        const cmRes = await cmTool?.handler(
            {
                code: 'const h = await mj.admin.help(); const res = await mj.admin.updateConfiguration({ tool_filter: "full" }).catch((e) => ({ error: e.message })); return { methods: h.methods, res }',
                workspace_id: 'proj-alpha',
                project_number: 5,
            },
            ctx
        )
        expect(field(cmRes, 'success')).toBe(true)
        const cmOut = field(cmRes, 'result')
        expect(field(cmOut, 'methods')).not.toContain('update_configuration')
        expect(field(field(cmOut, 'res'), 'success')).not.toBe(true)
        expect(ctx.config?.filterConfig?.raw).toBe('starter,admin,update_configuration')
    })

    it('M3: enforces internal-slot brand checks, clamps count against NaN poisoning, and traverses Array expandos', () => {
        const tagSpoof: Record<string, unknown> = {
            [Symbol.toStringTag]: 'String',
            entries: new Array<number>(20).fill(1),
        }
        expect(exceedsMaxToolInputElements(tagSpoof, 5)).toBe(true)

        const mapProtoSpoof: object = Object.create(Map.prototype) as object
        Reflect.set(mapProtoSpoof, 'nested', new Array<number>(20).fill(1))
        expect(exceedsMaxToolInputElements(mapProtoSpoof, 5)).toBe(true)

        const arrWithExpando = [] as unknown[] & { extra?: number[] }
        arrWithExpando.extra = new Array<number>(20).fill(1)
        expect(exceedsMaxToolInputElements(arrWithExpando, 5)).toBe(true)
    })

    it('M8/M9/L4: safely formats null-prototype rejections, bounds errors/healers/converters, and freezes shims', () => {
        const nullErr = Object.create(null) as Record<string, unknown>
        nullErr['reason'] = 'boom'
        const formatted = safeFormatSandboxError(nullErr)
        expect(typeof formatted.message).toBe('string')
        expect(formatted.message.length).toBeGreaterThan(0)

        const hugeErr = {
            success: false,
            error: 'e'.repeat(20_000),
            stack: 's'.repeat(20_000),
            metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
        }
        serializeAndEnforceEgress(hugeErr)
        expect((hugeErr.error ?? '').length).toBeLessThan(17_000)
        expect((hugeErr.stack ?? '').length).toBeLessThan(17_000)

        const newlineBomb = '\n'.repeat(15_000) + 'status'
        const t0 = performance.now()
        expect(typeof isNaturalLanguagePrompt(newlineBomb)).toBe('boolean')
        expect(typeof rewriteModuleImportsAndExports(newlineBomb)).toBe('string')
        expect(extractAndRecoverPreparedStatementCode(newlineBomb)).toBeNull()
        expect(extractAndRecoverEntryCode('{\n' + ' '.repeat(35_000))).toBeNull()
        expect(performance.now() - t0).toBeLessThan(200)

        expect(isValidJsScript('with (obj) { return 1 }')).toBe(false)
        expect(() => convertFile('x'.repeat(530_000), 'huge.md', 'obsidian')).toThrow(/524288/)

        expect(Object.isFrozen(consoleShim.log)).toBe(true)
        expect(Object.isFrozen(pathShim.join)).toBe(true)
        expect(Object.isFrozen(schemaHelpFn)).toBe(true)
        expect(Object.isFrozen(getSchemaHelp)).toBe(true)
        expect(Object.isFrozen(listJournalTables)).toBe(true)

        expect(() => enforceNestedResultLimit('a'.repeat(150 * 1024), undefined)).toThrow()
    })
})
