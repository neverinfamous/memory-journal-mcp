/**
 * Prompt Handler Tests
 *
 * Tests the prompt listing and execution handlers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPrompts, getPrompt } from '../../src/handlers/prompts/index.js'
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js'

describe('Prompt Handlers', () => {
    let db: SqliteAdapter
    const testDbPath = './test-prompts.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()
        // Seed some data for prompts that read from the DB
        db.createEntry({ content: 'Test entry for prompts', tags: ['test-tag'] })
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath)
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // getPrompts
    // ========================================================================

    describe('getPrompts', () => {
        it('should return an array of prompt definitions', () => {
            const prompts = getPrompts()
            expect(Array.isArray(prompts)).toBe(true)
            expect(prompts.length).toBeGreaterThan(0)
        })

        it('should have name and description on each prompt', () => {
            const prompts = getPrompts()
            for (const prompt of prompts) {
                const p = prompt as { name: string; description: string }
                expect(typeof p.name).toBe('string')
                expect(p.name.length).toBeGreaterThan(0)
                expect(typeof p.description).toBe('string')
            }
        })

        it('should include known prompt names', () => {
            const prompts = getPrompts()
            const names = prompts.map((p) => (p as { name: string }).name)

            // At least some expected prompts should be present
            expect(names.length).toBeGreaterThan(5)
        })
    })

    // ========================================================================
    // getPrompt
    // ========================================================================

    describe('getPrompt', () => {
        it('should return messages for each known prompt', () => {
            const prompts = getPrompts()
            const names = prompts.map((p) => (p as { name: string }).name)

            for (const name of names) {
                const result = getPrompt(name, {}, db)
                expect(result.messages).toBeDefined()
                expect(Array.isArray(result.messages)).toBe(true)
                expect(result.messages.length).toBeGreaterThan(0)

                // Each message should have role and content
                for (const msg of result.messages) {
                    expect(msg.role).toBeDefined()
                    expect(msg.content).toBeDefined()
                }
            }
        })

        it('should throw for unknown prompt name', () => {
            expect(() => getPrompt('nonexistent_prompt_xyz', {}, db)).toThrow()
        })

        it('should return messages for analyze-period with date arguments', () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = getPrompt('analyze-period', { start_date: today, end_date: today }, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
            const text = (result.messages[0]?.content as { text: string }).text
            expect(text).toContain(today)
        })

        it('should return messages for find-related with query argument', () => {
            const result = getPrompt('find-related', { query: 'test' }, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
            const text = (result.messages[0]?.content as { text: string }).text
            expect(text).toContain('test')
        })

        it('should return messages for get-context-bundle prompt', () => {
            const result = getPrompt('get-context-bundle', {}, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })

        it('should return messages for goal-tracker prompt', () => {
            const result = getPrompt('goal-tracker', {}, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })

        it('should return messages for prepare-retro with days argument', () => {
            const result = getPrompt('prepare-retro', { days: '14' }, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })
    })
})
