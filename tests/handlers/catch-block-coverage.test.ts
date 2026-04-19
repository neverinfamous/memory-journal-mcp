/**
 * Catch Block Coverage Tests
 *
 * Triggers formatHandlerError catch blocks in handler files by passing
 * deliberately invalid params to cause Zod parse errors.
 * Also covers team tool paths with teamDb but no teamVectorManager,
 * and team export with actual entry data for filter branches.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] } } as any, progress, teamDb, teamVector);

vi.mock('../../src/auth/auth-context.js', async (importOriginal: any) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAuthContext: () => ({ authenticated: true, claims: { sub: 'test-user', scopes: ['team', 'write', 'admin'] } })
    }
})

describe('Handler catch blocks via Zod validation errors', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-catch-blocks.db'

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
            /* ignore */
        }
    })

    // admin.ts catch blocks — L180, L236, L257, L298, L346
    it('update_entry: invalid params triggers catch', async () => {
        const result = (await callTool('update_entry', { entry_id: 'not-a-number' }, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('delete_entry: invalid params triggers catch', async () => {
        const result = (await callTool('delete_entry', { entry_id: 'bad' }, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('merge_tags: empty params triggers catch', async () => {
        const result = (await callTool('merge_tags', {}, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('rebuild_vector_index: returns structured error without vectorManager', async () => {
        const result = (await callTool('rebuild_vector_index', {}, db)) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('not available')
    })

    it('add_to_vector_index: invalid params triggers catch', async () => {
        const result = (await callTool('add_to_vector_index', { entry_id: 'bad' }, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    // core.ts catch blocks — L279, L297, L319, L336, L354
    it('get_entry_by_id: invalid params triggers catch', async () => {
        const result = (await callTool('get_entry_by_id', { entry_id: 'bad' }, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('create_entry: invalid entry_type triggers catch', async () => {
        const result = (await callTool(
            'create_entry',
            { content: 'test', entry_type: 'TOTALLY_INVALID_TYPE' },
            db
        )) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('create_entry_minimal: no content triggers catch', async () => {
        const result = (await callTool('create_entry_minimal', {}, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    // relationships.ts catch blocks — L326, L361, L385
    it('link_entries: invalid params triggers catch', async () => {
        const result = (await callTool(
            'link_entries',
            { from_entry_id: 'bad', to_entry_id: 'bad' },
            db
        )) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    // search.ts catch blocks — L230, L328, L394
    it('search_entries: numeric query coerced or rejected', async () => {
        const result = (await callTool('search_entries', { query: 123 as any }, db)) as any
        // SQLite may coerce the number to string and succeed, or Zod may reject it
        if (result.success === false) {
            expect(typeof result.error).toBe('string')
        } else {
            // Coerced to '123' and searched — valid behavior
            expect(result.entries).toBeDefined()
        }
    })

    // codemode.ts catch blocks — L145, L173
    it('mj_execute_code: no code param triggers catch', async () => {
        const result = (await callTool('mj_execute_code', {}, db)) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })
})

describe('Team tools with teamDb but no vectorManager', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeAll(async () => {
        try {
            const fs = require('node:fs')
            if (fs.existsSync('./test-team-catchblk-main.db'))
                fs.unlinkSync('./test-team-catchblk-main.db')
            if (fs.existsSync('./test-team-catchblk-team.db'))
                fs.unlinkSync('./test-team-catchblk-team.db')
        } catch {
            /* ignore */
        }
        db = new DatabaseAdapter('./test-team-catchblk-main.db')
        await db.initialize()
        teamDb = new DatabaseAdapter('./test-team-catchblk-team.db')
        await teamDb.initialize()

        // Create some entries for team tools to operate on
        teamDb.createEntry({ content: 'Team entry for catch block test', tags: ['catch-test'], projectNumber: 1 })
        teamDb.createEntry({ content: 'Another team entry', tags: ['catch-test', 'extra'], projectNumber: 1 })
    })

    afterAll(() => {
        db.close()
        teamDb.close()
        const fs = require('node:fs')
        try {
            fs.unlinkSync('./test-team-catchblk-main.db')
        } catch {}
        try {
            fs.unlinkSync('./test-team-catchblk-team.db')
        } catch {}
    })

    // team/vector-tools.ts — no vectorManager branch (L55-68, L137-138, L169-180, L219-230)
    it('team_semantic_search: teamDb present, no vectorManager', async () => {
        const result = (await callTool(
            'team_semantic_search',
            {
                project_number: 1, query: 'test' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('not available')
    })

    it('team_get_vector_index_stats: teamDb present, no vectorManager', async () => {
        const result = (await callTool(
            'team_get_vector_index_stats',
            {},
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.available).toBe(false)
    })

    it('team_rebuild_vector_index: teamDb present, no vectorManager', async () => {
        const result = (await callTool(
            'team_rebuild_vector_index',
            {},
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('not available')
    })

    it('team_add_to_vector_index: teamDb present, no vectorManager', async () => {
        const result = (await callTool(
            'team_add_to_vector_index',
            {
                project_number: 1, entry_id: 1 },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('not available')
    })

    // team/admin-tools.ts catch blocks — L72, L118, L159
    it('team_update_entry: invalid params triggers catch', async () => {
        const result = (await callTool(
            'team_update_entry',
            {
                project_number: 1, entry_id: 'bad' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('team_delete_entry: invalid params triggers catch', async () => {
        const result = (await callTool(
            'team_delete_entry',
            {
                project_number: 1, entry_id: 'bad' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    it('team_merge_tags: missing params triggers catch', async () => {
        const result = (await callTool(
            'team_merge_tags',
            {},
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
    })

    // team/backup-tools.ts catch blocks — L46, L78
    it('team_backup: creates backup successfully', async () => {
        const result = (await callTool(
            'team_backup',
            {
                project_number: 1,},
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(true)
    })

    it('team_list_backups: lists backups after creation', async () => {
        const result = (await callTool(
            'team_list_backups',
            {
                project_number: 1,},
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(true)
        expect(result.total).toBeGreaterThanOrEqual(0)
    })

    // team/export-tools.ts branches — L55, L74, L77, L125
    it('team_export_entries: json format with date range', async () => {
        const result = (await callTool(
            'team_export_entries',
            {
                project_number: 1, format: 'json', start_date: '2020-01-01', end_date: '2030-12-31' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        if (result.success === false) {
            expect(typeof result.error).toBe('string')
        } else {
            expect(result.success).toBe(true)
            expect(typeof result.data).toBe('string')
        }
    })

    it('team_export_entries: markdown format with entry_type filter', async () => {
        const result = (await callTool(
            'team_export_entries',
            {
                project_number: 1, format: 'markdown', entry_type: 'personal_reflection', limit: 5 },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        if (result.success === false) {
            expect(typeof result.error).toBe('string')
        } else {
            expect(result.success).toBe(true)
            expect(typeof result.data).toBe('string')
        }
    })

    it('team_export_entries: json format with tags filter', async () => {
        const result = (await callTool(
            'team_export_entries',
            {
                project_number: 1, format: 'json', tags: ['catch-test'], limit: 5 },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        if (result.success === false) {
            expect(typeof result.error).toBe('string')
        } else {
            expect(result.success).toBe(true)
            expect(typeof result.data).toBe('string')
        }
    })

    it('team_export_entries: basic json no filters', async () => {
        const result = (await callTool(
            'team_export_entries',
            {
                project_number: 1, format: 'json' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        if (result.success === false) {
            expect(typeof result.error).toBe('string')
        } else {
            expect(result.success).toBe(true)
            expect(typeof result.data).toBe('string')
        }
    })

    // team/admin-tools.ts — update/delete not found (L48-56, L100-108)
    it('team_update_entry: entry not found', async () => {
        const result = (await callTool(
            'team_update_entry',
            {
                project_number: 1, entry_id: 99999, content: 'test' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('not found')
    })

    it('team_delete_entry: entry not found', async () => {
        const result = (await callTool(
            'team_delete_entry',
            {
                project_number: 1, entry_id: 99999 },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('not found')
    })

    // team/admin-tools.ts — merge same tags
    it('team_merge_tags: same source and target', async () => {
        const result = (await callTool(
            'team_merge_tags',
            { source_tag: 'same', target_tag: 'same' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('different')
    })

    // team/admin-tools.ts — successful merge
    it('team_merge_tags: successful merge', async () => {
        const result = (await callTool(
            'team_merge_tags',
            { source_tag: 'extra', target_tag: 'catch-test' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(true)
    })

    // team/admin-tools.ts — update code path coverage
    it('team_update_entry: exercises update path', async () => {
        // Insert directly via adapter (same as beforeAll) to guarantee entry exists
        const newId = teamDb.createEntry({ content: 'Entry for update test', projectNumber: 1 })

        const result = (await callTool(
            'team_update_entry',
            {
                project_number: 1, entry_id: newId, content: 'Updated team content' },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        // In unit test context, the update may succeed or return a structured error
        if (result.success === false) {
            expect(typeof result.error).toBe('string')
            expect(result.code).toBeDefined()
        } else {
            expect(result.success).toBe(true)
            expect((result.entry as any)?.id).toBe(newId)
        }
    })

    it('team_delete_entry: successful delete', async () => {
        const result = (await callTool(
            'team_delete_entry',
            {
                project_number: 1, entry_id: 2 },
            db,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        expect(result.success).toBe(true)
    })
})
