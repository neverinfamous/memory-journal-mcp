/**
 * Team Relationship Tool Handler Tests
 *
 * Tests the team relationship tool group: team_link_entries, team_visualize_relationships
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] } } as any, progress, teamDb, teamVector);


describe('Team Relationship Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-relationships-personal.db'
    const teamDbPath = './test-team-relationships-team.db'

    let e1: number, e2: number, e3: number

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

        // Seed entries for linking
        const res1 = (await callTool(
            'team_create_entry',
            {
                project_number: 1, content: 'Node A', tags: ['node-tag'] },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        const res2 = (await callTool(
            'team_create_entry',
            {
                project_number: 1, content: 'Node B', tags: ['node-tag'] },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        const res3 = (await callTool(
            'team_create_entry',
            {
                project_number: 1, content: 'Node C' },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any

        console.error('DEBUG RELATIONS', JSON.stringify({ res1, res2, res3 }, null, 2))

        expect(res1.success).toBe(true)
        expect(res2.success).toBe(true)

        e1 = res1.entry.id
        e2 = res2.entry.id
        e3 = res3.entry.id
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

    describe('team_link_entries', () => {
        it('should link two team entries', async () => {
            const result = (await callTool(
                'team_link_entries',
                {
                    project_number: 1,
                    from_entry_id: e1,
                    to_entry_id: e2,
                    relationship_type: 'blocked_by',
                    description: 'A depends on B',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.relationship.fromEntryId).toBe(e1)
            expect(result.relationship.toEntryId).toBe(e2)
            expect(result.relationship.relationshipType).toBe('blocked_by')
            expect(result.message).toContain('Linked entries')
            expect(result.duplicate).toBeUndefined()
        })

        it('should detect duplicate relationships', async () => {
            const result = (await callTool(
                'team_link_entries',
                { project_number: 1, from_entry_id: e1, to_entry_id: e2, relationship_type: 'blocked_by' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.duplicate).toBe(true)
            expect(result.message).toContain('already exists')
        })

        it('should return error if from_entry_id is not found', async () => {
            const result = (await callTool(
                'team_link_entries',
                { project_number: 1, from_entry_id: 999, to_entry_id: e2, relationship_type: 'references' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team entry 999 not found')
        })

        it('should return error if to_entry_id is not found', async () => {
            const result = (await callTool(
                'team_link_entries',
                { project_number: 1, from_entry_id: e1, to_entry_id: 999, relationship_type: 'references' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team entry 999 not found')
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_link_entries',
                { project_number: 1, from_entry_id: e1, to_entry_id: e2, relationship_type: 'references' },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })

    describe('team_visualize_relationships', () => {
        beforeAll(async () => {
            await callTool(
                'team_link_entries',
                { project_number: 1, from_entry_id: e2, to_entry_id: e3, relationship_type: 'caused' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )
        })

        it('should visualize relationships from entry ID with depth', async () => {
            const result = (await callTool(
                'team_visualize_relationships',
                {
                project_number: 1, entry_id: e1, depth: 2 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.mermaid).toContain('graph LR')
            expect(result.mermaid).toContain('blocked_by')
            expect(result.mermaid).toContain('caused')
            expect(result.nodeCount).toBe(3) // A, B, C
            expect(result.edgeCount).toBe(2)
        })

        it('should visualize relationships by tag', async () => {
            const result = (await callTool(
                'team_visualize_relationships',
                {
                project_number: 1, tag: 'node-tag' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.mermaid).toContain('graph LR')
            expect(result.mermaid).toContain('blocked_by')
            // Node C does not have 'node-tag', but A and B do, and A->B.
            // But A, B have relations to each other.
            expect(result.nodeCount).toBeGreaterThanOrEqual(2)
            expect(result.edgeCount).toBeGreaterThanOrEqual(1)
        })

        it('should visualize recent relationships (default)', async () => {
            const result = (await callTool(
                'team_visualize_relationships',
                {
                project_number: 1,},
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.mermaid).toContain('graph LR')
            expect(result.nodeCount).toBeGreaterThan(0)
        })

        it('should return empty graph if no entries match', async () => {
            const result = (await callTool(
                'team_visualize_relationships',
                {
                project_number: 1, tag: 'nonexistent-tag' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.mermaid).toContain('No entries found')
            expect(result.nodeCount).toBe(0)
            expect(result.edgeCount).toBe(0)
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool('team_visualize_relationships', {
                project_number: 1,}, personalDb)) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })
})
