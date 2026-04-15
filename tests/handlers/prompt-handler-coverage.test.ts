/**
 * Prompt Handler Coverage Tests
 *
 * Tests for handlers/prompts/index.ts uncovered paths:
 * - getPrompt with unknown name
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { getPrompts, getPrompt } from '../../src/handlers/prompts/index.js'

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
            expect(() => getPrompt('nonexistent_prompt', {}, db)).toThrow(
                'Prompt not found: nonexistent_prompt'
            )
        })

        it('should throw ConfigurationError if teamDb is missing for team-session-summary', () => {
            expect(() => getPrompt('team-session-summary', {}, db)).toThrow(
                'Team database not configured'
            )
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
