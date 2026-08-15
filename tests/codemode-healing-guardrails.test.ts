import { describe, it, expect } from 'vitest'
import { wrapResult } from '../src/codemode/worker-result-proxy.js'
import { ExecuteCodeSchema } from '../src/handlers/tools/codemode/schemas.ts'
import { databaseOptionsSchema, networkOptionsSchema } from '../src/cli/schemas.js'
import { getDummyHealingTools } from '../src/handlers/tools/core/dummy-healing.js'

describe('Code Mode Anti-Hallucination & Healing Guardrails', () => {
    describe('Layer 3: Worker Result Proxy Failed Result Safety', () => {
        it('should safely return empty arrays and 0 length on failed result object without throwing', () => {
            const failedResult = wrapResult({
                success: false,
                error: 'Entry 9999 not found',
                code: 'NOT_FOUND',
            }) as Record<string, unknown>

            expect(failedResult['success']).toBe(false)
            expect(failedResult['relationships']).toEqual([])
            expect(failedResult['entries']).toEqual([])
            expect(failedResult['projects']).toEqual([])
            expect(failedResult['length']).toBe(0)
            expect(typeof failedResult['map']).toBe('function')
            expect((failedResult['map'] as (fn: (x: unknown) => unknown) => unknown[])(() => 1)).toEqual([])
        })
    })

    describe('Layer 1: ExecuteCodeSchema Parameter Preservation', () => {
        it('should preserve entry and instructions fields when passed to ExecuteCodeSchema', () => {
            const parsed = ExecuteCodeSchema.parse({
                entry: { title: 'Test Entry', content: 'Testing auto-healing' },
                instructions: 'Write a journal entry',
            })

            expect(parsed['entry']).toBeDefined()
            expect(parsed['instructions']).toBe('Write a journal entry')
        })
    })

    describe('Layer 2: Empty Payload Auto-Healing Interceptor', () => {
        it('should parse empty objects with default values', () => {
            const parsed = ExecuteCodeSchema.parse({})
            expect(parsed['auto_version']).toBe(true)
            expect(parsed['dry_run']).toBe(false)
            expect(parsed['code']).toBeUndefined()
        })
    })

    describe('Layer 4: CLI Option Aliases & Schema Guardrails', () => {
        it('should allow --database and --team-database in databaseOptionsSchema', () => {
            const parsedDb = databaseOptionsSchema.parse({ database: './custom.db', teamDatabase: './team.db' })
            expect(parsedDb.database).toBe('./custom.db')
            expect(parsedDb.teamDatabase).toBe('./team.db')

            const parsedNet = networkOptionsSchema.parse({ http: true, stdio: false })
            expect(parsedNet.http).toBe(true)
            expect(parsedNet.stdio).toBe(false)
        })
    })

    describe('Layer 5: Dummy Tool Protocol Resource & Prompt Healing', () => {
        const tools = getDummyHealingTools()

        it('should have read_resource and mj_read_resource handlers in dummy healing tools', async () => {
            const readResourceTool = tools.find(t => t.name === 'read_resource')
            const mjReadResourceTool = tools.find(t => t.name === 'mj_read_resource')

            expect(readResourceTool).toBeDefined()
            expect(mjReadResourceTool).toBeDefined()

            const res = await readResourceTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })

        it('should have load-briefing and mj_session_summary dummy prompt handlers', async () => {
            const loadBriefingTool = tools.find(t => t.name === 'load-briefing')
            const sessionSummaryTool = tools.find(t => t.name === 'session-summary')

            expect(loadBriefingTool).toBeDefined()
            expect(sessionSummaryTool).toBeDefined()

            const res = await loadBriefingTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })

        it('should provide autonomous healing handlers for dotted code mode functions', async () => {
            const dottedTool = tools.find(t => t.name === 'mj.core.createEntry')

            expect(dottedTool).toBeDefined()
            const res = await dottedTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })
    })
})
