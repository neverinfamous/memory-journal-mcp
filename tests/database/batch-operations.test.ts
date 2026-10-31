/**
 * DatabaseAdapter Batch Operations Tests
 *
 * Functional tests for database adapter batch methods:
 * createEntries, updateEntries, deleteEntries
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'

describe('DatabaseAdapter Batch Operations', () => {
    let db: DatabaseAdapter
    const testDir = './test-adapter-batch-dir'
    const testDbPath = `${testDir}/test-adapter-batch.db`

    beforeAll(async () => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true })
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // createEntries
    // ========================================================================

    describe('createEntries', () => {
        it('should return empty array when given no inputs', () => {
            const results = db.createEntries([])
            expect(results.created).toEqual([])
        })

        it('should create multiple entries successfully', () => {
            const inputs = [
                { content: 'Batch 1', tags: ['b1', 'b2'], projectNumber: 1 },
                { content: 'Batch 2', tags: ['b2'], isPersonal: false, entryType: 'architecture_decision' as const },
                { content: 'Batch 3', projectNumber: 2 }
            ]

            const { created } = db.createEntries(inputs)
            expect(created.length).toBe(3)
            
            // Verify entries in db
            const e1 = db.getEntryById(created[0]!.id)
            expect(e1?.content).toBe('Batch 1')
            expect(e1?.tags).toEqual(['b1', 'b2'])
            expect(e1?.projectNumber).toBe(1)
            
            const e2 = db.getEntryById(created[1]!.id)
            expect(e2?.content).toBe('Batch 2')
            expect(e2?.tags).toEqual(['b2'])
            expect(e2?.isPersonal).toBe(false)
            expect(e2?.entryType).toBe('architecture_decision')
            
            const e3 = db.getEntryById(created[2]!.id)
            expect(e3?.content).toBe('Batch 3')
            expect(e3?.tags).toEqual([])
            expect(e3?.projectNumber).toBe(2)
        })

        it('should accept valid explicit timestamps', () => {
            const explicitTime = '2025-01-01T12:00:00.000Z'
            const { created } = db.createEntries([
                { content: 'Time test', timestamp: explicitTime }
            ])
            expect(created[0]?.timestamp).toBe(explicitTime)
        })

        it('should format YYYY-MM-DD dates to full ISO timestamp', () => {
            const dateStr = '2025-01-01'
            const { created } = db.createEntries([
                { content: 'Date test', timestamp: dateStr }
            ])
            expect(created[0]?.timestamp).toBe('2025-01-01T00:00:00.000Z')
        })

        it('should return error in array for invalid timestamp', () => {
            const { created, errors } = db.createEntries([{ content: 'Bad time', timestamp: 'not-a-dateT12:00:00' as any }])
            expect(created).toEqual([])
            expect(errors.length).toBe(1)
            expect(errors[0]?.error.message).toBe('Invalid timestamp format: not-a-dateT12:00:00. Expected an ISO 8601 date or timestamp.')
        })
    })

    // ========================================================================
    // updateEntries
    // ========================================================================

    describe('updateEntries', () => {
        it('should return empty results when given no updates', () => {
            const result = db.updateEntries([])
            expect(result.updated).toEqual([])
            expect(result.notFound).toEqual([])
        })

        it('should update multiple entries and report missing ones', () => {
            // Seed entries
            const { created } = db.createEntries([
                { content: 'Update me 1', tags: ['old-tag'] },
                { content: 'Update me 2' }
            ])

            const result = db.updateEntries([
                { id: created[0]!.id, content: 'Updated 1', tags: ['new-tag'] },
                { id: created[1]!.id, isPersonal: false, projectNumber: 99 },
                { id: 99999, content: 'Missing entry' },
                { id: 99998, content: 'Another missing' }
            ])

            expect(result.updated.length).toBe(2)
            expect(result.notFound.length).toBe(2)
            expect(result.notFound).toContain(99999)
            expect(result.notFound).toContain(99998)

            // Verify db state
            const e1 = db.getEntryById(created[0]!.id)
            expect(e1?.content).toBe('Updated 1')
            expect(e1?.tags).toEqual(['new-tag'])

            const e2 = db.getEntryById(created[1]!.id)
            expect(e2?.isPersonal).toBe(false)
            expect(e2?.projectNumber).toBe(99)
        })

        it('should handle updates where tags are not provided (keeps old tags)', () => {
            const { created } = db.createEntries([{ content: 'Keep tags', tags: ['kept-tag'] }])
            
            db.updateEntries([{ id: created[0]!.id, content: 'New content' }])
            
            const entry = db.getEntryById(created[0]!.id)
            expect(entry?.content).toBe('New content')
            expect(entry?.tags).toEqual(['kept-tag'])
        })
    })

    // ========================================================================
    // deleteEntries
    // ========================================================================

    describe('deleteEntries', () => {
        it('should return empty results when given no ids', () => {
            const result = db.deleteEntries([])
            expect(result.deleted).toEqual([])
            expect(result.notFound).toEqual([])
        })

        it('should soft delete multiple entries and report missing', () => {
            const { created } = db.createEntries([
                { content: 'Soft del 1' },
                { content: 'Soft del 2' },
                { content: 'Soft del 3' }
            ])

            const result = db.deleteEntries([created[0]!.id, created[1]!.id, 99999])

            expect(result.deleted).toContain(created[0]!.id)
            expect(result.deleted).toContain(created[1]!.id)
            expect(result.notFound).toContain(99999)
            expect(result.deleted.length).toBe(2)
            expect(result.notFound.length).toBe(1)

            // Verify they are softly deleted
            expect(db.getEntryById(created[0]!.id)).toBeNull()
            expect(db.getEntryById(created[1]!.id)).toBeNull()
            expect(db.getEntryByIdIncludeDeleted(created[0]!.id)).not.toBeNull()
            expect(db.getEntryByIdIncludeDeleted(created[1]!.id)).not.toBeNull()

            // Entry 3 should still be active
            expect(db.getEntryById(created[2]!.id)).not.toBeNull()
        })

        it('should permanently delete multiple entries', () => {
            const { created } = db.createEntries([
                { content: 'Hard del 1' },
                { content: 'Hard del 2' }
            ])

            const result = db.deleteEntries([created[0]!.id, created[1]!.id], true)

            expect(result.deleted.length).toBe(2)
            expect(result.notFound.length).toBe(0)

            // Verify they are completely gone
            expect(db.getEntryByIdIncludeDeleted(created[0]!.id)).toBeNull()
            expect(db.getEntryByIdIncludeDeleted(created[1]!.id)).toBeNull()
        })

        it('should handle deleting already deleted entries', () => {
            const { created } = db.createEntries([{ content: 'Double del' }])
            
            // Soft delete
            const r1 = db.deleteEntries([created[0]!.id])
            expect(r1.deleted).toContain(created[0]!.id)
            
            // Try soft deleting again - should report notFound
            const r2 = db.deleteEntries([created[0]!.id])
            expect(r2.notFound).toContain(created[0]!.id)
            expect(r2.deleted).not.toContain(created[0]!.id)
        })
    })
})
