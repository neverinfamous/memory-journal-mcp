/**
 * memory-journal-mcp — Briefing GitHub Section Unit Tests
 *
 * Tests for buildGitHubSection and its internal fetch helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildGitHubSection } from '../../src/handlers/resources/core/briefing/github-section.js'

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

// Mock shared.ts helpers
vi.mock('../../src/handlers/resources/shared.js', async (importOriginal) => {
    const original = (await importOriginal()) as Record<string, unknown>
    return {
        ...original,
        resolveGitHubRepo: vi.fn().mockResolvedValue({
            owner: 'neverinfamous',
            repo: 'memory-journal-mcp',
            branch: 'main',
        }),
        isResourceError: vi.fn().mockReturnValue(false),
    }
})

// ============================================================================
// Shared mocks
// ============================================================================

function createMockGitHub(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        getWorkflowRuns: vi.fn().mockResolvedValue([
            { name: 'CI', status: 'completed', conclusion: 'success' },
            { name: 'CodeQL', status: 'completed', conclusion: 'success' },
        ]),
        getIssues: vi.fn().mockResolvedValue([
            { number: 1, title: 'Bug fix', state: 'open' },
            { number: 2, title: 'Feature request', state: 'open' },
        ]),
        getPullRequests: vi
            .fn()
            .mockResolvedValue([{ number: 10, title: 'Add feature', state: 'OPEN' }]),
        getMilestones: vi
            .fn()
            .mockResolvedValue([
                { title: 'v1.0', openIssues: 2, closedIssues: 8, dueOn: '2025-04-01T00:00:00Z' },
            ]),
        getRepoStats: vi.fn().mockResolvedValue({
            stars: 100,
            forks: 25,
        }),
        getTrafficData: vi.fn().mockResolvedValue({
            clones: { total: 500 },
            views: { total: 2000 },
        }),
        getCopilotReviewSummary: vi.fn().mockResolvedValue({
            state: 'approved',
            commentCount: 3,
        }),
        ...overrides,
    }
}

function defaultConfig(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        entryCount: 5,
        includeTeam: false,
        issueCount: 5,
        prCount: 5,
        workflowCount: 3,
        copilotReviews: false,
        prStatusBreakdown: false,
        workflowStatusBreakdown: false,
        ...overrides,
    }
}

// ============================================================================
// buildGitHubSection
// ============================================================================

describe('buildGitHubSection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return null when github is null', async () => {
        const result = await buildGitHubSection(null, defaultConfig() as never)
        expect(result).toBeNull()
    })

    it('should return null when github is undefined', async () => {
        const result = await buildGitHubSection(undefined, defaultConfig() as never)
        expect(result).toBeNull()
    })

    it('should return full GitHub context on success', async () => {
        const github = createMockGitHub()
        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result).toBeDefined()
        expect(result!.repo).toBe('neverinfamous/memory-journal-mcp')
        expect(result!.branch).toBe('main')
        expect(result!.ci).toBe('passing')
        expect(result!.openIssues).toBe(2)
        expect(result!.openPRs).toBe(1)
        expect(result!.milestones).toHaveLength(1)
        expect(result!.insights).toBeDefined()
        expect(result!.insights!.stars).toBe(100)
    })

    it('should return null when resolveGitHubRepo returns error', async () => {
        const { isResourceError } = await import('../../src/handlers/resources/shared.js')
        vi.mocked(isResourceError).mockReturnValueOnce(true)

        const github = createMockGitHub()
        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result).toBeNull()
    })

    // ========================================================================
    // CI Status
    // ========================================================================

    it('should report failing CI', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi
                .fn()
                .mockResolvedValue([{ name: 'CI', status: 'completed', conclusion: 'failure' }]),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.ci).toBe('failing')
    })

    it('should report pending CI for in-progress workflows', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi
                .fn()
                .mockResolvedValue([{ name: 'CI', status: 'in_progress', conclusion: null }]),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.ci).toBe('pending')
    })

    it('should report cancelled CI', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi
                .fn()
                .mockResolvedValue([{ name: 'CI', status: 'completed', conclusion: 'cancelled' }]),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.ci).toBe('cancelled')
    })

    it('should report unknown CI when no runs exist', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi.fn().mockResolvedValue([]),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.ci).toBe('unknown')
    })

    it('should handle CI fetch error gracefully', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi.fn().mockRejectedValue(new Error('API error')),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.ci).toBe('unknown')
    })

    // ========================================================================
    // Workflow Summary
    // ========================================================================

    it('should include workflow summary with breakdown enabled', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi.fn().mockResolvedValue([
                { name: 'CI', status: 'completed', conclusion: 'success' },
                { name: 'CodeQL', status: 'completed', conclusion: 'failure' },
                { name: 'Deploy', status: 'queued', conclusion: null },
            ]),
        })

        const config = defaultConfig({ workflowStatusBreakdown: true })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.workflowSummary).toBeDefined()
        expect(result!.workflowSummary!.passing).toBe(1)
        expect(result!.workflowSummary!.failing).toBe(1)
        expect(result!.workflowSummary!.pending).toBe(1)
    })

    it('should include per-workflow runs when workflowCount > 0', async () => {
        const github = createMockGitHub({
            getWorkflowRuns: vi.fn().mockResolvedValue([
                { name: 'CI', status: 'completed', conclusion: 'success' },
                { name: 'CodeQL', status: 'completed', conclusion: 'failure' },
            ]),
        })

        const config = defaultConfig({ workflowCount: 2 })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.workflowSummary).toBeDefined()
        expect(result!.workflowSummary!.runs).toHaveLength(2)
        expect(result!.workflowSummary!.runs![0]!.name).toBe('CI')
        expect(result!.workflowSummary!.runs![0]!.conclusion).toBe('success')
    })

    // ========================================================================
    // Issues & PRs
    // ========================================================================

    it('should include issue list when issueCount > 0', async () => {
        const github = createMockGitHub()
        const config = defaultConfig({ issueCount: 2 })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.openIssueList).toBeDefined()
        expect(result!.openIssueList!).toHaveLength(2)
    })

    it('should handle issues fetch error gracefully', async () => {
        const github = createMockGitHub({
            getIssues: vi.fn().mockRejectedValue(new Error('API error')),
            getPullRequests: vi.fn().mockRejectedValue(new Error('API error')),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.openIssues).toBe(0)
        expect(result!.openPRs).toBe(0)
    })

    it('should include PR status breakdown when enabled', async () => {
        const github = createMockGitHub({
            getPullRequests: vi.fn().mockResolvedValue([
                { number: 10, title: 'Feature A', state: 'OPEN' },
                { number: 11, title: 'Feature B', state: 'MERGED' },
                { number: 12, title: 'Feature C', state: 'CLOSED' },
            ]),
        })

        const config = defaultConfig({ prStatusBreakdown: true, prCount: 5 })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.prStatusSummary).toBeDefined()
        expect(result!.prStatusSummary!.open).toBeGreaterThanOrEqual(1)
        expect(result!.prStatusSummary!.merged).toBe(1)
        expect(result!.prStatusSummary!.closed).toBe(1)
    })

    // ========================================================================
    // Milestones
    // ========================================================================

    it('should include milestones with progress', async () => {
        const github = createMockGitHub()
        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.milestones).toHaveLength(1)
        expect(result!.milestones[0]!.title).toBe('v1.0')
        expect(result!.milestones[0]!.progress).toContain('%')
    })

    it('should handle milestones fetch error gracefully', async () => {
        const github = createMockGitHub({
            getMilestones: vi.fn().mockRejectedValue(new Error('API error')),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.milestones).toEqual([])
    })

    // ========================================================================
    // Insights
    // ========================================================================

    it('should include repo insights with traffic data', async () => {
        const github = createMockGitHub()
        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.insights).toBeDefined()
        expect(result!.insights!.stars).toBe(100)
        expect(result!.insights!.forks).toBe(25)
        expect(result!.insights!.clones14d).toBe(500)
        expect(result!.insights!.views14d).toBe(2000)
    })

    it('should handle missing repo stats gracefully', async () => {
        const github = createMockGitHub({
            getRepoStats: vi.fn().mockResolvedValue(null),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result!.insights).toBeUndefined()
    })

    it('should handle traffic data error gracefully', async () => {
        const github = createMockGitHub({
            getTrafficData: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
        })

        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        // Should still have stars/forks even without traffic
        expect(result!.insights).toBeDefined()
        expect(result!.insights!.stars).toBe(100)
        expect(result!.insights!.clones14d).toBeUndefined()
    })

    // ========================================================================
    // Copilot Reviews
    // ========================================================================

    it('should include copilot review stats when enabled', async () => {
        const github = createMockGitHub()
        const config = defaultConfig({ copilotReviews: true })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.copilotReviews).toBeDefined()
        expect(result!.copilotReviews!.reviewed).toBeGreaterThan(0)
        expect(result!.copilotReviews!.approved).toBeGreaterThan(0)
    })

    it('should omit copilot reviews when disabled', async () => {
        const github = createMockGitHub()
        const config = defaultConfig({ copilotReviews: false })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.copilotReviews).toBeUndefined()
    })

    it('should return undefined copilotReviews when no PRs have copilot reviews', async () => {
        const github = createMockGitHub({
            getCopilotReviewSummary: vi.fn().mockResolvedValue({
                state: 'none',
                commentCount: 0,
            }),
        })
        const config = defaultConfig({ copilotReviews: true })
        const result = await buildGitHubSection(github as never, config as never)

        expect(result!.copilotReviews).toBeUndefined()
    })

    it('should handle copilot reviews fetch error gracefully', async () => {
        const github = createMockGitHub({
            getCopilotReviewSummary: vi.fn().mockRejectedValue(new Error('Not found')),
        })
        const config = defaultConfig({ copilotReviews: true })

        // The entire copilot section should be undefined since the Promise.all catches
        const result = await buildGitHubSection(github as never, config as never)
        // Even if individual reviews fail, the overall section should still return
        expect(result).toBeDefined()
    })

    // ========================================================================
    // Top-level error
    // ========================================================================

    it('should return null on top-level error', async () => {
        const { resolveGitHubRepo } = await import('../../src/handlers/resources/shared.js')
        vi.mocked(resolveGitHubRepo).mockRejectedValueOnce(new Error('Network error'))

        const github = createMockGitHub()
        const result = await buildGitHubSection(github as never, defaultConfig() as never)

        expect(result).toBeNull()
    })
})
