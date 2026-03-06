/**
 * Prompt Handler Coverage Tests
 *
 * Tests for handlers/prompts/index.ts uncovered paths:
 * - execQuery with empty result set
 * - execQuery with multi-row results
 * - getPrompt with unknown name (throws)
 * - getPrompts listing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SqliteAdapter } from '../../src/database/SqliteAdapter.js'
import { execQuery, getPrompts, getPrompt } from '../../src/handlers/prompts/index.js'

describe('Prompt Handlers - Coverage', () => {
    let db: SqliteAdapter
    const testDbPath = './test-prompts-cov.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()
        // Seed entries for query tests
        db.createEntry({ content: 'Prompt test entry 1', tags: ['prompt-test'] })
        db.createEntry({ content: 'Prompt test entry 2', tags: ['prompt-test'] })
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
    // execQuery
    // ========================================================================

    describe('execQuery', () => {
        it('should return rows for a valid query', () => {
            const rows = execQuery(db, 'SELECT id, content FROM memory_journal LIMIT 2')
            expect(rows.length).toBe(2)
            expect(rows[0]).toHaveProperty('id')
            expect(rows[0]).toHaveProperty('content')
        })

        it('should return empty array for no-match query', () => {
            const rows = execQuery(
                db,
                "SELECT id FROM memory_journal WHERE content = 'nonexistent_xyz_12345'"
            )
            expect(rows).toEqual([])
        })

        it('should handle parameterized queries', () => {
            const rows = execQuery(
                db,
                'SELECT id, content FROM memory_journal WHERE content LIKE ?',
                ['%Prompt test%']
            )
            expect(rows.length).toBe(2)
        })

        it('should return empty array for query that returns no columns', () => {
            const rows = execQuery(db, 'SELECT id FROM memory_journal WHERE id = -1')
            expect(rows).toEqual([])
        })
    })

    // ========================================================================
    // getPrompts
    // ========================================================================

    describe('getPrompts', () => {
        it('should return all prompt definitions', () => {
            const prompts = getPrompts()
            expect(prompts.length).toBeGreaterThan(0)

            for (const p of prompts) {
                const prompt = p as { name: string; description: string }
                expect(typeof prompt.name).toBe('string')
                expect(typeof prompt.description).toBe('string')
            }
        })
    })

    // ========================================================================
    // getPrompt
    // ========================================================================

    describe('getPrompt', () => {
        it('should throw for unknown prompt name', () => {
            expect(() => getPrompt('nonexistent_prompt', {}, db)).toThrow('Unknown prompt')
        })

        it('should return messages for a valid prompt', () => {
            const prompts = getPrompts()
            const firstName = (prompts[0] as { name: string }).name
            const result = getPrompt(firstName, {}, db)
            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })
    })
})
