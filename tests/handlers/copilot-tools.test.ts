/**
 * memory-journal-mcp — Copilot Tools Unit Tests
 *
 * Tests for getCopilotReviewTools handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Hoisted mocks
// ============================================================================

const { mockResolveOwnerRepo } = vi.hoisted(() => ({
    mockResolveOwnerRepo: vi.fn(),
}))

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/utils/error-helpers.js', () => ({
    formatHandlerError: vi.fn().mockImplementation((err: Error) => ({
        success: false,
        error: err.message,
    })),
}))

vi.mock('../../src/handlers/tools/github/helpers.js', () => ({
    resolveOwnerRepo: mockResolveOwnerRepo,
}))

import { getCopilotReviewTools } from '../../src/handlers/tools/github/copilot-tools.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockContext() {
    return {
        db: {},
        progress: null,
        github: {
            getCopilotReviewSummary: vi.fn().mockResolvedValue({
                prNumber: 42,
                state: 'approved',
                commentCount: 3,
                comments: [
                    { body: 'Use const here', path: 'src/index.ts', line: 10, isCopilot: true },
                    { body: 'Missing null check', path: 'src/utils.ts', line: 25, isCopilot: true },
                    { body: 'Good pattern', path: 'src/core.ts', line: 50, isCopilot: true },
                ],
            }),
        },
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('getCopilotReviewTools', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should define get_copilot_reviews tool', () => {
        const context = createMockContext()
        const tools = getCopilotReviewTools(context as never)

        expect(tools).toHaveLength(1)
        expect(tools[0]!.name).toBe('get_copilot_reviews')
        expect(tools[0]!.group).toBe('github')
    })

    it('should return Copilot review summary on success', async () => {
        const context = createMockContext()
        mockResolveOwnerRepo.mockResolvedValue({
            owner: 'neverinfamous',
            repo: 'memory-journal-mcp',
            detectedOwner: 'neverinfamous',
            detectedRepo: 'memory-journal-mcp',
            github: context.github,
        })

        const tools = getCopilotReviewTools(context as never)
        const handler = tools[0]!.handler

        const result = (await handler({ pr_number: 42 })) as Record<string, unknown>

        expect(result['prNumber']).toBe(42)
        expect(result['state']).toBe('approved')
        expect(result['commentCount']).toBe(3)
        expect(result['comments']).toHaveLength(3)
        expect((result['comments'] as Record<string, unknown>[])[0]!['body']).toBe('Use const here')
        expect(result['owner']).toBe('neverinfamous')
    })

    it('should return error response when GitHub not available', async () => {
        const context = createMockContext()
        mockResolveOwnerRepo.mockResolvedValue({
            error: true,
            response: { success: false, error: 'GitHub integration not available' },
        })

        const tools = getCopilotReviewTools(context as never)
        const handler = tools[0]!.handler

        const result = (await handler({ pr_number: 42 })) as Record<string, unknown>

        expect(result['success']).toBe(false)
        expect(result['error']).toContain('GitHub')
    })

    it('should handle handler errors via formatHandlerError', async () => {
        const context = createMockContext()
        mockResolveOwnerRepo.mockRejectedValue(new Error('Network failure'))

        const tools = getCopilotReviewTools(context as never)
        const handler = tools[0]!.handler

        const result = (await handler({ pr_number: 42 })) as Record<string, unknown>

        expect(result['success']).toBe(false)
        expect(result['error']).toContain('Network failure')
    })
})
