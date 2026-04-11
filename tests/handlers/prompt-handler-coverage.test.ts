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
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { execQuery, getPrompts, getPrompt } from '../../src/handlers/prompts/index.js'

describe('Prompt Handlers - Coverage', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-prompts-cov.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
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
        it('should throw for unknown prompt name', async () => {
            await expect(getPrompt('nonexistent_prompt', {}, db)).rejects.toThrow(
                'Prompt not found: nonexistent_prompt'
            )
        })

        it('should throw ConfigurationError if teamDb is missing for team-session-summary', async () => {
            await expect(getPrompt('team-session-summary', {}, db)).rejects.toThrow(
                'Team database not configured'
            )
        })

        it('should return messages for a valid prompt', async () => {
            const prompts = getPrompts()
            const firstName = (prompts[0] as { name: string }).name
            const result = await getPrompt(firstName, {}, db)
            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })
    })
})
