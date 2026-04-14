/**
 * Team Analytics Tool Handler Tests
 *
 * Tests the team analytics tool group: team_get_statistics, team_get_cross_project_insights
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Team Analytics Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-analytics-personal.db'
    const teamDbPath = './test-team-analytics-team.db'

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

        // Seed data for analytics
        const seed1 = await callTool(
            'team_create_entry',
            {
                content: 'Project Alpha init',
                entry_type: 'technical_note',
                project_number: 101,
                project_owner: 'org',
                tags: ['planning', 'alpha'],
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
        const seed2 = await callTool(
            'team_create_entry',
            {
                content: 'Project Alpha task 1',
                entry_type: 'feature_implementation',
                project_number: 101,
                project_owner: 'org',
                tags: ['task'],
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
        const seed3 = await callTool(
            'team_create_entry',
            {
                content: 'Project Alpha task 2',
                entry_type: 'feature_implementation',
                project_number: 101,
                project_owner: 'org',
                tags: ['task'],
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
        const seed4 = await callTool(
            'team_create_entry',
            {
                content: 'Project Beta init',
                entry_type: 'technical_note',
                project_number: 202,
                tags: ['beta'],
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
        console.error('DEBUG SEEDS', JSON.stringify({ seed1, seed2, seed3, seed4 }, null, 2))

        // Old project for testing inactive threshold
        const oldEntry = teamDb.createEntry({
            content: 'Old Project Gamma',
            entryType: 'technical_note',
            isPersonal: false,
            projectNumber: 303,
        })
        teamDb._executeRawQueryUnsafe(
            `UPDATE memory_journal SET timestamp = datetime('now', '-10 days') WHERE id = ?`,
            [oldEntry.id]
        )
        teamDb.flushSave()
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

    describe('team_get_statistics', () => {
        it('should return team statistics including authors', async () => {
            const result = (await callTool(
                'team_get_statistics',
                {},
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.totalEntries).toBeGreaterThanOrEqual(4)
            expect(result.authors).toBeDefined()
            expect(result.authors.length).toBeGreaterThan(0)
            expect(result.authors[0].author).toBeDefined()
            expect(result.authors[0].count).toBeGreaterThan(0)
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool('team_get_statistics', {}, personalDb)) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })

    describe('team_get_cross_project_insights', () => {
        it('should return cross-project insights above min_entries', async () => {
            const result = (await callTool(
                'team_get_cross_project_insights',
                { min_entries: 2 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.project_count).toBeGreaterThanOrEqual(1)
            expect(result.projects[0].project_number).toBe(101)
            expect(result.projects[0].top_tags).toBeDefined()
            expect(result.projects[0].top_tags.some((t: any) => t.name === 'task')).toBe(true)

            expect(result.time_distribution).toBeDefined()
            expect(result.time_distribution.length).toBeGreaterThan(0)
            expect(result.time_distribution[0].percentage).toBeDefined()
        })

        it('should identify inactive projects', async () => {
            const result = (await callTool(
                'team_get_cross_project_insights',
                { min_entries: 1 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.inactive_projects).toBeDefined()
            // Project 303 should be inactive (10 days old)
            expect(result.inactive_projects.some((p: any) => p.project_number === 303)).toBe(true)
        })

        it('should handle date ranges', async () => {
            const result = (await callTool(
                'team_get_cross_project_insights',
                { min_entries: 1, start_date: '2050-01-01', end_date: '2050-12-31' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.project_count).toBe(0)
            expect(result.message).toContain('No projects found')
            expect(result.projects).toHaveLength(0)
            expect(result.inactive_projects).toHaveLength(0)
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_get_cross_project_insights',
                { min_entries: 1 },
                personalDb
            )) as any

            expect(result.error).toContain('Team database not configured')
        })
    })
})
