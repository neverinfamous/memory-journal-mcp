/**
 * Team Admin Tool Handler Tests
 *
 * Tests the team admin tool group: team_update_entry, team_delete_entry, team_merge_tags
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Team Admin Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-admin-personal.db'
    const teamDbPath = './test-team-admin-team.db'

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

    describe('team_update_entry', () => {
        it('should update an existing team entry', async () => {
            const createResult = (await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'Original content', entry_type: 'technical_note', tags: ['old-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            console.error('DEBUG TEAM ADMIN CREATE ENTRY', JSON.stringify(createResult, null, 2))
            expect(createResult.success).toBe(true)
            const entryId = createResult.entry.id

            const updateResult = (await callTool(
                'team_update_entry',
                {
                project_number: 1,
                    entry_id: entryId,
                    content: 'Updated content',
                    entry_type: 'bug_fix',
                    tags: ['new-tag'],
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(updateResult.success).toBe(true)
            expect(updateResult.entry.content).toBe('Updated content')
            expect(updateResult.entry.entryType).toBe('bug_fix')
            expect(updateResult.entry.tags).toEqual(['new-tag'])
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_update_entry',
                {
                project_number: 1, entry_id: 999, content: 'test' },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return error if entry is not found', async () => {
            const result = (await callTool(
                'team_update_entry',
                {
                project_number: 1, entry_id: 9999, content: 'test' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team entry 9999 not found')
            expect(result.code).toBe('RESOURCE_NOT_FOUND')
        })
    })

    describe('team_delete_entry', () => {
        it('should soft-delete an existing team entry', async () => {
            const createResult = (await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'To be deleted' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            const entryId = createResult.entry.id

            const deleteResult = (await callTool(
                'team_delete_entry',
                {
                project_number: 1, entry_id: entryId },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(deleteResult.success).toBe(true)
            expect(deleteResult.message).toContain('soft-deleted')

            // Verify it cannot be updated
            const updateResult = (await callTool(
                'team_update_entry',
                {
                project_number: 1, entry_id: entryId, content: 'Cannot update deleted' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(updateResult.success).toBe(false)
            expect(updateResult.error).toContain('not found')
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_delete_entry',
                {
                project_number: 1, entry_id: 999 },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return error if entry is not found', async () => {
            const result = (await callTool(
                'team_delete_entry',
                {
                project_number: 1, entry_id: 9999 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })
    })

    describe('team_merge_tags', () => {
        it('should merge source tag into target tag for team entries', async () => {
            // Create entries with source tag
            await callTool(
                'team_create_entry',
                {
                project_number: 1, content: '1', tags: ['merge-source-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )
            await callTool(
                'team_create_entry',
                {
                project_number: 1, content: '2', tags: ['merge-source-tag', 'other-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )
            await callTool(
                'team_create_entry',
                {
                project_number: 1, content: '3', tags: ['merge-target-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const mergeResult = (await callTool(
                'team_merge_tags',
                { source_tag: 'merge-source-tag', target_tag: 'merge-target-tag' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(mergeResult.success).toBe(true)
            expect(mergeResult.entriesUpdated).toBeGreaterThanOrEqual(2)
            expect(mergeResult.sourceDeleted).toBe(true)

            // Verify search by source tag returns empty
            const searchSource = (await callTool(
                'team_search',
                {
                project_number: 1, tags: ['merge-source-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(searchSource.count).toBe(0)

            // Verify search by target tag returns at least 3
            const searchTarget = (await callTool(
                'team_search',
                {
                project_number: 1, tags: ['merge-target-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(searchTarget.count).toBeGreaterThanOrEqual(3)
        }, 30000)

        it('should return error if source and target are the same', async () => {
            const result = (await callTool(
                'team_merge_tags',
                { source_tag: 'same-tag', target_tag: 'same-tag' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('must be different')
            expect(result.code).toBe('VALIDATION_ERROR')
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_merge_tags',
                { source_tag: 'a', target_tag: 'b' },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })
})
