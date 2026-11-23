/**
 * memory-journal-mcp — Briefing User Message Formatter Unit Tests
 *
 * Tests for the formatUserMessage function that builds the
 * hybrid markdown briefing (table + flat lines) displayed to the user.
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
        latestPreviews: ['#1: Recent entry preview'],
        github: null,
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('formatUserMessage', () => {
    it('should produce basic markdown table without GitHub', () => {
        const result = formatUserMessage(baseOpts())

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

        expect(result).toContain('Team: 15')
    })

    it('should NOT include team DB row when teamTotalEntries is undefined', () => {
        const result = formatUserMessage(baseOpts())
        expect(result).not.toContain('Team:')
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
        const githubLine = result.split('\n').find((l) => l.includes('**GitHub**')) ?? ''
        expect(githubLine.match(/<untrusted_remote_content>/g)).toHaveLength(1)
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

        expect(result).toContain('Issues:')
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

        expect(result).toContain('Issues:')
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

        expect(result).toContain('PRs:')
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

        expect(result).toContain('PRs:')
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

        expect(result).toContain('PRs:')
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

        expect(result).toContain('MS:')
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

        expect(result).not.toContain('MS:')
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
        expect(result).toContain('⭐ 120')
        expect(result).toContain('🍴 30')
        expect(result).toContain('📦 500')
        expect(result).toContain('👁️ 2000')
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

        expect(result).toContain('**Tracking**')
        expect(result).not.toContain('**Insights**')
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

        expect(result).toContain('**Tracking**')
        expect(result).not.toContain('**Insights**')
        expect(result).not.toContain('changes requested')
        expect(result).not.toContain('comments')
    })



    // ========================================================================
    // Git History
    // ========================================================================

    it('should include git history in Analytics', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            gitHistory: {
                commits: [
                    { hash: 'abc1234', category: 'Feature', entry: 'New cool feature', message: 'feat: add stuff' },
                    { hash: 'def5678', message: 'fix: annoying bug' }
                ]
            },
        })

        expect(result).toContain('**Git History**')
        // One shared untrusted fence, no hyperlinks, no tool tip (token budget)
        expect(result).toContain('Recent: <untrusted_remote_content>abc1234 feat: add stuff ¦ def5678 fix: annoying bug</untrusted_remote_content>')
        expect(result.match(/<untrusted_remote_content>/g)?.length ?? 0).toBeGreaterThan(0)
        expect(result).not.toContain('https://github.com/')
        expect(result).not.toContain('`get_commit_history`')
        expect(result).not.toContain('💡')
    })

    it('should render shared-fence journal rows and drop the summary hint when graph pivots are on', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            latestPreviews: ['#1 (note): <untrusted_remote_content>first</untrusted_remote_content>', '#2 (note): <untrusted_remote_content>a &amp; b</untrusted_remote_content>'],
            summaryPreviews: ['#3 (retrospective): <untrusted_remote_content>did - x</untrusted_remote_content>'],
            graphSummary: { totalRelationships: 5, causalMetrics: {}, topHubs: [] } as never,
            graphPivots: { windowDays: 14, degrees: {}, commitRefs: {}, activeThreads: [], recentEntries: 2, unlinkedEntries: 1 },
        })
        expect(result).toContain('Latest: <untrusted_remote_content>#1 (note): first ¦ #2 (note): a &amp; b</untrusted_remote_content>')
        expect(result).not.toContain('Entry:')
        // Post-fence rewriting of untrusted text is gone
        expect(result).toContain('did - x')
        expect(result).not.toContain('getEntryById')
        // 1/2 unlinked is below the ≥5-sample alert threshold: no ⚠️ on the row
        expect(result).toContain('Unlinked (14d): 1/2')
        expect(result).not.toContain('⚠️')
    })

    it('should surface dirty localGitStatus in GitHub row when worktree is not clean', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                localGitStatus: {
                    modified: 3,
                    untracked: 2,
                    isClean: false,
                    degraded: false,
                },
            },
        })

        expect(result).toContain('Dirty (3M, 2U)')
    })

    it('should omit git history when not provided', () => {
        const result = formatUserMessage(baseOpts())
        expect(result).not.toContain('**Git History**')
    })

    // ========================================================================
    // Graph Suppression
    // ========================================================================

    it('should suppress graph line when totalRelationships is 0', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            graphSummary: {
                totalRelationships: 0,
                density: 0,
                causalMetrics: {},
                topHubs: [],
            },
        })

        expect(result).not.toContain('**Graph**')
    })

    it('should include graph line when totalRelationships > 0', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            graphSummary: {
                totalRelationships: 15,
                density: 1.5,
                causalMetrics: { evolves_from: 8, implements: 7 },
                topHubs: [],
            },
        })

        expect(result).toContain('**Graph**')
        expect(result).toContain('15 relationships')
        expect(result).toContain('evolves_from: 8')
        expect(result).toContain('(use `visualize_relationships`)')
    })

    // ========================================================================
    // 0 / false Suppression Formatting
    // ========================================================================

    it('omits CI status and Tracking row when ciSuppressed, issuesSuppressed, prsSuppressed are true and milestones empty', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            ciStatus: 'unknown',
            ciSuppressed: true,
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'main',
                ci: 'unknown',
                ciSuppressed: true,
                issuesSuppressed: true,
                prsSuppressed: true,
                openIssues: 0,
                openPRs: 0,
                milestones: [],
            },
        })

        expect(result).toContain('**GitHub**')
        expect(result).not.toContain('unknown')
        expect(result).not.toContain('Issues:')
        expect(result).not.toContain('PRs:')
        expect(result).not.toContain('**Tracking**')
    })

    it('formats activePr without Pending Review or CI when reviewSuppressed and ciSuppressed are true', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'neverinfamous/memory-journal-mcp',
                branch: 'feat/test',
                ci: 'unknown',
                ciSuppressed: true,
                issuesSuppressed: true,
                openIssues: 0,
                openPRs: 1,
                milestones: [],
                activePr: {
                    number: 77,
                    title: 'Feat PR',
                    url: 'https://github.com/o/r/pull/77',
                    state: 'OPEN',
                    reviewSuppressed: true,
                    ciSuppressed: true,
                },
            },
        })

        expect(result).toContain('Current PR (#77): Feat PR')
        expect(result).not.toContain('Pending Review')
        expect(result).not.toContain('CI: Unknown')
    })

    it('omits Latest: No entries yet when entriesSuppressed is true', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            totalEntries: 42,
            latestPreviews: [],
            entriesSuppressed: true,
        })

        expect(result).toContain('42 entries')
        expect(result).not.toContain('Latest: No entries yet')
    })

    it('neutralizes markdown link breakout in workflow run names and unsafe GitHub URLs', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'org/repo',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                workflowSummary: {
                    passing: 2,
                    failing: 0,
                    pending: 0,
                    cancelled: 0,
                    runs: [
                        {
                            name: 'CI](https://evil.example)[ok',
                            conclusion: 'success',
                            url: 'https://github.com/org/repo/actions/runs/1',
                        },
                        {
                            name: 'UnsafeUrl',
                            conclusion: 'success',
                            url: 'https://github.com/org/repo/actions/runs/2"onclick=alert(1)',
                        },
                    ],
                },
            },
        })

        expect(result).not.toContain('](https://evil.example)')
        expect(result).not.toContain('&amp;#91;')
        expect(result).not.toContain('&amp;#93;')
        expect(result).toContain(
            '[CI)(https://evil.example)(ok](https://github.com/org/repo/actions/runs/1)'
        )
        expect(result).not.toContain('onclick=alert')
        const githubLine = result.split('\n').find((l) => l.includes('**GitHub**')) ?? ''
        expect(githubLine.match(/<untrusted_remote_content>/g)).toHaveLength(1)
    })

    it('suppresses Dirty badge when localGitStatus has error or degraded', () => {
        const withError = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'org/repo',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                localGitStatus: {
                    modified: 0,
                    untracked: 0,
                    isClean: false,
                    error: 'git failed',
                },
            },
        })
        const withDegraded = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'org/repo',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [],
                localGitStatus: {
                    modified: 0,
                    untracked: 0,
                    isClean: false,
                    degraded: true,
                },
            },
        })
        expect(withError).not.toContain('Dirty')
        expect(withDegraded).not.toContain('Dirty')
    })

    it('fences milestones under a single untrusted wrapper and omits hardcoded conf 1.00 from velocity', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            github: {
                repo: 'org/repo',
                branch: 'main',
                ci: 'passing',
                openIssues: 0,
                openPRs: 0,
                milestones: [
                    { title: 'v1.0', progress: '2/4 (50%)', dueOn: '2026-12-01' },
                    { title: 'v2.0', progress: '0/3 (0%)', dueOn: null },
                ],
            },
            gitHistory: {
                stats: { total: 5, highImpact: 2, lowImpact: 1, avgConfidence: 1.0 },
                commits: [{ hash: 'abc12345', message: 'feat: test commit' }],
            },
        })

        const trackingLine = result.split('\n').find((l) => l.includes('**Tracking**')) ?? ''
        expect(trackingLine.match(/<untrusted_remote_content>/g)).toHaveLength(1)
        expect(trackingLine).toContain('v1.0 (2/4 (50%), due 2026-12-01) ¦ v2.0 (0/3 (0%))')
        expect(result).toContain('Velocity (5): 2 high · 1 low')
        expect(result).not.toContain('conf 1.00')
    })

    it('suppresses write hints in readonly mode and strips asterisks from workspace display identifiers', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            isReadonly: true,
            workspaceId: 'ws*evil',
            totalEntries: 20,
            graphSummary: { totalRelationships: 0, density: 0, causalMetrics: {}, topHubs: [] },
            graphPivots: {
                windowDays: 14,
                degrees: {},
                commitRefs: {},
                activeThreads: [],
                recentEntries: 10,
                unlinkedEntries: 8,
            },
            analyticsInsights: {
                activityTrend: '10 entries',
                significanceSpike: null,
                staleProjects: [],
                topImportance: [],
                orphanRatio: 0.5,
                orphanCount: 10,
                totalEntries: 20,
            },
        })

        expect(result).toContain('**Graph**')
        expect(result).toContain('Unlinked (14d): 8/10 ⚠️')
        expect(result).not.toContain('link_entries')
        expect(result).not.toContain('mj.relationships.linkEntries')
        expect(result).not.toContain('optimize-journal')
        expect(result).toContain('Workspace: **ws_evil**')
        expect(result).not.toContain('ws*evil')
    })

    it('does not resolve Object.prototype properties as commit entry references', () => {
        const result = formatUserMessage({
            ...baseOpts(),
            graphPivots: {
                windowDays: 14,
                degrees: {},
                commitRefs: {},
                activeThreads: [],
                recentEntries: 1,
                unlinkedEntries: 0,
            },
            gitHistory: {
                commits: [{ hash: 'toString', message: 'feat: proto check' }],
            },
        })

        expect(result).toContain('toString feat: proto check')
        expect(result).not.toContain('→#')
    })
})
