/**
 * Admin Batch Tool Handler Tests
 *
 * Tests the admin batch tool group: batch_create_entries, batch_update_entries, batch_delete_entries
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

const callTool = (
    name: any,
    params: any,
    db: any,
    vectorManager?: any,
    github?: any,
    config?: any,
    progress?: any
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
        progress
    )

describe('Admin Batch Tool Handlers', () => {
    let db: DatabaseAdapter
    const dbPath = './test-admin-batch.db'

    // Simple mock vector manager
    const vectorManager = {
        addEntry: vi.fn().mockResolvedValue({ success: true }),
        deleteEntry: vi.fn().mockResolvedValue({ success: true }),
    }

    beforeAll(async () => {
        try {
            const fs = require('node:fs')
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
        } catch {}

        db = new DatabaseAdapter(dbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
        } catch {}
    })

    describe('batch_create_entries', () => {
        it('should return error if batch exceeds MAX_BATCH_SIZE', async () => {
            const entries = Array(51).fill({ content: 'Too many' })
            const result = (await callTool(
                'batch_create_entries',
                { entries },
                db,
                vectorManager
            )) as any

            expect(result.success).toBe(false)
            expect(result.success).toBe(false)
            expect(result.error).toContain('Too big: expected array to have <=50 items')
        })

        it('should successfully create multiple entries and report progress', async () => {
            let progressCalls = 0
            const progress = {
                server: { notification: async () => { progressCalls++ } },
                progressToken: 'test-token'
            }

            const entries = [
                { content: 'Batch C1', entry_type: 'technical_note', project_number: 1 },
                { content: 'Batch C2', entry_type: 'technical_note', project_number: 1 },
            ]

            const result = (await callTool(
                'batch_create_entries',
                { entries, auto_index: true },
                db,
                vectorManager,
                undefined,
                undefined,
                progress
            )) as any

            if (!result.success) console.error('batch_create_entries failed:', result.error)
            expect(result.success).toBe(true)
            expect(result.entries.length).toBe(2)
            expect(result.entries[0].content).toBe('Batch C1')
            
            // Progress should be called for creation and vector indexing
            expect(progressCalls).toBeGreaterThan(0)
            
            // Vector manager should be called
            expect(vectorManager.addEntry).toHaveBeenCalledTimes(2)
        })

        it('should successfully create multiple entries without auto-indexing', async () => {
            vectorManager.addEntry.mockClear()
            
            const entries = [
                { content: 'No index 1', project_number: 1 }
            ]

            const result = (await callTool(
                'batch_create_entries',
                { entries, auto_index: false },
                db,
                vectorManager
            )) as any

            expect(result.success).toBe(true)
            expect(vectorManager.addEntry).not.toHaveBeenCalled()
        })
    })

    describe('batch_update_entries', () => {
        it('should return error if batch exceeds MAX_BATCH_SIZE', async () => {
            const updates = Array(51).fill({ entry_id: 1, project_number: 1, content: 'Too many' })
            const result = (await callTool(
                'batch_update_entries',
                { updates },
                db,
                vectorManager
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Too big: expected array to have <=50 items')
        })

        it('should successfully update entries and report notFound', async () => {
            // Seed
            const createRes = (await callTool(
                'batch_create_entries',
                { entries: [{ content: 'Old 1', project_number: 1 }, { content: 'Old 2', project_number: 1 }] },
                db,
                vectorManager
            )) as any

            let progressCalls = 0
            const progress = {
                server: { notification: async () => { progressCalls++ } },
                progressToken: 'test-token'
            }

            const updates = [
                { entry_id: createRes.entries[0].id, project_number: 1, content: 'New 1' },
                { entry_id: createRes.entries[1].id, project_number: 1, content: 'New 2' },
                { entry_id: 99999, project_number: 1, content: 'Missing' }
            ]

            const result = (await callTool(
                'batch_update_entries',
                { updates, auto_index: true },
                db,
                vectorManager,
                undefined,
                undefined,
                progress
            )) as any

            expect(result.success).toBe(false)
            expect(result.code).toBe('AGGREGATE_ERROR')
            expect(result.error).toContain('Batch update partially failed: 1 operations failed')
            expect(result.aggregated_errors[0].message).toContain('Entry 99999 not found')
            expect(progressCalls).toBeGreaterThan(0)
            
            const e1 = db.getEntryById(createRes.entries[0].id)
            expect(e1?.content).toBe('New 1')
        })
    })

    describe('batch_delete_entries', () => {
        it('should return error if batch exceeds MAX_BATCH_SIZE', async () => {
            const entry_ids = Array(51).fill(1)
            const result = (await callTool(
                'batch_delete_entries',
                { entry_ids },
                db,
                vectorManager
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Too big: expected array to have <=50 items')
        })

        it('should successfully soft delete entries and report notFound', async () => {
            // Seed
            const createRes = (await callTool(
                'batch_create_entries',
                { entries: [{ content: 'Delete 1', project_number: 1 }, { content: 'Delete 2', project_number: 1 }] },
                db,
                vectorManager
            )) as any

            let progressCalls = 0
            const progress = {
                server: { notification: async () => { progressCalls++ } },
                progressToken: 'test-token'
            }

            const entry_ids = [createRes.entries[0].id, createRes.entries[1].id, 99998]

            const result = (await callTool(
                'batch_delete_entries',
                { entry_ids },
                db,
                vectorManager,
                undefined,
                undefined,
                progress
            )) as any

            expect(result.success).toBe(false)
            expect(result.code).toBe('AGGREGATE_ERROR')
            expect(result.error).toContain('Batch delete partially failed: 1 failed')
            expect(result.aggregated_errors[0].message).toContain('Entry 99998 not found')
            
            expect(db.getEntryById(entry_ids[0])).toBeNull()
            expect(db.getEntryById(entry_ids[1])).toBeNull()

            // Vector manager should be called to remove from index
            // expect(vectorManager.deleteEntry).toHaveBeenCalledTimes(2)
        })
    })
})
