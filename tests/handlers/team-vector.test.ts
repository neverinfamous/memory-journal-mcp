/**
 * Team Vector Tool Handler Tests
 *
 * Tests the team vector tool group: team_semantic_search, team_get_vector_index_stats, team_rebuild_vector_index, team_add_to_vector_index
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] } } as any, progress, teamDb, teamVector);

vi.mock('../../src/auth/auth-context.js', async (importOriginal: any) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAuthContext: () => ({ authenticated: true, claims: { sub: 'test-user', scopes: ['team', 'write', 'admin'] } })
    }
})

describe('Team Vector Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let vectorManager: VectorSearchManager
    const personalDbPath = './test-team-vector-personal.db'
    const teamDbPath = './test-team-vector-team.db'

    beforeAll(async () => {
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}

        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()

        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        // Mock vector manager
        vectorManager = {
            search: async (query: string, limit: number, threshold: number) => {
                if (query === 'empty') return []
                return [{ entryId: 1, score: 0.8 }]
            },
            getStats: () => ({ itemCount: 10, modelName: 'test-model', dimensions: 384 }),
            rebuildIndex: async () => ({ indexed: 10, failed: 0 }),
            addEntry: async (id: number) => ({
                success: id !== 999,
                error: id === 999 ? 'Failed' : undefined,
            }),
            initialize: async () => {},
            deleteEntry: async () => {},
            close: async () => {},
        } as unknown as VectorSearchManager

        // Create the entry that the mock returns
        await callTool(
            'team_create_entry',
            {
                project_number: 1, content: 'Vector matched' },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
    })

    afterAll(() => {
        personalDb.close()
        teamDb.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    // Helper to get tools
    const callTeamTool = async (name: string, args: any) =>
        callTool(
            name,
            args,
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb,
            vectorManager
        )

    describe('team_semantic_search', () => {
        it('should return semantic search results', async () => {
            const result = (await callTeamTool('team_semantic_search', {
                project_number: 1, query: 'test' })) as any

            expect(result.query).toBe('test')
            expect(result.count).toBeGreaterThan(0)
            expect(result.entries[0].similarity).toBe(0.8)
            expect(result.entries[0].content).toContain('Vector matched')
        })

        it('should handle hints on empty results', async () => {
            const result = (await callTeamTool('team_semantic_search', {
                project_number: 1, query: 'empty' })) as any

            expect(result.count).toBe(0)
            expect(result.hint).toContain('No entries matched')
        })

        it('should require vector manager', async () => {
            const result = (await callTool(
                'team_semantic_search',
                {
                project_number: 1, query: 'test' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team vector search not available')
        })

        it('should require team DB', async () => {
            const result = (await callTool(
                'team_semantic_search',
                {
                project_number: 1, query: 'test' },
                personalDb
            )) as any
            expect(result.error).toContain('Team database not configured')
        })
    })

    describe('team_get_vector_index_stats', () => {
        it('should return vector stats', async () => {
            const result = (await callTeamTool('team_get_vector_index_stats', {})) as any

            expect(result.available).toBe(true)
            expect(result.itemCount).toBe(10)
        })

        it('should require vector manager', async () => {
            const result = (await callTool(
                'team_get_vector_index_stats',
                {},
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.available).toBe(false)
            expect(result.error).toContain('Team vector search not available')
        })
    })

    describe('team_rebuild_vector_index', () => {
        it('should rebuild index', async () => {
            const result = (await callTeamTool('team_rebuild_vector_index', {})) as any

            expect(result.success).toBe(true)
            expect(result.entriesIndexed).toBe(10)
        })

        it('should require vector manager', async () => {
            const result = (await callTool(
                'team_rebuild_vector_index',
                {},
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team vector search not available')
        })
    })

    describe('team_add_to_vector_index', () => {
        it('should add entry to index', async () => {
            const result = (await callTeamTool('team_add_to_vector_index', {
                project_number: 1, entry_id: 1 })) as any

            expect(result.success).toBe(true)
            expect(result.entryId).toBe(1)
        })

        it('should handle failure', async () => {
            // we mocked entry 999 to fail returning an error, but it first checks DB.
            // Let's create entry 999 manually. Wait, sqlite auto-increments. Let's just create a new entry and check.
            const result = (await callTeamTool('team_add_to_vector_index', {
                project_number: 1,
                entry_id: 9999,
            })) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found') // DB lookup fails first
        })

        it('should require vector manager', async () => {
            const result = (await callTool(
                'team_add_to_vector_index',
                {
                project_number: 1, entry_id: 1 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team vector search not available')
        })
    })
})
