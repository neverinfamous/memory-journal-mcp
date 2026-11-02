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
    const testDbPath = './.test-output/vitest/test-prompts-cov.db'

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

        it('should throw ConfigurationError if teamDb is missing for team-session-summary', async () => {
            await expect(getPrompt('team-session-summary', {}, db)).rejects.toThrow(
                'Team database not configured'
            )
        })

        it('should return messages for a valid prompt', async () => {
            const prompts = getPrompts()
            const firstName = (prompts[0] as { name: string }).name
            const result = await getPrompt(firstName, { pr_number: '123' }, db)
            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })

        it('should cover all adversarial-* prompts in both default (copilot omitted) and copilot: "true" modes', async () => {
            const adversarialNames = [
                'adversarial-plan-review',
                'adversarial-audit-code-quality',
                'adversarial-audit-security',
                'adversarial-audit-performance',
                'adversarial-audit-seo',
                'adversarial-audit-skill',
                'adversarial-audit-workflow',
            ]

            for (const name of adversarialNames) {
                const defaultRes = await getPrompt(name, {}, db)
                const defaultText = defaultRes.messages[0]?.content.text ?? ''
                expect(defaultText).toContain('**Optional (Skip by default)**')
                expect(defaultText).toContain("opt-in (`copilot: 'true'`)")
                expect(defaultText).toContain('gh copilot -- -p')

                const enabledRes = await getPrompt(name, { copilot: 'true' }, db)
                const enabledText = enabledRes.messages[0]?.content.text ?? ''
                expect(enabledText).toContain('Run `gh copilot -- -p')
                expect(enabledText).not.toContain('**Optional (Skip by default)**')
            }
        })
    })
})
