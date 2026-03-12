/**
 * Tool Handler Tests
 *
 * Tests getTools listing, callTool for non-GitHub tools,
 * and Zod output schema validation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Tool Handlers', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-tools.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
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

    // ========================================================================
    // getTools
    // ========================================================================

    describe('getTools', () => {
        it('should return all tools when no filter', () => {
            const tools = getTools(db, null)
            expect(tools.length).toBeGreaterThan(30)
        })

        it('should have name, description, and inputSchema on each tool', () => {
            const tools = getTools(db, null)
            for (const t of tools) {
                const tool = t as {
                    name: string
                    description: string
                    inputSchema: object
                }
                expect(typeof tool.name).toBe('string')
                expect(typeof tool.description).toBe('string')
                expect(tool.inputSchema).toBeDefined()
            }
        })

        it('should have outputSchema on each tool (MCP 2025-11-25)', () => {
            const tools = getTools(db, null)
            for (const t of tools) {
                const tool = t as { name: string; outputSchema?: object }
                // mj_execute_code omits outputSchema (z.unknown() in JSON Schema
                // causes structuredContent processing failures in MCP clients)
                if (tool.name === 'mj_execute_code') continue
                expect(tool.outputSchema).toBeDefined()
            }
        })

        it('should include known tool names', () => {
            const tools = getTools(db, null)
            const names = tools.map((t) => (t as { name: string }).name)

            expect(names).toContain('create_entry')
            expect(names).toContain('search_entries')
            expect(names).toContain('get_recent_entries')
            expect(names).toContain('get_statistics')
            expect(names).toContain('link_entries')
            expect(names).toContain('backup_journal')
        })
    })

    // ========================================================================
    // callTool - core tools
    // ========================================================================

    describe('callTool - create_entry', () => {
        it('should create a basic entry', async () => {
            const result = (await callTool(
                'create_entry',
                { content: 'Tool handler test entry' },
                db
            )) as { success: boolean; entry: { id: number; content: string } }

            expect(result.success).toBe(true)
            expect(result.entry).toBeDefined()
            expect(result.entry.id).toBeGreaterThan(0)
            expect(result.entry.content).toBe('Tool handler test entry')
        })

        it('should create entry with all fields', async () => {
            const result = (await callTool(
                'create_entry',
                {
                    content: 'Full tool entry',
                    entry_type: 'project_decision',
                    tags: ['tool-tag-a', 'tool-tag-b'],
                    is_personal: false,
                    significance_type: 'milestone',
                },
                db
            )) as { success: boolean; entry: { entryType: string; tags: string[] } }

            expect(result.success).toBe(true)
            expect(result.entry.entryType).toBe('project_decision')
            expect(result.entry.tags).toContain('tool-tag-a')
        })
    })

    describe('callTool - create_entry_minimal', () => {
        it('should create a minimal entry', async () => {
            const result = (await callTool(
                'create_entry_minimal',
                { content: 'Quick note' },
                db
            )) as { success: boolean; entry: { content: string } }

            expect(result.success).toBe(true)
            expect(result.entry.content).toBe('Quick note')
        })
    })

    describe('callTool - get_entry_by_id', () => {
        it('should retrieve an entry by ID', async () => {
            const created = (await callTool(
                'create_entry',
                { content: 'Retrievable entry' },
                db
            )) as { entry: { id: number } }

            const result = (await callTool(
                'get_entry_by_id',
                { entry_id: created.entry.id },
                db
            )) as { entry: { content: string }; importance: number }

            expect(result.entry.content).toBe('Retrievable entry')
            expect(typeof result.importance).toBe('number')
        })

        it('should return error for nonexistent entry', async () => {
            const result = (await callTool('get_entry_by_id', { entry_id: 99999 }, db)) as {
                error: string
            }

            expect(result.error).toContain('not found')
        })
    })

    describe('callTool - get_recent_entries', () => {
        it('should return recent entries', async () => {
            const result = (await callTool('get_recent_entries', { limit: 3 }, db)) as {
                entries: unknown[]
                count: number
            }

            expect(result.entries.length).toBeLessThanOrEqual(3)
            expect(result.count).toBeGreaterThan(0)
        })
    })

    describe('callTool - test_simple', () => {
        it('should echo message back', async () => {
            const result = (await callTool('test_simple', { message: 'ping' }, db)) as {
                message: string
            }

            expect(result.message).toContain('ping')
        })
    })

    // ========================================================================
    // callTool - search tools
    // ========================================================================

    describe('callTool - search_entries', () => {
        it('should search by content', async () => {
            await callTool('create_entry', { content: 'Unique unicorn xyz99' }, db)

            const result = (await callTool('search_entries', { query: 'xyz99', limit: 5 }, db)) as {
                entries: unknown[]
                count: number
            }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should return empty for non-matching query', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'nonexistent_term_abcxyz', limit: 5 },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBe(0)
        })
    })

    describe('callTool - search_by_date_range', () => {
        it('should search by date range', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                { start_date: today, end_date: today },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // callTool - analytics tools
    // ========================================================================

    describe('callTool - get_statistics', () => {
        it('should return statistics', async () => {
            const result = (await callTool('get_statistics', {}, db)) as {
                groupBy: string
                totalEntries: number
            }

            expect(result.totalEntries).toBeGreaterThan(0)
            expect(result.groupBy).toBe('week')
        })

        it('should accept group_by parameter', async () => {
            const result = (await callTool('get_statistics', { group_by: 'day' }, db)) as {
                groupBy: string
            }

            expect(result.groupBy).toBe('day')
        })
    })

    // ========================================================================
    // callTool - relationship tools
    // ========================================================================

    describe('callTool - link_entries', () => {
        it('should link two entries', async () => {
            const e1 = (await callTool('create_entry', { content: 'Link source' }, db)) as {
                entry: { id: number }
            }
            const e2 = (await callTool('create_entry', { content: 'Link target' }, db)) as {
                entry: { id: number }
            }

            const result = (await callTool(
                'link_entries',
                {
                    from_entry_id: e1.entry.id,
                    to_entry_id: e2.entry.id,
                    relationship_type: 'references',
                    description: 'Test link',
                },
                db
            )) as { success: boolean; relationship: { relationshipType: string } }

            expect(result.success).toBe(true)
            expect(result.relationship.relationshipType).toBe('references')
        })

        it('should return failure for nonexistent entry', async () => {
            const result = (await callTool(
                'link_entries',
                {
                    from_entry_id: 99999,
                    to_entry_id: 99998,
                    relationship_type: 'references',
                },
                db
            )) as { success: boolean; message?: string }

            expect(result.success).toBe(false)
        })
    })

    // ========================================================================
    // callTool - admin tools
    // ========================================================================

    describe('callTool - update_entry', () => {
        it('should update entry content', async () => {
            const created = (await callTool(
                'create_entry',
                { content: 'Original content' },
                db
            )) as { entry: { id: number } }

            const result = (await callTool(
                'update_entry',
                { entry_id: created.entry.id, content: 'Updated content' },
                db
            )) as { success: boolean; entry: { content: string } }

            expect(result.success).toBe(true)
            expect(result.entry.content).toBe('Updated content')
        })
    })

    describe('callTool - delete_entry', () => {
        it('should soft delete an entry', async () => {
            const created = (await callTool('create_entry', { content: 'To be deleted' }, db)) as {
                entry: { id: number }
            }

            const result = (await callTool('delete_entry', { entry_id: created.entry.id }, db)) as {
                success: boolean
                entryId: number
            }

            expect(result.success).toBe(true)
            expect(result.entryId).toBe(created.entry.id)
        })

        it('should return error for nonexistent entry', async () => {
            const result = (await callTool('delete_entry', { entry_id: 99999 }, db)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })
    })

    // ========================================================================
    // callTool - tag tools
    // ========================================================================

    describe('callTool - list_tags', () => {
        it('should list tags with usage counts', async () => {
            const result = (await callTool('list_tags', {}, db)) as {
                tags: { name: string; count: number }[]
                count: number
            }

            expect(result.tags).toBeDefined()
            expect(result.count).toBeGreaterThan(0)
        })
    })

    describe('callTool - merge_tags', () => {
        it('should merge tags', async () => {
            await callTool('create_entry', { content: 'Merge tag source', tags: ['merge-src'] }, db)

            const result = (await callTool(
                'merge_tags',
                { source_tag: 'merge-src', target_tag: 'merge-tgt' },
                db
            )) as { success: boolean; message: string }

            expect(result.success).toBe(true)
            expect(result.message).toContain('Merged')
        })
    })

    // ========================================================================
    // callTool - export tools
    // ========================================================================

    describe('callTool - export_entries', () => {
        it('should export as JSON', async () => {
            const result = (await callTool('export_entries', { format: 'json' }, db)) as {
                format: string
                entries: unknown[]
            }

            expect(result.format).toBe('json')
            expect(result.entries.length).toBeGreaterThan(0)
        })

        it('should export as markdown', async () => {
            const result = (await callTool('export_entries', { format: 'markdown' }, db)) as {
                format: string
                content: string
            }

            expect(result.format).toBe('markdown')
            expect(result.content.length).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // callTool - backup tools
    // ========================================================================

    describe('callTool - backup_journal', () => {
        it('should create a backup', async () => {
            const result = (await callTool('backup_journal', { name: 'test-tool-backup' }, db)) as {
                success: boolean
                filename: string
                path: string
                sizeBytes: number
            }

            expect(result.success).toBe(true)
            expect(result.filename).toContain('test-tool-backup')

            // Cleanup backup file
            try {
                const fs = require('node:fs')
                if (fs.existsSync(result.path)) {
                    fs.unlinkSync(result.path)
                }
            } catch {
                // Ignore cleanup
            }
        })
    })

    describe('callTool - list_backups', () => {
        it('should list backups', async () => {
            const result = (await callTool('list_backups', {}, db)) as {
                backups: unknown[]
                total: number
                backupsDirectory: string
            }

            expect(result.backups).toBeDefined()
            expect(typeof result.total).toBe('number')
            expect(result.backupsDirectory).toBeDefined()
        })
    })

    // ========================================================================
    // callTool - unknown tool
    // ========================================================================

    describe('callTool - error handling', () => {
        it('should throw for unknown tool', async () => {
            await expect(callTool('nonexistent_tool', {}, db)).rejects.toThrow('Unknown tool')
        })
    })

    // ========================================================================
    // callTool - visualize_relationships
    // ========================================================================

    describe('callTool - visualize_relationships', () => {
        it('should generate mermaid diagram', async () => {
            const e1 = (await callTool('create_entry', { content: 'Viz entry A' }, db)) as {
                entry: { id: number }
            }
            const e2 = (await callTool('create_entry', { content: 'Viz entry B' }, db)) as {
                entry: { id: number }
            }
            await callTool(
                'link_entries',
                {
                    from_entry_id: e1.entry.id,
                    to_entry_id: e2.entry.id,
                    relationship_type: 'implements',
                },
                db
            )

            const result = (await callTool(
                'visualize_relationships',
                { entry_id: e1.entry.id },
                db
            )) as { mermaid: string | null; entry_count: number }

            expect(result.entry_count).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // callTool - cross project insights
    // ========================================================================

    describe('callTool - get_cross_project_insights', () => {
        it('should return insights structure', async () => {
            // Need project entries for insights
            await callTool('create_entry', { content: 'Insight entry 1', project_number: 100 }, db)
            await callTool('create_entry', { content: 'Insight entry 2', project_number: 100 }, db)
            await callTool('create_entry', { content: 'Insight entry 3', project_number: 100 }, db)

            const result = (await callTool(
                'get_cross_project_insights',
                { min_entries: 1 },
                db
            )) as {
                project_count: number
                total_entries: number
                projects: unknown[]
            }

            expect(result.project_count).toBeGreaterThan(0)
            expect(result.total_entries).toBeGreaterThan(0)
        })
    })
})
