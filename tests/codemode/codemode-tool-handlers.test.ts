/**
 * Code Mode Tool Handler Tests
 *
 * Tests for the mj_execute_code tool handler focusing on:
 * - Tool definition structure (name, schema, annotations)
 * - Security validation rejection (blocked patterns, empty code)
 * - Schema validation (missing params)
 *
 * Note: Actual sandbox code execution is tested via Playwright E2E tests.
 * In the vitest unit test environment, worker_threads can't resolve the
 * compiled worker-script.js (vitest runs TypeScript source directly), and
 * the VM sandbox has async Promise interop issues with vitest's module system.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import { SqliteAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('mj_execute_code Tool Handler', () => {
    let db: SqliteAdapter
    const testDbPath = './test-codemode-handler.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    // =========================================================================
    // Tool Definition
    // =========================================================================

    describe('tool definition', () => {
        it('should be included in tool listing', () => {
            const tools = getTools(db, null)
            const names = tools.map((t) => (t as { name: string }).name)
            expect(names).toContain('mj_execute_code')
        })

        it('should have inputSchema (no outputSchema — uses text response path)', () => {
            const tools = getTools(db, null)
            const codeTool = tools.find(
                (t) => (t as { name: string }).name === 'mj_execute_code',
            ) as { inputSchema: object; outputSchema?: object } | undefined
            expect(codeTool?.inputSchema).toBeDefined()
            expect(codeTool?.outputSchema).toBeUndefined()
        })

        it('should have correct description mentioning sandbox and API', () => {
            const tools = getTools(db, null)
            const codeTool = tools.find(
                (t) => (t as { name: string }).name === 'mj_execute_code',
            ) as { description: string } | undefined
            expect(codeTool?.description).toContain('sandbox')
            expect(codeTool?.description).toContain('mj.*')
        })

        it('should have annotations with readOnlyHint=false', () => {
            const tools = getTools(db, null)
            const codeTool = tools.find(
                (t) => (t as { name: string }).name === 'mj_execute_code',
            ) as { annotations?: { readOnlyHint?: boolean } } | undefined
            expect(codeTool?.annotations?.readOnlyHint).toBe(false)
        })

        it('should total 44 tools across all groups', () => {
            const tools = getTools(db, null)
            expect(tools.length).toBe(44)
        })
    })

    // =========================================================================
    // Security Validation (pre-sandbox, synchronous path)
    // =========================================================================

    describe('security validation', () => {
        it('should reject code with require()', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'const fs = require("fs")' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with process access', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'process.exit(1)' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with dynamic import', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'await import("os")' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with eval()', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'eval("alert(1)")' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with Function constructor', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'new Function ("return 1")' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with __proto__ access', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'const x = {}.__proto__' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with child_process', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'child_process.exec("whoami")' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })

        it('should reject code with fs access', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: 'fs.readFileSync("/etc/passwd")' },
                db,
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Security validation failed')
        })
    })

    // =========================================================================
    // Schema Validation (pre-sandbox, Zod parse path)
    // =========================================================================

    describe('schema validation', () => {
        it('should reject missing code parameter', async () => {
            const result = (await callTool(
                'mj_execute_code',
                {},
                db,
            )) as { success: boolean; error?: string }

            expect(result.success).toBe(false)
        })

        it('should reject empty string code', async () => {
            const result = (await callTool(
                'mj_execute_code',
                { code: '' },
                db,
            )) as { success: boolean; error?: string }

            expect(result.success).toBe(false)
        })
    })
})
