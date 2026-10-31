/**
 * Extended Unit Tests for SQLite Database Adapter Operations:
 * - MembersManager (src/database/sqlite-adapter/members.ts)
 * - AliasManager (src/database/sqlite-adapter/aliases.ts)
 * - Importance Calculation & Batch Importance (src/database/sqlite-adapter/entries/importance.ts)
 * - VectorOperations (src/database/sqlite-adapter/vector-operations.ts)
 * - Anchors & Project Breakdown Statistics (src/database/sqlite-adapter/entries/anchors.ts, statistics.ts)
 * - Cursor Pagination Helpers (src/database/sqlite-adapter/entries/search/cursor.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { encodeCursor, decodeCursor } from '../../src/database/sqlite-adapter/entries/search/cursor.js'

describe('SQLite Database Extended Operations', () => {
    let tmpDir: string
    let dbPath: string
    let db: DatabaseAdapter

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-db-ext-test-'))
        dbPath = path.join(tmpDir, 'ext-test.db')
        db = new DatabaseAdapter(dbPath, {
            projectRegistry: {
                'my-registered-project': {
                    path: '/workspace/my-registered-project',
                    project_number: 77,
                },
            },
        })
        await db.initialize()
    })

    afterEach(() => {
        try {
            db.close()
        } catch {
            // ignore
        }
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    describe('Team Members & RBAC (src/database/sqlite-adapter/members.ts)', () => {
        it('should manage team members, roles, and RBAC resolution', () => {
            // Initially RBAC is inactive (0 members) -> resolveTeamRole returns 'admin'
            expect(db.getTeamMemberCount()).toBe(0)
            expect(db.isTeamRbacActive()).toBe(false)
            expect(db.resolveTeamRole('unknown-user')).toBe('admin')
            expect(db.listTeamMembers()).toEqual([])
            expect(db.getTeamMember('alice')).toBeNull()

            // Add member
            const alice = db.addTeamMember('alice', 'member', 'system', 'Alice Smith')
            expect(alice.author).toBe('alice')
            expect(alice.role).toBe('member')
            expect(alice.displayName).toBe('Alice Smith')
            expect(alice.addedBy).toBe('system')

            // Duplicate member throws
            expect(() => db.addTeamMember('alice', 'viewer')).toThrow(/already exists/i)

            // RBAC is now active
            expect(db.isTeamRbacActive()).toBe(true)
            expect(db.getTeamMemberCount()).toBe(1)
            expect(db.resolveTeamRole('alice')).toBe('member')
            expect(db.resolveTeamRole('stranger', 'denied')).toBeNull()
            expect(db.resolveTeamRole('stranger', 'viewer')).toBe('viewer')

            // Add second member and list
            db.addTeamMember('bob', 'viewer')
            const list = db.listTeamMembers()
            expect(list.length).toBe(2)

            // Update role
            const updated = db.updateTeamMemberRole('bob', 'admin')
            expect(updated?.role).toBe('admin')

            // Remove member
            expect(db.removeTeamMember('bob')).toBe(true)
            expect(db.getTeamMember('bob')).toBeNull()
        })
    })

    describe('Author Aliases & Consolidation (src/database/sqlite-adapter/aliases.ts)', () => {
        it('should add, list, resolve, consolidate, and remove author aliases', () => {
            db.applyTeamSchema()
            expect(db.listAuthorAliases()).toEqual([])
            expect(db.resolveAuthor('raw-user')).toBe('raw-user')
            expect(db.resolveAuthors([]).size).toBe(0)

            // Self-alias throws
            expect(() => db.addAuthorAlias('Chris', 'chris')).toThrow(/themselves/i)

            // Add aliases
            const alias1 = db.addAuthorAlias('chris-laptop', 'chris-canonical', 'admin')
            expect(alias1.alias).toBe('chris-laptop')
            expect(alias1.canonicalAuthor).toBe('chris-canonical')

            db.addAuthorAlias('chris-ci', 'chris-canonical')

            // Duplicate alias throws
            expect(() => db.addAuthorAlias('chris-laptop', 'other')).toThrow(/already exists/i)

            // List all and filtered by canonicalAuthor
            expect(db.listAuthorAliases().length).toBe(2)
            expect(db.listAuthorAliases('chris-canonical').length).toBe(2)
            expect(db.listAuthorAliases('nobody').length).toBe(0)

            // Resolve single and batch
            expect(db.resolveAuthor('CHRIS-LAPTOP')).toBe('chris-canonical')
            const batchMap = db.resolveAuthors(['CHRIS-LAPTOP', 'unmapped-user'])
            expect(batchMap.get('CHRIS-LAPTOP')).toBe('chris-canonical')
            expect(batchMap.get('unmapped-user')).toBe('unmapped-user')

            // Create entries with alias author and consolidate
            db.createEntry({
                content: 'Entry from laptop alias',
                author: 'chris-laptop',
            })
            const consolidated = db.consolidateAuthors('chris-canonical')
            expect(consolidated).toBe(1)

            // Remove alias
            expect(db.removeAuthorAlias('nonexistent')).toBe(false)
            expect(db.removeAuthorAlias('chris-laptop')).toBe(true)
        })
    })

    describe('Importance Calculation & Anchors (importance.ts, anchors.ts, statistics.ts)', () => {
        it('should compute single and batch importance scores with relationships and anchors', () => {
            // Nonexistent entry returns 0
            const missingImp = db.calculateImportance(999999)
            expect(missingImp.score).toBe(0)

            // Empty batch returns empty map
            expect(db.getEntriesByIdsWithImportance([]).size).toBe(0)
            expect(db.getEntriesByIdsWithImportance([999999]).size).toBe(0)

            // Create entries with significance, trustScore, impactScore, validationStatus, and anchors
            const e1 = db.createEntry({
                content: 'Core architectural decision',
                significanceType: 'architecture',
                impactScore: 0.9,
                trustScore: 0.9,
                validationStatus: 'passed',
                projectNumber: 77,
                anchors: [{ anchorPath: 'src/index.ts', anchorType: 'file' }],
            })

            const e2 = db.createEntry({
                content: 'Follow-up bug fix with failed validation',
                impactScore: 0.4,
                trustScore: 0.5,
                validationStatus: 'failed',
                projectNumber: 88,
                issueUrl: 'https://github.com/owner/fallback-repo/issues/12',
            })

            db.linkEntries(e2.id, e1.id, 'caused', 'Caused by decision')
            db.linkEntries(e1.id, e2.id, 'resolved', 'Resolved issue')

            // Verify anchors were inserted and update anchor status
            const anchors = db.getAnchorsByEntryId(e1.id)
            expect(anchors.length).toBe(1)
            expect(anchors[0]?.anchorPath).toBe('src/index.ts')

            // Calculate importance with pending anchor
            const impPending = db.calculateImportance(e1.id)
            expect(impPending.score).toBeGreaterThan(0)
            expect(impPending.breakdown.significance).toBeGreaterThan(0)
            expect(impPending.breakdown.relationships).toBeGreaterThan(0)
            expect(impPending.breakdown.causal).toBeGreaterThan(0)

            // Update anchor status to stale (rank 2 -> 0.8x) and invalidated (rank 1 -> 0.1x)
            if (anchors[0]) {
                db.updateAnchorStatus(anchors[0].id, 'stale')
                const impStale = db.calculateImportance(e1.id)
                expect(impStale.score).toBeLessThan(impPending.score)

                db.updateAnchorStatus(anchors[0].id, 'invalidated')
                const impInvalid = db.calculateImportance(e1.id)
                expect(impInvalid.score).toBeLessThan(impStale.score)
            }

            // Batch importance calculation
            const batchImp = db.getEntriesByIdsWithImportance([e1.id, e2.id])
            expect(batchImp.size).toBe(2)
            expect(batchImp.get(e1.id)?.importance.score).toBeDefined()
            expect(batchImp.get(e2.id)?.importance.score).toBeDefined()

            // Statistics with projectBreakdown (resolving project 77 from config and project 88 from URL)
            const stats = db.getStatistics('day', '2020-01-01', '2030-12-31', true)
            const breakdown = stats['projectBreakdown'] as {
                project_number: number
                name?: string
            }[]
            expect(Array.isArray(breakdown)).toBe(true)
            const p77 = breakdown.find((p) => p.project_number === 77)
            const p88 = breakdown.find((p) => p.project_number === 88)
            expect(p77?.name).toBe('my-registered-project')
            expect(p88?.name).toBe('fallback-repo')
        })
    })

    describe('VectorOperations (src/database/sqlite-adapter/vector-operations.ts)', () => {
        it('should manage vector metadata, vec_embeddings table, upsert, search, and cleanup', () => {
            // Before table exists, graceful fallbacks work
            expect(db.getVector(1)).toBeNull()
            expect(db.getVectorCount()).toBe(0)
            expect(db.cleanupStaleVectors()).toBe(0)
            expect(() => db.deleteVector(1)).not.toThrow()
            expect(() => db.clearVectors()).not.toThrow()

            // Metadata
            db.setVectorMetadata('model_name', 'test-model')
            expect(db.getVectorMetadata('model_name')).toBe('test-model')

            // Create vec table (4 dimensions for fast testing)
            db.createVecTable(4)

            const entry1 = db.createEntry({ content: 'First vector entry' })
            const entry2 = db.createEntry({ content: 'Second vector entry' })

            const vec1 = new Float32Array([1, 0, 0, 0])
            const vec2 = new Float32Array([0, 1, 0, 0])

            db.upsertVector(entry1.id, vec1)
            expect(db.getVectorCount()).toBe(1)

            const fetchedVec = db.getVector(entry1.id)
            expect(fetchedVec).not.toBeNull()
            expect(fetchedVec?.[0]).toBeCloseTo(1)

            // Batch upsertVectors
            db.upsertVectors([
                { entryId: entry1.id, embedding: new Float32Array([0.9, 0.1, 0, 0]) },
                { entryId: entry2.id, embedding: vec2 },
            ])
            expect(db.getVectorCount()).toBe(2)

            // Search vectors
            const hits = db.searchVectors(new Float32Array([1, 0, 0, 0]), 5)
            expect(hits.length).toBeGreaterThanOrEqual(1)
            expect(hits[0]?.entry_id).toBe(entry1.id)

            // Insert a stale vector for a nonexistent entry ID and run cleanupStaleVectors
            db.upsertVector(999999, vec2)
            expect(db.getVectorCount()).toBe(3)
            const cleaned = db.cleanupStaleVectors()
            expect(cleaned).toBe(1)
            expect(db.getVectorCount()).toBe(2)

            // Soft-delete entry2 (which automatically deletes its vector)
            db.deleteEntry(entry2.id)
            expect(db.getVectorCount()).toBe(1)

            // Delete single vector & clearVectors & dropVecTable
            db.deleteVector(entry1.id)
            expect(db.getVectorCount()).toBe(0)

            db.upsertVector(entry1.id, vec1)
            db.clearVectors()
            expect(db.getVectorCount()).toBe(0)

            db.dropVecTable()
            expect(db.getVectorCount()).toBe(0)
        })
    })

    describe('Cursor Pagination Helpers (src/database/sqlite-adapter/entries/search/cursor.ts)', () => {
        it('should encode and decode valid cursors and return null for invalid base64/JSON', () => {
            const encoded = encodeCursor({ offset: 25 })
            expect(decodeCursor(encoded)).toEqual({ offset: 25 })

            expect(decodeCursor('!!!not-valid-base64-json!!!')).toBeNull()
        })
    })
})
