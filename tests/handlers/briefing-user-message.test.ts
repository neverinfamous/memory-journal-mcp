/**
 * memory-journal-mcp — Briefing User Message Formatter Unit Tests
 *
 * Tests for the formatUserMessage function that builds the
 * markdown summary table displayed to the user.
 */

import { describe, it, expect } from 'vitest'
import { formatUserMessage } from '../../src/handlers/resources/core/briefing/user-message.js'

// ============================================================================
// Helpers
// ============================================================================

function baseOpts() {
    return {
        repoName: 'neverinfamous/memory-journal-mcp',
        branchName: 'main',
        ciStatus: 'passing',
        totalEntries: 42,
        latestPreview: '#1: Recent entry preview',
        github: null,
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('formatUserMessage', () => {
    it('should produce basic markdown table without GitHub', () => {
        const result = formatUserMessage(baseOpts())

        expect(result).toContain('📋 **Session Context Loaded**')
        expect(result).toContain('memory-journal-mcp')
        expect(result).toContain('main')
        expect(result).toContain('passing')
        expect(result).toContain('42 entries')
        expect(result).toContain('#1: Recent entry preview')
    })

    it('should include team DB row when teamTotalEntries is set', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            teamTotalEntries: 15,
        })

        expect(result).toContain('**Team DB**')
        expect(result).toContain('15 entries')
    })

    it('should NOT include team DB row when teamTotalEntries is undefined', () => {
        const result = formatUserMessage(baseOpts())
        expect(result).not.toContain('**Team DB**')
    })

    // ========================================================================
    // CI with workflow runs
    // ========================================================================

    it('should display workflow runs with icons when runs are provided', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 3,
                openPRs: 1,
                milestones: [],
                workflowSummary: {
                    passing: 2,
                    failing: 1,
                    pending: 0,
                    cancelled: 0,
                    runs: [
                        { name: 'CI', conclusion: 'success' },
                        { name: 'CodeQL', conclusion: 'failure' },
                    ],
                },
            },
        })

        expect(result).toContain('✅ CI')
        expect(result).toContain('❌ CodeQL')
    })

    it('should display CI counts when no individual runs', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                workflowSummary: {
                    passing: 3,
                    failing: 1,
                    pending: 2,
                    cancelled: 0,
                },
            },
        })

        expect(result).toContain('3 passing')
        expect(result).toContain('1 failing')
        expect(result).toContain('2 pending')
    })

    // ========================================================================
    // Issues
    // ========================================================================

    it('should include issue titles when openIssueList is provided', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 2,
                openPRs: 0,
                milestones: [],
                openIssueList: [
                    { number: 42, title: 'Fix bug' },
                    { number: 43, title: 'Add feature' },
                ],
            },
        })

        expect(result).toContain('**Issues**')
        expect(result).toContain('#42 Fix bug')
        expect(result).toContain('#43 Add feature')
    })

    it('should show issue count only when no issue list', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 5,
                openPRs: 0,
                milestones: [],
            },
        })

        expect(result).toContain('**Issues**')
        expect(result).toContain('5 open')
    })

    // ========================================================================
    // PRs
    // ========================================================================

    it('should include PR status summary when prStatusSummary is provided', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 3,
                milestones: [],
                prStatusSummary: { open: 2, merged: 5, closed: 1 },
            },
        })

        expect(result).toContain('**PRs**')
        expect(result).toContain('2 open')
        expect(result).toContain('5 merged')
        expect(result).toContain('1 closed')
    })

    it('should include PR titles when openPrList is provided (no status summary)', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 1,
                milestones: [],
                openPrList: [{ number: 10, title: 'Add OAuth', state: 'OPEN' }],
            },
        })

        expect(result).toContain('**PRs**')
        expect(result).toContain('#10 Add OAuth')
    })

    it('should show PR count only when no list or summary', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 7,
                milestones: [],
            },
        })

        expect(result).toContain('**PRs**')
        expect(result).toContain('7 open')
    })

    // ========================================================================
    // Milestones
    // ========================================================================

    it('should include milestones with progress and due dates', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [
                    { title: 'v1.0', progress: '75%', dueOn: '2025-03-15T00:00:00Z' },
                    { title: 'v2.0', progress: '25%', dueOn: null },
                ],
            },
        })

        expect(result).toContain('**Milestones**')
        expect(result).toContain('v1.0 (75%, due 2025-03-15)')
        expect(result).toContain('v2.0 (25%)')
    })

    it('should omit milestones row when empty', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
            },
        })

        expect(result).not.toContain('**Milestones**')
    })

    // ========================================================================
    // Insights
    // ========================================================================

    it('should include insights row with stars, forks, clones, and views', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                insights: {
                    stars: 120,
                    forks: 30,
                    clones14d: 500,
                    views14d: 2000,
                },
            },
        })

        expect(result).toContain('**Insights**')
        expect(result).toContain('⭐ 120 stars')
        expect(result).toContain('🍴 30 forks')
        expect(result).toContain('📦 500 clones')
        expect(result).toContain('👁️ 2000 views')
        expect(result).toContain('(14d)')
    })

    it('should omit insights row when stars and forks are null', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                insights: { stars: null, forks: null },
            },
        })

        expect(result).not.toContain('**Insights**')
    })

    // ========================================================================
    // Copilot Reviews
    // ========================================================================

    it('should include Copilot row with review stats', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                copilotReviews: {
                    reviewed: 5,
                    approved: 3,
                    changesRequested: 1,
                    totalComments: 12,
                },
            },
        })

        expect(result).toContain('**Copilot**')
        expect(result).toContain('5 reviewed')
        expect(result).toContain('3 approved')
        expect(result).toContain('1 changes requested')
        expect(result).toContain('(12 comments)')
    })

    it('should omit changes requested when zero', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                copilotReviews: {
                    reviewed: 2,
                    approved: 2,
                    changesRequested: 0,
                    totalComments: 0,
                },
            },
        })

        expect(result).toContain('**Copilot**')
        expect(result).not.toContain('changes requested')
        expect(result).not.toContain('comments')
    })

    // ========================================================================
    // Rules & Skills
    // ========================================================================

    it('should include rules file info', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            rulesFile: {
                path: '/path/to/.rules',
                name: '.rules',
                sizeKB: 4,
                lastModified: '2h ago',
            },
        })

        expect(result).toContain('**Rules**')
        expect(result).toContain('.rules')
        expect(result).toContain('4 KB')
        expect(result).toContain('2h ago')
    })

    it('should include skills directory info', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            skillsDir: {
                path: '/path/to/skills',
                count: 3,
                names: ['cloudflare', 'mcp-builder', 'next'],
            },
        })

        expect(result).toContain('**Skills**')
        expect(result).toContain('3 skills available')
    })

    it('should use singular "skill" for count of 1', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            skillsDir: {
                path: '/path/to/skills',
                count: 1,
                names: ['cloudflare'],
            },
        })

        expect(result).toContain('1 skill available')
        expect(result).not.toContain('1 skills')
    })
})
