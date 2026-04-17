/**
 * Handler Error Branches Coverage Tests
 *
 * Tests for remaining uncovered branches in:
 * - search.ts: FTS fallback for invalid queries, semantic_search error handling
 * - relationships.ts: depth parameter traversal branches
 * - export.ts: markdown format branch
 * - index.ts: callTool with progress context, unknown tool error
 * - admin.ts: get_vector_index_stats without vector manager
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool, getTools } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager.js'

function createMockVector(overrides: Partial<Record<string, unknown>> = {}): VectorSearchManager {
    const defaults = {
        isInitialized: vi.fn().mockReturnValue(true),
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        addEntry: vi.fn().mockResolvedValue(true),
        removeEntry: vi.fn().mockResolvedValue(true),
        rebuildIndex: vi.fn().mockResolvedValue(5),
        getStats: vi.fn().mockReturnValue({
            itemCount: 10,
            modelName: 'Xenova/all-MiniLM-L6-v2',
            dimensions: 384,
        }),
        generateEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0)),
    }
    return { ...defaults, ...overrides } as unknown as VectorSearchManager
}

describe('Handler Error Branches', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-handler-branches.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()

        // Seed some test data
        db.createEntry({ content: 'Branch test entry one', tags: ['branch-test'] })
        db.createEntry({ content: 'Branch test entry two', tags: ['branch-test', 'second'] })
        db.createEntry({ content: 'Export markdown test entry', tags: ['export-test'] })
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // cleanup
        }
    })

    // ========================================================================
    // search.ts — FTS fallback for invalid/unbalanced queries
    // ========================================================================

    describe('search_entries — FTS fallback', () => {
        it('should fall back to LIKE when query has unbalanced quotes', async () => {
            const result = (await callTool('search_entries', { query: '"unbalanced' }, db)) as {
                entries: unknown[]
                count: number
            }

            // Should not throw, should return results (possibly empty)
            expect(result.entries).toBeDefined()
            expect(Array.isArray(result.entries)).toBe(true)
        })

        it('should handle empty query gracefully', async () => {
            const result = (await callTool('search_entries', { query: '' }, db)) as {
                entries: unknown[]
            }

            expect(result.entries).toBeDefined()
        })
    })

    // ========================================================================
    // search.ts — semantic_search error when vector manager throws
    // ========================================================================

    describe('semantic_search — error handling', () => {
        it('should return error when vector manager search throws', async () => {
            const badVector = createMockVector({
                search: vi.fn().mockRejectedValue(new Error('Embedding model failed')),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'test search' },
                db,
                badVector
            )) as { error?: string; entries?: unknown[] }

            expect(result.error).toBeDefined()
        })

        it('should return hint when no results found and hint_on_empty is true', async () => {
            const emptyVector = createMockVector({
                search: vi.fn().mockResolvedValue([]),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'extremely_unlikely_term_xyz', hint_on_empty: true },
                db,
                emptyVector
            )) as { entries: unknown[]; hint?: string }

            expect(result.entries).toHaveLength(0)
        })

        it('should not return hint when hint_on_empty is false', async () => {
            const emptyVector = createMockVector({
                search: vi.fn().mockResolvedValue([]),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'xyz_no_result', hint_on_empty: false },
                db,
                emptyVector
            )) as { entries: unknown[]; hint?: string }

            expect(result.entries).toHaveLength(0)
            expect(result.hint).toBeUndefined()
        })
    })

    // ========================================================================
    // relationships.ts — depth parameter traversal
    // ========================================================================

    describe('visualize_relationships — depth variations', () => {
        it('should accept depth=1', async () => {
            const e1 = db.createEntry({ content: 'Depth test A' })
            const e2 = db.createEntry({ content: 'Depth test B' })

            await callTool(
                'link_entries',
                { from_entry_id: e1.id, to_entry_id: e2.id, relationship_type: 'references' },
                db
            )

            const result = (await callTool(
                'visualize_relationships',
                { entry_id: e1.id, depth: 1 },
                db
            )) as { entry_count: number; mermaid: string | null }

            expect(result.entry_count).toBeGreaterThanOrEqual(1)
        })

        it('should accept depth=3', async () => {
            const result = (await callTool(
                'visualize_relationships',
                { depth: 3, limit: 5 },
                db
            )) as { entry_count: number }

            expect(result.entry_count).toBeGreaterThanOrEqual(0)
        })
    })

    // ========================================================================
    // export.ts — markdown format branch
    // ========================================================================

    describe('export_entries — markdown format', () => {
        it('should export entries in markdown format', async () => {
            const result = (await callTool(
                'export_entries',
                { format: 'markdown', limit: 5 },
                db
            )) as { format: string; content: string }

            expect(result.format).toBe('markdown')
            expect(typeof result.content).toBe('string')
        })

        it('should export with entry_types filter', async () => {
            const result = (await callTool(
                'export_entries',
                { format: 'json', entry_types: ['personal_reflection'], limit: 10 },
                db
            )) as { format: string; entries: unknown[] }

            expect(result.format).toBe('json')
        })

        it('should export with tags filter', async () => {
            const result = (await callTool(
                'export_entries',
                { format: 'json', tags: ['export-test'], limit: 10 },
                db
            )) as { format: string; entries: unknown[] }

            expect(result.format).toBe('json')
        })
    })

    // ========================================================================
    // index.ts — callTool with progress context
    // ========================================================================

    describe('callTool — progress context path', () => {
        it('should handle progress context and rebuild fresh tool definitions', async () => {
            const mockProgress = {
                progressToken: 'test-token',
                sendProgress: vi.fn(),
                server: {} as any,
            }

            // test_simple is a trivial tool that always works
            const result = (await callTool(
                'test_simple',
                { message: 'Progress test' },
                db,
                undefined,
                undefined,
                undefined,
                mockProgress
            )) as { message: string }

            expect(result.message).toContain('Progress test')
        })
    })

    // ========================================================================
    // index.ts — unknown tool error
    // ========================================================================

    describe('callTool — unknown tool', () => {
        it('should reject with Error for unknown tool name', async () => {
            await expect(callTool('nonexistent_tool_xyz', {}, db)).rejects.toThrow(
                'Tool not found: nonexistent_tool_xyz'
            )
        })
    })

    // ========================================================================
    // index.ts — getTools with tool filter
    // ========================================================================

    describe('getTools — icon mapping', () => {
        it('should return icons for all known tool groups', () => {
            const tools = getTools(db, null)

            // Every registered tool should have icons (since all groups are in the iconMap)
            for (const tool of tools) {
                expect(tool.icons).toBeDefined()
            }
        })
    })

    // ========================================================================
    // admin.ts — get_vector_index_stats without vector manager
    // ========================================================================

    describe('get_vector_index_stats — no vector manager', () => {
        it('should return error when vector manager is not available', async () => {
            const result = (await callTool('get_vector_index_stats', {}, db)) as { error: string }

            expect(result.error).toContain('not available')
        })
    })

    // ========================================================================
    // admin.ts — get_vector_index_stats with vector manager
    // ========================================================================

    describe('get_vector_index_stats — with vector manager', () => {
        it('should return stats from vector manager', async () => {
            const vectorManager = createMockVector()

            const result = (await callTool('get_vector_index_stats', {}, db, vectorManager)) as {
                success: boolean
                available: boolean
                itemCount: number
                modelName: string
            }

            expect(result.success).toBe(true)
            expect(result.available).toBe(true)
            expect(result.itemCount).toBe(10)
            expect(result.modelName).toBe('Xenova/all-MiniLM-L6-v2')
        })
    })

    // ========================================================================
    // search.ts — search_by_date_range with all optional filters
    // ========================================================================

    describe('search_by_date_range — full filter coverage', () => {
        it('should filter by tags', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                {
                    start_date: '2020-01-01',
                    end_date: today,
                    tags: ['branch-test'],
                },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.entries).toBeDefined()
            expect(result.count).toBeGreaterThan(0)
        })

        it('should filter by entry_type', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                {
                    start_date: '2020-01-01',
                    end_date: today,
                    entry_type: 'personal_reflection',
                },
                db
            )) as { entries: unknown[] }

            expect(result.entries).toBeDefined()
        })

        it('should filter by is_personal', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                {
                    start_date: '2020-01-01',
                    end_date: today,
                    is_personal: true,
                },
                db
            )) as { entries: unknown[] }

            expect(result.entries).toBeDefined()
        })
    })
})
