/**
 * Additional Coverage Tests — Targeted Gap Closure (Batch 2)
 *
 * Tests for remaining uncovered lines in:
 * - admin.ts: update_entry not found, delete_entry not found, merge_tags same-tag/error,
 *   rebuild_vector_index without vector, add_to_vector_index without vector/not found
 * - relationships.ts: link_entries self-link, link to nonexistent entry, visualize with tags
 * - team/vector-tools.ts: all 4 tools without teamDb
 * - team/backup-tools.ts: both tools without teamDb
 * - team/export-tools.ts: without teamDb
 * - team/admin-tools.ts: without teamDb
 * - auth/auth-context.ts: runWithAuthContext, getAuthContext, isAuthenticated, getAuthenticatedScopes
 * - utils/resource-annotations.ts: withPriority, withAutoRead, withSessionInit
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    runWithAuthContext,
    getAuthContext,
    setAuthContext,
    withAuthContext,
    isAuthenticated,
    getAuthenticatedScopes,
} from '../../src/auth/auth-context.js'
import {
    withPriority,
    withAutoRead,
    withSessionInit,
    HIGH_PRIORITY,
    MEDIUM_PRIORITY,
    ASSISTANT_FOCUSED,
} from '../../src/utils/resource-annotations.js'

describe('Targeted Gap Closure — Batch 2', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-gaps-2.db'

    beforeAll(async () => {
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            /* ignore */
        }
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()

        // Create test entries for relationship tests
        db.createEntry({ content: 'Gap2 entry A', tags: ['gap2-test'] })
        db.createEntry({ content: 'Gap2 entry B', tags: ['gap2-test'] })
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
    // admin.ts — update_entry not found (L121-130)
    // ========================================================================

    describe('admin tools — error branches', () => {
        it('update_entry should return not found for invalid ID', async () => {
            const result = (await callTool(
                'update_entry',
                { entry_id: 99999, content: 'Updated content' },
                db
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })

        it('delete_entry should return not found for invalid ID', async () => {
            const result = (await callTool('delete_entry', { entry_id: 99999 }, db)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })

        it('merge_tags should reject same source and target', async () => {
            const result = (await callTool(
                'merge_tags',
                { source_tag: 'same-tag', target_tag: 'same-tag' },
                db
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('different')
        })

        it('merge_tags should handle nonexistent source tag', async () => {
            const result = (await callTool(
                'merge_tags',
                { source_tag: 'nonexistent-xyz-tag', target_tag: 'gap2-test' },
                db
            )) as { success: boolean; entriesMerged?: number; error?: string }

            // Should succeed with 0 merged entries or return a structured error
            if (result.success) {
                expect(result.entriesMerged).toBe(0)
            } else {
                expect(typeof result.error).toBe('string')
            }
        })

        it('rebuild_vector_index should return error without vectorManager', async () => {
            const result = (await callTool('rebuild_vector_index', {}, db)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not available')
        })

        it('add_to_vector_index should return error without vectorManager', async () => {
            const result = (await callTool('add_to_vector_index', { entry_id: 1 }, db)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not available')
        })

        it('add_to_vector_index should return not found for invalid entry', async () => {
            // Provide a mock vectorManager so it reaches the getEntryById check
            const mockVectorManager = {
                isInitialized: () => true,
                addEntry: async () => ({ success: true }),
                search: async () => [],
                getStats: () => ({ itemCount: 0, modelName: 'test', dimensions: 384 }),
                removeEntry: async () => {},
                rebuildIndex: async () => ({ indexed: 0, failed: 0 }),
                generateEmbedding: async () => [],
            } as any
            const result = (await callTool(
                'add_to_vector_index',
                { entry_id: 99999 },
                db,
                mockVectorManager
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })
    })

    // ========================================================================
    // relationships.ts — link_entries edge cases (L120-127, L168-182, L270-278)
    // ========================================================================

    describe('relationship tools — edge cases', () => {
        it('link_entries should reject self-referential link', async () => {
            const result = (await callTool(
                'link_entries',
                { from_entry_id: 1, to_entry_id: 1 },
                db
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('itself')
        })

        it('link_entries should handle nonexistent entry IDs', async () => {
            const result = (await callTool(
                'link_entries',
                { from_entry_id: 99998, to_entry_id: 99999 },
                db
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })

        it('link_entries should detect duplicate relationships', async () => {
            // Create a relationship first
            await callTool(
                'link_entries',
                { from_entry_id: 1, to_entry_id: 2, relationship_type: 'references' },
                db
            )
            // Try creating the same one again
            const result = (await callTool(
                'link_entries',
                { from_entry_id: 1, to_entry_id: 2, relationship_type: 'references' },
                db
            )) as { success: boolean; duplicate: boolean; message: string }

            expect(result.success).toBe(true)
            expect(result.duplicate).toBe(true)
            expect(result.message).toContain('already exists')
        })

        it('visualize_relationships with tag filter should return entries', async () => {
            const result = (await callTool(
                'visualize_relationships',
                { tags: ['gap2-test'], limit: 10 },
                db
            )) as Record<string, unknown>

            expect(result).toBeDefined()
            expect(result['entry_count']).toBeDefined()
        })

        it('visualize_relationships with no matching filters should handle empty', async () => {
            const result = (await callTool(
                'visualize_relationships',
                { tags: ['nonexistent-tag-xyz'] },
                db
            )) as { entry_count: number; mermaid: string | null }

            expect(result.entry_count).toBe(0)
            expect(result.mermaid).toBeNull()
        })

        it('visualize_relationships with nonexistent entry_id should return not found', async () => {
            const result = (await callTool('visualize_relationships', { entry_id: 99999 }, db)) as {
                success: boolean
                message: string
            }

            expect(result.success).toBe(false)
            expect(result.message).toContain('not found')
        })

        it('visualize_relationships with no filters should return graph', async () => {
            const result = (await callTool('visualize_relationships', {}, db)) as Record<
                string,
                unknown
            >

            if (result.success === false) {
                expect(typeof result.error).toBe('string')
            } else {
                expect(typeof result.entry_count).toBe('number')
                // mermaid may be a string diagram or null when no relationships exist
                expect(result.mermaid === null || typeof result.mermaid === 'string').toBe(true)
            }
        })
    })

    // ========================================================================
    // team/vector-tools.ts — all 4 tools without teamDb (L49-51, L133-134, L165-167, L213-215)
    // ========================================================================

    describe('team vector tools without teamDb', () => {
        it('team_semantic_search should return error', async () => {
            const result = (await callTool('team_semantic_search', { query: 'test' }, db)) as {
                error: string
            }

            expect(result.error).toContain('Team database not configured')
        })

        it('team_get_vector_index_stats should return error', async () => {
            const result = (await callTool('team_get_vector_index_stats', {}, db)) as {
                available: boolean
                error: string
            }

            expect(result.available).toBe(false)
        })

        it('team_rebuild_vector_index should return error', async () => {
            const result = (await callTool('team_rebuild_vector_index', {}, db)) as {
                error: string
            }

            expect(result.error).toContain('Team database not configured')
        })

        it('team_add_to_vector_index should return error', async () => {
            const result = (await callTool('team_add_to_vector_index', { entry_id: 1 }, db)) as {
                error: string
            }

            expect(result.error).toContain('Team database not configured')
        })
    })

    // ========================================================================
    // team/backup-tools.ts — both tools without teamDb (L31-33, L61-63)
    // ========================================================================

    describe('team backup tools without teamDb', () => {
        it('team_backup should return error', async () => {
            const result = (await callTool('team_backup', {}, db)) as { error: string }

            expect(result.error).toContain('Team database not configured')
        })

        it('team_list_backups should return error', async () => {
            const result = (await callTool('team_list_backups', {}, db)) as { error: string }

            expect(result.error).toContain('Team database not configured')
        })
    })

    // ========================================================================
    // team/export-tools.ts — without teamDb (L37-39)
    // ========================================================================

    describe('team export tools without teamDb', () => {
        it('team_export_entries should return error', async () => {
            const result = (await callTool('team_export_entries', { format: 'json' }, db)) as {
                error: string
            }

            expect(result.error).toContain('Team database not configured')
        })
    })

    // ========================================================================
    // team/admin-tools.ts — without teamDb (L72, L118, L159)
    // ========================================================================

    describe('team admin tools without teamDb', () => {
        it('team_update_entry should return error', async () => {
            const result = (await callTool(
                'team_update_entry',
                { entry_id: 1, content: 'test' },
                db
            )) as { error: string }

            expect(result.error).toContain('Team database not configured')
        })

        it('team_delete_entry should return error', async () => {
            const result = (await callTool('team_delete_entry', { entry_id: 1 }, db)) as {
                error: string
            }

            expect(result.error).toContain('Team database not configured')
        })

        it('team_merge_tags should return error', async () => {
            const result = (await callTool(
                'team_merge_tags',
                { source_tag: 'a', target_tag: 'b' },
                db
            )) as { error: string }

            expect(result.error).toContain('Team database not configured')
        })
    })
})

// ============================================================================
// auth/auth-context.ts — all functions
// ============================================================================

describe('Auth Context', () => {
    it('getAuthContext should return undefined outside of auth context', () => {
        const ctx = getAuthContext()
        expect(ctx).toBeUndefined()
    })

    it('runWithAuthContext should provide context within callback', () => {
        const mockContext = {
            authenticated: true as const,
            claims: { sub: 'test-user', scopes: ['read', 'write'] },
        }

        const result = runWithAuthContext(mockContext, () => {
            return getAuthContext()
        })

        expect(result?.authenticated).toBe(true)
        expect(result?.claims?.sub).toBe('test-user')
    })

    it('withAuthContext should be an alias for runWithAuthContext', () => {
        const mockContext = {
            authenticated: true as const,
            claims: { sub: 'alias-test', scopes: ['read'] },
        }

        const result = withAuthContext(mockContext, () => getAuthContext())
        expect(result?.claims?.sub).toBe('alias-test')
    })

    it('setAuthContext should set context imperatively', () => {
        const mockContext = {
            authenticated: true as const,
            claims: { sub: 'imperative-test', scopes: ['admin'] },
        }

        // setAuthContext uses enterWith, so we need to be in an async context
        runWithAuthContext(mockContext, () => {
            setAuthContext({
                authenticated: true,
                claims: { sub: 'updated-user', scopes: ['admin', 'write'] },
            })
            const ctx = getAuthContext()
            expect(ctx?.claims?.sub).toBe('updated-user')
        })
    })

    it('isAuthenticated should return false outside context', () => {
        expect(isAuthenticated()).toBe(false)
    })

    it('isAuthenticated should return true within auth context', () => {
        const result = runWithAuthContext(
            { authenticated: true, claims: { sub: 'user', scopes: [] } },
            () => isAuthenticated()
        )
        expect(result).toBe(true)
    })

    it('getAuthenticatedScopes should return empty array outside context', () => {
        expect(getAuthenticatedScopes()).toEqual([])
    })

    it('getAuthenticatedScopes should return scopes within auth context', () => {
        const result = runWithAuthContext(
            { authenticated: true, claims: { sub: 'user', scopes: ['read', 'write'] } },
            () => getAuthenticatedScopes()
        )
        expect(result).toEqual(['read', 'write'])
    })

    it('getAuthenticatedScopes should return empty for unauthenticated context', () => {
        const result = runWithAuthContext({ authenticated: false }, () => getAuthenticatedScopes())
        expect(result).toEqual([])
    })
})

// ============================================================================
// utils/resource-annotations.ts — helper functions
// ============================================================================

describe('Resource Annotations', () => {
    it('withPriority should override priority on base annotation', () => {
        const result = withPriority(0.8)
        expect(result.priority).toBe(0.8)
        expect(result.audience).toEqual(MEDIUM_PRIORITY.audience)
    })

    it('withPriority should accept custom base annotation', () => {
        const result = withPriority(0.3, ASSISTANT_FOCUSED)
        expect(result.priority).toBe(0.3)
        expect(result.audience).toEqual(['assistant'])
    })

    it('withAutoRead should set autoRead flag', () => {
        const result = withAutoRead()
        expect(result.autoRead).toBe(true)
        expect(result.priority).toBe(HIGH_PRIORITY.priority)
    })

    it('withAutoRead should accept custom base', () => {
        const result = withAutoRead(ASSISTANT_FOCUSED)
        expect(result.autoRead).toBe(true)
        expect(result.audience).toEqual(['assistant'])
    })

    it('withSessionInit should set sessionInit flag', () => {
        const result = withSessionInit()
        expect(result.sessionInit).toBe(true)
        expect(result.priority).toBe(HIGH_PRIORITY.priority)
    })

    it('withSessionInit should accept custom base', () => {
        const result = withSessionInit(ASSISTANT_FOCUSED)
        expect(result.sessionInit).toBe(true)
        expect(result.audience).toEqual(['assistant'])
    })
})
