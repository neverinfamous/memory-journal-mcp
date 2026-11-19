/**
 * Pass 45 Adversarial Security Regression Suite — Part 1:
 * Code Mode Sandbox, Lexical Scanner, Prototype Hardening, Input Bounds & RPC Scope (H1–H3, M6–M8, L4).
 */

import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { z } from 'zod'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import { stripCommentsAndStrings } from '../../src/codemode/security.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import {
    healCodeModeScript,
    healTemplateBackticksOnRuntimeError,
} from '../../src/handlers/tools/codemode/code-healer.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { checkSchemaAcceptsKey } from '../../src/handlers/tools/codemode/dispatch-schema-introspection.js'
import {
    estimateSerializedByteBounds,
    validateRawPayloadSize,
} from '../../src/handlers/tools/codemode/payload-byte-bounds.js'
import {
    exceedsMaxToolInputElements,
    resolveEffectiveMaxToolInputElements,
} from '../../src/utils/tool-input-bounds.js'
import { validateRpcOverrideBounds } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import { runWithRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { resolveOwner } from '../../src/handlers/tools/github/helpers.js'
import type { ToolDefinition } from '../../src/types/index.js'

const REGISTRY = {
    'memory-journal-mcp': { path: path.resolve('/repos/memory-journal-mcp'), project_number: 5 },
    'other-repo': { path: path.resolve('/repos/other-repo'), project_number: 9 },
}

describe('Pass 45 Code Mode Sandbox, Lexer & Bounds Regressions', () => {
    it('H1/M8: enforces strict mode against sloppy octal escapes and settles macrotasks in WorkerSandbox', async () => {
        const sandbox = new WorkerSandbox()
        try {
            const octalRes = await sandbox.execute(
                'return "\\01"',
                {},
                undefined,
                5000,
                {},
                false
            )
            expect(octalRes.success).toBe(false)

            const settledRes = await sandbox.execute(
                'let v = 1; await new Promise((r) => setTimeout(() => { v = 42; r(null) }, 5)); return v',
                {},
                undefined,
                5000,
                {},
                false
            )
            expect(settledRes.success).toBe(true)
            expect(settledRes.result).toBe(42)
        } finally {
            sandbox.dispose()
        }
    }, 15000)

    it('M8: decodes LineContinuation & handles for-of, dotted class extends, and labeled blocks in stripper/auto-return', () => {
        const lineCont = stripCommentsAndStrings('const s = "\\\neval(1)"; return 1')
        expect(lineCont).not.toContain('eval')

        const forOfRegex = stripCommentsAndStrings('for (const x of /abc/g.exec("abc") ?? []) {}')
        expect(forOfRegex).not.toContain('abc')

        const classDotted = stripCommentsAndStrings('class C extends a.b {}; const r = /secret/g')
        expect(classDotted).not.toContain('secret')

        const labeled = stripCommentsAndStrings('lbl: /hidden/g; const x = 1')
        expect(labeled).not.toContain('hidden')

        const autoReturned = transformAutoReturn('for (const k of /test/g.source) {}\n42')
        expect(autoReturned).toContain('return 42')

        const healed = healTemplateBackticksOnRuntimeError('const a = `hello `world``; return a')
        expect(healed === null || healed.includes('hello')).toBe(true)
    })

    it('H2: runs code-healer and json-entry-recovery lookaheads in linear time on adversarial inputs', () => {
        const longQuoted = `'${' '.repeat(20_000)}`
        const start = performance.now()
        const healed = healCodeModeScript(longQuoted)
        const recovered = extractAndRecoverEntryCode(`content: ${' '.repeat(20_000)}\n`)
        const elapsedMs = performance.now() - start
        expect(typeof healed).toBe('string')
        expect(recovered).toBeNull()
        expect(elapsedMs).toBeLessThan(500)
    })

    it('H3: rejects Object.prototype keys via Object.hasOwn and keeps SCHEMA_KEY_CACHE bounded positive-only', () => {
        const schema = z.object({ query: z.string(), limit: z.number().optional() })
        expect(checkSchemaAcceptsKey(schema, 'query')).toBe(true)
        expect(checkSchemaAcceptsKey(schema, 'toString')).toBe(false)
        expect(checkSchemaAcceptsKey(schema, 'constructor')).toBe(false)
        expect(checkSchemaAcceptsKey(schema, '__proto__')).toBe(false)
        for (let i = 0; i < 600; i++) {
            expect(checkSchemaAcceptsKey(schema, `missing_${String(i)}`)).toBe(false)
        }
        expect(checkSchemaAcceptsKey(schema, 'limit')).toBe(true)
    })

    it('M7: handles NaN/negative maxToolInputElements fallback, O(1) boxed String, and depth > 64 rejection without JSON.stringify', () => {
        expect(resolveEffectiveMaxToolInputElements(Number.NaN)).toBe(25_000)
        expect(resolveEffectiveMaxToolInputElements(-5)).toBe(25_000)
        expect(resolveEffectiveMaxToolInputElements(0)).toBe(Infinity)

        const boxed = Object('x'.repeat(5000))
        expect(exceedsMaxToolInputElements(boxed, 100)).toBe(true)

        let deep: Record<string, unknown> = { leaf: 1 }
        for (let i = 0; i < 70; i++) deep = { child: deep }
        const bounds = estimateSerializedByteBounds(deep, 1024 * 1024, new Set())
        expect(bounds.overDepth).toBe(true)

        const err = validateRawPayloadSize({ code: 'return 1', context: deep }, 50_000, 25_000)
        expect(err).toContain('maximum nesting depth')
    })

    it('M6: enforces nested RPC bounds for update_configuration, *_project, IO dirs, owner/repo aliases, and GitHub owner conflicts', async () => {
        const makeTool = (name: string): ToolDefinition => ({
            name,
            title: name,
            description: name,
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
            handler: () => Promise.resolve({}),
        })
        const overrides = { workspaceId: 'memory-journal-mcp', projectNumber: 5 }

        expect(
            validateRpcOverrideBounds(makeTool('update_configuration'), {}, overrides, REGISTRY)
        ).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })

        expect(
            validateRpcOverrideBounds(
                makeTool('delete_project'),
                { name: 'other-repo' },
                overrides,
                REGISTRY
            )
        ).toMatchObject({ success: false })

        expect(
            validateRpcOverrideBounds(
                makeTool('export_markdown'),
                { output_dir: '/repos/other-repo/out' },
                overrides,
                REGISTRY
            )
        ).toMatchObject({ success: false })

        expect(
            validateNestedExecScope(
                { owner: 'someone-else', repo: 'other-repo' },
                'memory-journal-mcp',
                5,
                REGISTRY
            )
        ).toMatchObject({ error: expect.any(String) as unknown })

        const ownerConflict = await runWithRpcExecutionOverrides(overrides, () =>
            resolveOwner(
                {
                    db: {} as never,
                    github: {
                        isApiAvailable: () => true,
                        getCachedRepoInfo: () => ({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
                        getRepoInfo: () => Promise.resolve({ owner: 'neverinfamous', repo: 'memory-journal-mcp', branch: 'main', remoteUrl: null }),
                    } as never,
                    config: {
                        projectRegistry: { 'memory-journal-mcp': { project_number: 5 } },
                    },
                },
                'attacker-org',
                undefined,
                'issue',
                5,
                'memory-journal-mcp'
            )
        )
        expect('error' in ownerConflict && ownerConflict.error).toBe(true)
    })
})
