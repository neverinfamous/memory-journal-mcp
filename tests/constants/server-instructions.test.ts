/**
 * Server Instructions Tests
 *
 * Tests the generateInstructions function at all instruction levels.
 */

import { describe, it, expect } from 'vitest'
import { generateInstructions } from '../../src/constants/ServerInstructions.js'

/** Minimal tool set for testing */
const TEST_TOOLS = new Set(['create_entry', 'search_entries', 'backup_journal'])

/** Minimal resources for testing */
const TEST_RESOURCES = [{ uri: 'memory://health', name: 'health', description: 'Health check' }]

/** Minimal prompts for testing */
const TEST_PROMPTS = [{ name: 'test-prompt', description: 'A test prompt' }]

describe('generateInstructions', () => {
    describe('essential level', () => {
        it('should return non-empty string', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result.length).toBeGreaterThan(0)
        })

        it('should include core behaviors', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).toContain('memory://briefing')
            expect(result).toContain('Session Start')
        })

        it('should not include tool parameter reference', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).not.toContain('Tool Parameter Reference')
        })
    })

    describe('standard level', () => {
        it('should include GitHub instructions', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'standard'
            )
            expect(result).toContain('GitHub')
        })

        it('should not include tool parameter reference', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'standard'
            )
            expect(result).not.toContain('Tool Parameter Reference')
        })
    })

    describe('full level', () => {
        it('should include tool parameter reference', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'full'
            )
            expect(result).toContain('Tool Parameter Reference')
        })

        it('should include active tools listing', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'full'
            )
            expect(result).toContain('Active Tools')
        })

        it('should include prompts section', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'full'
            )
            expect(result).toContain('Prompts')
            expect(result).toContain('test-prompt')
        })

        it('should include key resources section', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'full'
            )
            expect(result).toContain('Key Resources')
        })
    })

    describe('latest entry snapshot', () => {
        it('should include latest entry when provided', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                {
                    id: 42,
                    timestamp: '2026-02-27',
                    entryType: 'decision',
                    content: 'Important decision about architecture',
                },
                'essential'
            )
            expect(result).toContain('#42')
            expect(result).toContain('decision')
            expect(result).toContain('Important decision')
        })

        it('should truncate long content with ellipsis', () => {
            const longContent = 'A'.repeat(200)
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                {
                    id: 1,
                    timestamp: '2026-02-27',
                    entryType: 'note',
                    content: longContent,
                },
                'essential'
            )
            expect(result).toContain('...')
        })
    })

    describe('default level', () => {
        it('should default to standard level', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_RESOURCES, TEST_PROMPTS)
            // Standard includes GitHub but not tool parameter reference
            expect(result).toContain('GitHub')
            expect(result).not.toContain('Tool Parameter Reference')
        })
    })
})
