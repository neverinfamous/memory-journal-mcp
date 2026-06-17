/**
 * Optimistic Locking Concurrency Tests
 *
 * Tests the expected_version and VERSION_CONFLICT behaviors for
 * core and team update tools.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'

const callTool = (
    name: any,
    params: any,
    db: any,
    vectorManager?: any,
    github?: any,
    config?: any,
    progress?: any,
    teamDb?: any,
    teamVector?: any
) =>
    _callTool(
        name,
        params,
        db,
        vectorManager,
        github,
        config ??
            ({
                runtime: {
                    maintenanceManager: {
                        withActiveJob: (fn: any) => fn(),
                        acquireMaintenanceLock: async () => {},
                        releaseMaintenanceLock: () => {},
                    },
                },
                io: { allowedRoots: [process.cwd()] },
            } as any),
        progress,
        teamDb,
        teamVector
    )

vi.mock('../../src/auth/auth-context.js', async (importOriginal: any) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAuthContext: () => ({
            authenticated: true,
            claims: { sub: 'test-user', scopes: ['write', 'admin', 'team'] },
        }),
    }
})

describe('Optimistic Locking Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './.test-output/vitest/test-optimistic-locking-personal.db'
    const teamDbPath = './.test-output/vitest/test-optimistic-locking-team.db'

    beforeAll(async () => {
        try {
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
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}
    })

    describe('update_entry', () => {
        it('should successfully update with matching expected_version', async () => {
            const createResult = (await callTool(
                'create_entry',
                { content: 'v1', project_number: 1 },
                personalDb
            )) as any
            expect(createResult.success).toBe(true)

            const entryId = createResult.entry.id
            const v1 = createResult.entry.version

            const updateResult = (await callTool(
                'update_entry',
                {
                    entry_id: entryId,
                    project_number: 1,
                    expected_version: v1,
                    content: 'v2',
                },
                personalDb
            )) as any

            expect(updateResult.success).toBe(true)
            expect(updateResult.entry.content).toBe('v2')
            expect(updateResult.entry.version).toBeGreaterThan(v1)
        })

        it('should fail with VERSION_CONFLICT if expected_version is stale', async () => {
            const createResult = (await callTool(
                'create_entry',
                { content: 'v1', project_number: 1 },
                personalDb
            )) as any
            const entryId = createResult.entry.id
            const v1 = createResult.entry.version

            // First update increments version to v2
            const update1 = (await callTool(
                'update_entry',
                {
                    entry_id: entryId,
                    project_number: 1,
                    expected_version: v1,
                    content: 'v2',
                },
                personalDb
            )) as any
            expect(update1.success).toBe(true)
            const v2 = update1.entry.version

            // Second update attempts to use v1 again
            const update2 = (await callTool(
                'update_entry',
                {
                    entry_id: entryId,
                    project_number: 1,
                    expected_version: v1,
                    content: 'v3 (conflict)',
                },
                personalDb
            )) as any

            expect(update2.success).toBe(false)
            expect(update2.code).toBe('VERSION_CONFLICT')
            expect(update2.error).toContain('Version conflict')
            expect(update2.details).toBeDefined()
            expect(update2.details.version).toBe(v2)
            expect(update2.details.content).toBe('v2')
        })
    })

    describe('team_update_entry', () => {
        it('should fail with VERSION_CONFLICT if expected_version is stale on team entry', async () => {
            const createResult = (await callTool(
                'team_create_entry',
                { project_number: 1, content: 'team v1' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            const entryId = createResult.entry.id
            const v1 = createResult.entry.version

            const update1 = (await callTool(
                'team_update_entry',
                {
                    project_number: 1,
                    entry_id: entryId,
                    expected_version: v1,
                    content: 'team v2',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(update1.success).toBe(true)
            const v2 = update1.entry.version

            const update2 = (await callTool(
                'team_update_entry',
                {
                    project_number: 1,
                    entry_id: entryId,
                    expected_version: v1, // stale
                    content: 'team v3 (conflict)',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(update2.success).toBe(false)
            expect(update2.code).toBe('VERSION_CONFLICT')
            expect(update2.details.version).toBe(v2)
        })
    })

    describe('batch_update_entries', () => {
        it('should fail batch update if any expected_version is stale', async () => {
            const c1 = (await callTool('create_entry', { content: 'b1', project_number: 1 }, personalDb)) as any
            const c2 = (await callTool('create_entry', { content: 'b2', project_number: 1 }, personalDb)) as any

            // Update c2 independently
            await callTool('update_entry', { entry_id: c2.entry.id, project_number: 1, content: 'b2 updated' }, personalDb)

            const batchUpdate = (await callTool(
                'batch_update_entries',
                {
                    updates: [
                        { entry_id: c1.entry.id, project_number: 1, expected_version: c1.entry.version, content: 'b1 new' },
                        { entry_id: c2.entry.id, project_number: 1, expected_version: c2.entry.version, content: 'b2 new (stale)' },
                    ],
                },
                personalDb
            )) as any

            expect(batchUpdate.success).toBe(false)
            expect(batchUpdate.code).toBe('AGGREGATE_ERROR')
            expect(batchUpdate.aggregated_errors[0]?.message).toContain('conflict')
        })
    })

    describe('team_batch_update_entries', () => {
        it('should fail team batch update if any expected_version is stale', async () => {
            const c1 = (await callTool('team_create_entry', { project_number: 1, content: 'tb1' }, personalDb, undefined, undefined, undefined, undefined, teamDb)) as any
            const c2 = (await callTool('team_create_entry', { project_number: 1, content: 'tb2' }, personalDb, undefined, undefined, undefined, undefined, teamDb)) as any

            await callTool('team_update_entry', { project_number: 1, entry_id: c2.entry.id, content: 'tb2 updated' }, personalDb, undefined, undefined, undefined, undefined, teamDb)

            const batchUpdate = (await callTool(
                'team_batch_update_entries',
                {
                    project_number: 1,
                    updates: [
                        { entry_id: c1.entry.id, expected_version: c1.entry.version, content: 'tb1 new' },
                        { entry_id: c2.entry.id, expected_version: c2.entry.version, content: 'tb2 new (stale)' },
                    ],
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(batchUpdate.success).toBe(false)
            expect(batchUpdate.code).toBe('AGGREGATE_ERROR')
            expect(batchUpdate.aggregated_errors[0]?.message).toContain('conflict')
        })
    })
})
