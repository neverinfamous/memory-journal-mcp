/**
 * Anti-Hallucination Guardrails & Fixes Tests
 */

import { describe, it, expect } from 'vitest'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { JournalApi } from '../../src/codemode/api/journal-api.js'
import type { ToolDefinition } from '../../src/types/index.js'

function createMockTool(name: string, group: string, handler?: (params: unknown) => unknown): ToolDefinition {
    return {
        name,
        title: name,
        description: `Test tool: ${name}`,
        group: group as ToolDefinition['group'],
        inputSchema: {} as ToolDefinition['inputSchema'],
        outputSchema: {} as ToolDefinition['outputSchema'],
        annotations: { readOnlyHint: true },
        handler: handler ?? ((params: unknown) => Promise.resolve({ success: true, params })),
    }
}

describe('Anti-Hallucination Fixes', () => {
    describe('Numeric String Parameter Coercion', () => {
        it('should coerce numeric string entry_id to number', () => {
            const res = applyArgInterceptions('get_entry_by_id', [{ entry_id: '123' }])
            expect('args' in res).toBe(true)
            if ('args' in res) {
                expect((res.args[0] as Record<string, unknown>).entry_id).toBe(123)
            }
        })

        it('should coerce numeric string link_entries IDs to numbers', () => {
            const res = applyArgInterceptions('link_entries', [{ from_entry_id: '1', to_entry_id: '2' }])
            expect('args' in res).toBe(true)
            if ('args' in res) {
                const obj = res.args[0] as Record<string, unknown>
                expect(obj.from_entry_id).toBe(1)
                expect(obj.to_entry_id).toBe(2)
            }
        })

        it('should coerce numeric string project_number to number', () => {
            const res = applyArgInterceptions('search_entries', [{ project_number: '42' }])
            expect('args' in res).toBe(true)
            if ('args' in res) {
                expect((res.args[0] as Record<string, unknown>).project_number).toBe(42)
            }
        })

        it('should auto-map get_statistics period and timeframe to group_by', () => {
            const res1 = applyArgInterceptions('get_statistics', [{ period: 'week' }])
            expect('args' in res1).toBe(true)
            if ('args' in res1) {
                expect((res1.args[0] as Record<string, unknown>).group_by).toBe('week')
                expect((res1.args[0] as Record<string, unknown>).period).toBeUndefined()
            }

            const res2 = applyArgInterceptions('get_statistics', [{ timeframe: 'day' }])
            expect('args' in res2).toBe(true)
            if ('args' in res2) {
                expect((res2.args[0] as Record<string, unknown>).group_by).toBe('day')
                expect((res2.args[0] as Record<string, unknown>).timeframe).toBeUndefined()
            }
        })
    })

    describe('Result Proxy Property Aliases', () => {
        it('should resolve res.data, res.items, res.rows to primary entries array', () => {
            const rawResult = { success: true, entries: [{ id: 1 }, { id: 2 }], count: 2 }
            const wrapped = wrapResult(rawResult) as Record<string, unknown> & { slice: (start?: number, end?: number) => unknown }

            expect(wrapped.data).toBe(rawResult.entries)
            expect(wrapped.items).toBe(rawResult.entries)
            expect(wrapped.rows).toBe(rawResult.entries)
            expect((wrapped.result as any).entries).toBe(rawResult.entries)
        })

        it('should allow calling array methods via result proxy when accessed via alias', () => {
            const rawResult = { success: true, entries: [{ id: 1 }, { id: 2 }], count: 2 }
            const wrapped = wrapResult(rawResult) as any

            expect(wrapped.data.slice(0, 1)).toEqual([{ id: 1 }])
            expect(wrapped.items.map((i: any) => i.id)).toEqual([1, 2])
        })
    })

    describe('readResource Transparent Delegation', () => {
        it('should delegate memory://briefing to getBriefing', async () => {
            const tools = [createMockTool('get_briefing', 'core', () => Promise.resolve({ success: true, briefing: 'Test Briefing' }))]
            const api = new JournalApi(tools)
            const bindings = api.createSandboxBindings() as { readResource: (uri: string) => Promise<unknown> }

            const res = await bindings.readResource('memory://briefing')
            expect(res).toEqual({ success: true, briefing: 'Test Briefing' })
        })

        it('should delegate memory://recent to getRecentEntries', async () => {
            const tools = [createMockTool('get_recent_entries', 'core', () => Promise.resolve({ success: true, entries: [] }))]
            const api = new JournalApi(tools)
            const bindings = api.createSandboxBindings() as { readResource: (uri: string) => Promise<unknown> }

            const res = await bindings.readResource('memory://recent')
            expect(res).toEqual({ success: true, entries: [] })
        })
    })

    describe('Markdown Payload Auto-Healing Detection', () => {
        it('should identify markdown bullet strings and entry creation objects', () => {
            const code1 = "- **Test execution for vector tools**: Performed usability and fuzzing"
            const isMarkdown1 = /^\s*([*#-]\s*\*?|\d+\.\s|[A-Z][a-z0-9_-]+:)/m.test(code1) && !/\b(const|let|var|function|return|await|mj\.|import|export)\b/.test(code1)
            expect(isMarkdown1).toBe(true)

            const code2 = "return await mj.searchEntries({ query: \"- **vector**\" })"
            const isMarkdown2 = /^\s*([*#-]\s*\*?|\d+\.\s|[A-Z][a-z0-9_-]+:)/m.test(code2) && !/\b(const|let|var|function|return|await|mj\.|import|export)\b/.test(code2)
            expect(isMarkdown2).toBe(false)
        })
    })

    describe('Project Aliases and Result Proxy Access', () => {
        it('should forward project object property access on result wrapper', () => {
            const rawResult = {
                success: true,
                project: {
                    name: 'mysql-mcp',
                    path: 'C:/Users/chris/Desktop/mysql-mcp',
                    project_number: 2,
                    id: 2,
                },
            }
            const wrapped = wrapResult(rawResult) as Record<string, unknown>

            expect(wrapped.project_number).toBe(2)
            expect(wrapped.name).toBe('mysql-mcp')
            expect(wrapped.path).toBe('C:/Users/chris/Desktop/mysql-mcp')
        })
    })

    describe('Failed Result Graceful Handling', () => {
        it('should return undefined for missing properties on failed result proxy without throwing', () => {
            const rawFailedResult = {
                success: false,
                error: 'Entry 6259 not found',
                code: 'ENTRY_NOT_FOUND',
                category: 'crud',
            }
            const wrapped = wrapResult(rawFailedResult) as Record<string, unknown>

            expect(wrapped.success).toBe(false)
            expect(wrapped.error).toBe('[ENTRY_NOT_FOUND] Entry 6259 not found')
            expect(wrapped.relationships).toEqual([])
            expect(wrapped.entries).toEqual([])
            expect(typeof wrapped.map).toBe('function')
            expect((wrapped.map as () => unknown[])()).toEqual([])
        })
    })
})
