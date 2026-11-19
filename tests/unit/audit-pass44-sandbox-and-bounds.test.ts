import * as vm from 'node:vm'
import { describe, it, expect } from 'vitest'
import {
    freezeInnerVmContext,
    OPTIONAL_RUNTIME_GLOBALS,
} from '../../src/codemode/worker/prototype-hardening.js'
import {
    DEFAULT_MAX_TOOL_INPUT_ELEMENTS,
    exceedsMaxToolInputElements,
} from '../../src/utils/tool-input-bounds.js'
import { deepCamelToSnake } from '../../src/handlers/tools/codemode/dispatch-key-normalizer.js'
import { stripCommentsAndStrings } from '../../src/codemode/security-stripper.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { healTemplateBackticksOnRuntimeError } from '../../src/handlers/tools/codemode/code-healer.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import {
    resolveEffectiveRpcScope,
    validateRpcOverrideBounds,
} from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { requestContextStorage } from '../../src/utils/request-context.js'
import { getCallerIdentity } from '../../src/handlers/tools/team/rbac.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Pass 44 Audit — Sandbox, Bounds, Lexer, ReDoS & Code Mode Scope Narrowing', () => {
    it('H1 & L1: freezes concrete iterator/helper prototypes, deletes __proto__, blocks Float16Array, and passes env: {} to Worker', async () => {
        expect(OPTIONAL_RUNTIME_GLOBALS).toContain('Float16Array')
        const ctx = vm.createContext({})
        freezeInnerVmContext(ctx)
        const probe = vm.runInContext(
            `({
                hasProtoAccessor: Object.getOwnPropertyDescriptor(Object.prototype, '__proto__') !== undefined,
                arrayIterFrozen: Object.isFrozen(Object.getPrototypeOf([][Symbol.iterator]())),
                stringIterFrozen: Object.isFrozen(Object.getPrototypeOf(''[Symbol.iterator]())),
                mapIterFrozen: Object.isFrozen(Object.getPrototypeOf(new Map()[Symbol.iterator]())),
                setIterFrozen: Object.isFrozen(Object.getPrototypeOf(new Set()[Symbol.iterator]())),
                regexIterFrozen: Object.isFrozen(Object.getPrototypeOf(/a/[Symbol.matchAll](''))),
                helperFrozen: typeof Iterator !== 'undefined' ? Object.isFrozen(Object.getPrototypeOf(Iterator.from([]).map(x => x))) : true
            })`,
            ctx
        ) as Record<string, boolean>
        expect(probe['hasProtoAccessor']).toBe(false)
        expect(probe['arrayIterFrozen']).toBe(true)
        expect(probe['stringIterFrozen']).toBe(true)
        expect(probe['mapIterFrozen']).toBe(true)
        expect(probe['setIterFrozen']).toBe(true)
        expect(probe['regexIterFrozen']).toBe(true)
        expect(probe['helperFrozen']).toBe(true)

        const fs = await import('node:fs')
        const sandboxSrc = fs.readFileSync('src/codemode/worker-sandbox.ts', 'utf-8')
        expect(sandboxSrc).toContain('env: {}')
    })

    it('H2: rejects shared-reference DAG amplification, large TypedArrays/Maps/Sets, and memoizes deepCamelToSnake', () => {
        // 15-level binary DAG: 31 unique array instances, 2^15 = 32,768 expanded elements
        let dag: unknown = ['leaf']
        for (let i = 0; i < 15; i++) {
            dag = [dag, dag]
        }
        expect(exceedsMaxToolInputElements(dag, DEFAULT_MAX_TOOL_INPUT_ELEMENTS)).toBe(true)

        // Direct cycle still terminates safely without false rejection
        const cycle: unknown[] = []
        cycle.push(cycle)
        expect(exceedsMaxToolInputElements(cycle, 100)).toBe(false)

        // TypedArray / ArrayBuffer / Map / Set O(1) element checks
        const bigBytes = new Uint8Array(DEFAULT_MAX_TOOL_INPUT_ELEMENTS + 1)
        expect(exceedsMaxToolInputElements(bigBytes, DEFAULT_MAX_TOOL_INPUT_ELEMENTS)).toBe(true)
        expect(
            exceedsMaxToolInputElements(bigBytes.buffer, DEFAULT_MAX_TOOL_INPUT_ELEMENTS)
        ).toBe(true)

        const bigSet = new Set<number>()
        for (let i = 0; i <= 105; i++) bigSet.add(i)
        expect(exceedsMaxToolInputElements(bigSet, 100)).toBe(true)

        // deepCamelToSnake memoizes shared inner objects on DAGs in linear time
        let sharedObj: Record<string, unknown> = { projectNumber: 5, workspaceId: 'test' }
        for (let i = 0; i < 20; i++) {
            sharedObj = { leftChild: sharedObj, rightChild: sharedObj }
        }
        deepCamelToSnake({ warmUpKey: 1 }, 0)
        const t0 = performance.now()
        const normalized = deepCamelToSnake(sharedObj, 0) as Record<string, unknown>
        expect(performance.now() - t0).toBeLessThan(500)
        expect(normalized['left_child']).toBe(normalized['right_child'])
    })

    it('M6: aligns regex-vs-division lexer on =>, catch/switch headers, function/class expressions, and . / ?. properties', () => {
        // 1. Arrow function returning regex literal
        const arrowSrc = 'const fn = () => /"/; const s = "process.exit(1)"; return 1;'
        expect(stripCommentsAndStrings(arrowSrc)).not.toContain('process.exit')

        // 2. catch (e) { /regex/ } followed by string
        const catchSrc = 'try {} catch (e) { /"/ } const s = "process.exit(1)"; return 1;'
        expect(stripCommentsAndStrings(catchSrc)).not.toContain('process.exit')

        // 3. Function expression divided by number vs function declaration followed by regex
        const fnExprDiv = 'const x = (function() { return 1 }) / 2 + /"/.test("a"); const s = "safe";'
        expect(stripCommentsAndStrings(fnExprDiv)).not.toContain('safe')
        const fnDeclRegex = 'function f() { return 1 } /"/; const s = "process.exit(1)";'
        expect(stripCommentsAndStrings(fnDeclRegex)).not.toContain('process.exit')

        // 4. Member property `.return` or `?.return` followed by division
        const propDiv = 'const x = obj.return / 2 + /"/.test("a"); const s = "process.exit(1)";'
        expect(stripCommentsAndStrings(propDiv)).not.toContain('process.exit')
        const optChainPropDiv =
            'const x = obj?.return / 2 + /"/.test("a"); const s = "process.exit(1)";'
        expect(stripCommentsAndStrings(optChainPropDiv)).not.toContain('process.exit')

        // 5. Auto-return handles optional chaining cleanly
        const autoReturned = transformAutoReturn('const a = 1; obj?.value')
        expect(autoReturned).toContain('return obj?.value')
    })

    it('M7: linear prepared-statement recovery & short-circuited delimiter healing resist ReDoS inputs', () => {
        const validRecovered = extractAndRecoverPreparedStatementCode(
            'const stmt = db.prepare("SELECT * FROM memory_journal WHERE id = ?"); return stmt.all(42);'
        )
        expect(validRecovered).toContain('mj.core.getEntryById(')
        expect(validRecovered).toContain('42')

        // Adversarial repeated `.prepare(` with unclosed strings completes in < 500ms
        const adversarialPrep =
            'db.prepare("' + 'a'.repeat(5000) + '\n' + 'stmt.all('.repeat(500)
        const t0 = performance.now()
        expect(extractAndRecoverPreparedStatementCode(adversarialPrep)).toBeNull()
        expect(performance.now() - t0).toBeLessThan(500)

        // Valid script with many string literals short-circuits applyTemplateAndQuoteDelimiterHealing
        healTemplateBackticksOnRuntimeError('return 1;')
        const manyStrings =
            Array.from({ length: 40 }, (_, i) => `const s${String(i)} = "line ${String(i)}";`).join(
                '\n'
            ) + '\nreturn s0;'
        const t1 = performance.now()
        expect(healTemplateBackticksOnRuntimeError(manyStrings)).toBeNull()
        expect(performance.now() - t1).toBeLessThan(500)
    })

    it('M11 & L2: resolveEffectiveRpcScope & validateRpcOverrideBounds pin rpcOverrides.projectNumber and block unregistered scope escapes', () => {
        const registry = {
            'repo-a': { path: '/tmp/repo-a', project_number: 5 },
            'repo-b': { path: '/tmp/repo-b', project_number: 9 },
        }
        // When outer projectId is undefined, rpcOverrides.projectNumber (5) pins effectiveProjectId to 5
        const scoped = resolveEffectiveRpcScope(
            { workspaceId: undefined, projectId: undefined },
            { projectNumber: 5 },
            registry
        )
        expect('effectiveProjectId' in scoped && scoped.effectiveProjectId).toBe(5)
        expect('effectiveWorkspaceId' in scoped && scoped.effectiveWorkspaceId).toBe('repo-a')

        // Mismatched outer workspace ('repo-b') + rpcOverrides.projectNumber (5) is rejected
        const mismatched = resolveEffectiveRpcScope(
            { workspaceId: 'repo-b', projectId: undefined },
            { projectNumber: 5 },
            registry
        )
        expect('errorResult' in mismatched).toBe(true)

        // validateRpcOverrideBounds returns error response when inner project_number conflicts with rpcOverrides.projectNumber
        const conflictErr = validateRpcOverrideBounds(
            { name: 'search_entries' } as never,
            { project_number: 9 },
            { projectNumber: 5, workspaceId: 'repo-a' },
            registry
        )
        expect(conflictErr?.['success']).toBe(false)

        // L2: When registry is undefined and project is pinned, inner cwd and workspace_id are rejected
        const cwdErr = validateRpcOverrideBounds(
            { name: 'get_git_commits' } as never,
            { cwd: '/etc' },
            { projectNumber: 5 },
            undefined
        )
        expect(cwdErr?.['success']).toBe(false)
        const wsErr = validateRpcOverrideBounds(
            { name: 'search_entries' } as never,
            { workspace_id: 'other-ws' },
            { projectNumber: 5 },
            undefined
        )
        expect(wsErr?.['success']).toBe(false)
    })

    it('M12: normalizes and validates inside runInAdjustedRequestContext and enforces rpcPinnedProject on wildcard calls', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const fakeTool = {
                name: 'search_entries',
                inputSchema: {
                    shape: {
                        workspace_id: {},
                        project_number: {},
                        query: {},
                    },
                },
                annotations: { readOnlyHint: true },
                handler: () => ({ success: true, entries: [] }),
            } as never

            // 1. rpcPinnedProject prevents workspace_id: '*' from dropping an RPC-pinned projectId
            const unpinnedWildcard = await normalizeDispatchParams(
                fakeTool,
                { workspace_id: '*' },
                {
                    workspaceId: 'repo-a',
                    projectId: 5,
                    rpcPinnedProject: false,
                    sessionContext: { db },
                }
            )
            expect(
                'params' in unpinnedWildcard &&
                    (unpinnedWildcard.params as Record<string, unknown>)['project_number']
            ).toBeUndefined()

            const pinnedWildcard = await normalizeDispatchParams(
                fakeTool,
                { workspace_id: '*' },
                {
                    workspaceId: 'repo-a',
                    projectId: 5,
                    rpcPinnedProject: true,
                    sessionContext: { db },
                }
            )
            expect(
                'params' in pinnedWildcard &&
                    (pinnedWildcard.params as Record<string, unknown>)['project_number']
            ).toBe(5)

            // 2. Request context sessionId is active inside tool handler via runInAdjustedRequestContext
            let observedSessionInHandler: string | undefined
            const contextProbeTool = {
                name: 'search_entries',
                inputSchema: {
                    shape: {
                        workspace_id: {},
                        project_number: {},
                        query: {},
                    },
                },
                annotations: { readOnlyHint: true },
                handler: () => {
                    const store = requestContextStorage.getStore()
                    observedSessionInHandler = store?.sessionId
                    return { success: true, entries: [] }
                },
            } as never
            const dispatch = createSecureDispatcher({
                tools: [contextProbeTool],
                workspaceId: 'repo-a',
                projectId: 5,
                sessionId: 'sess-m12',
                autoVersion: true,
                dryRun: false,
                sessionContext: {
                    db,
                    config: {
                        defaultProjectNumber: 5,
                        projectRegistry: {
                            'repo-a': { path: process.cwd(), project_number: 5 },
                        },
                    },
                },
            })
            const res = (await dispatch('search_entries', { query: 'test' })) as Record<
                string,
                unknown
            >
            expect(res['success']).not.toBe(false)
            expect(observedSessionInHandler).toBe('sess-m12')
            expect(typeof getCallerIdentity()).toBe('string')
        } finally {
            db.close()
        }
    })
})
