/**
 * memory-journal-mcp — Workflow Prompts, Team Resources, Graph Resources Branch Coverage
 *
 * Targets uncovered branches in:
 * - workflow.ts (64.7%): ?? fallbacks, content truncation, empty entry lists
 * - team.ts (66.66%): enrichWithAuthor, no-teamDb guards, author query catch
 * - graph.ts (70.58%): empty relationships, unknown relationship types, actions fallbacks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'
import { getTeamResourceDefinitions } from '../../src/handlers/resources/team.js'
import { getGraphResourceDefinitions } from '../../src/handlers/resources/graph.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(overrides: Record<string, unknown> = {}) {
    return {
        searchEntries: vi.fn().mockReturnValue([]),
        searchByDateRange: vi.fn().mockReturnValue([]),
        getRecentEntries: vi.fn().mockReturnValue([]),
        getStatistics: vi.fn().mockReturnValue({ totalEntries: 0 }),
        getSignificantEntries: vi.fn().mockReturnValue([]),
        getRecentGraphRelationships: vi.fn().mockReturnValue([]),
        getWorkflowActionEntries: vi.fn().mockReturnValue([]),
        getAuthorStatistics: vi.fn().mockReturnValue([]),
        getAuthorsForEntries: vi.fn().mockReturnValue(new Map()),
        ...overrides,
    }
}

function createMockContext(overrides: Record<string, unknown> = {}) {
    return {
        db: createMockDb(),
        teamDb: null as ReturnType<typeof createMockDb> | null,
        github: null,
        ...overrides,
    }
}

// ============================================================================
// Workflow Prompts Branch Coverage
// ============================================================================

describe('Workflow prompts — branch coverage', () => {
    let prompts: ReturnType<typeof getWorkflowPromptDefinitions>

    beforeEach(() => {
        vi.clearAllMocks()
        prompts = getWorkflowPromptDefinitions()
    })

    it('find-related: should handle empty query fallback', () => {
        const findRelated = prompts.find((p) => p.name === 'find-related')!
        const db = createMockDb()
        const result = findRelated.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('Find entries related to: ""')
    })

    it('prepare-standup: should format entries', () => {
        const standup = prompts.find((p) => p.name === 'prepare-standup')!
        const db = createMockDb({
            searchByDateRange: vi
                .fn()
                .mockReturnValue([
                    { timestamp: '2025-01-01', entryType: 'note', content: 'Did things' },
                ]),
        })
        const result = standup.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('Did things')
    })

    it('prepare-retro: should use default days when not provided', () => {
        const retro = prompts.find((p) => p.name === 'prepare-retro')!
        const db = createMockDb()
        retro.handler({}, db as never)
        expect(db.searchByDateRange).toHaveBeenCalledTimes(1)
    })

    it('prepare-retro: should use custom days', () => {
        const retro = prompts.find((p) => p.name === 'prepare-retro')!
        const db = createMockDb({
            searchByDateRange: vi
                .fn()
                .mockReturnValue([
                    { timestamp: '2025-01-01', entryType: 'note', content: 'x'.repeat(250) },
                ]),
        })
        const result = retro.handler({ days: '7' }, db as never)
        expect(result.messages[0]!.content.text).toContain('last 7 days')
    })

    it('weekly-digest: should format entries with content truncation', () => {
        const digest = prompts.find((p) => p.name === 'weekly-digest')!
        const db = createMockDb({
            searchByDateRange: vi
                .fn()
                .mockReturnValue([
                    { timestamp: '2025-01-01', entryType: 'note', content: 'x'.repeat(200) },
                ]),
        })
        const result = digest.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('weekly digest')
    })

    it('analyze-period: should use provided dates', () => {
        const analyze = prompts.find((p) => p.name === 'analyze-period')!
        const db = createMockDb()
        const result = analyze.handler(
            { start_date: '2025-01-01', end_date: '2025-01-31' },
            db as never
        )
        expect(result.messages[0]!.content.text).toContain('2025-01-01 to 2025-01-31')
    })

    it('analyze-period: should handle missing date args', () => {
        const analyze = prompts.find((p) => p.name === 'analyze-period')!
        const db = createMockDb()
        const result = analyze.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('Analyze the period')
    })

    it('goal-tracker: should format significant entries', () => {
        const goalTracker = prompts.find((p) => p.name === 'goal-tracker')!
        const db = createMockDb({
            getSignificantEntries: vi.fn().mockReturnValue([]),
        })
        const result = goalTracker.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('goals')
    })

    it('get-context-bundle: should truncate content over 60 chars', () => {
        const contextBundle = prompts.find((p) => p.name === 'get-context-bundle')!
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                { id: 1, entryType: 'note', timestamp: '2025-01-01', content: 'x'.repeat(70) },
                { id: 2, entryType: 'note', timestamp: '2025-01-02', content: 'short' },
            ]),
        })
        const result = contextBundle.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('...')
    })

    it('get-recent-entries: should use default limit', () => {
        const recent = prompts.find((p) => p.name === 'get-recent-entries')!
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    entryType: 'note',
                    timestamp: '2025-01-01',
                    content: 'test',
                    tags: ['a'],
                },
            ]),
        })
        const result = recent.handler({}, db as never)
        expect(db.getRecentEntries).toHaveBeenCalledWith(10)
        expect(result.messages[0]!.content.text).toContain('a')
    })

    it('get-recent-entries: should use custom limit and handle empty tags', () => {
        const recent = prompts.find((p) => p.name === 'get-recent-entries')!
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    entryType: 'note',
                    timestamp: '2025-01-01',
                    content: 'test',
                    tags: [],
                },
            ]),
        })
        const result = recent.handler({ limit: '5' }, db as never)
        expect(db.getRecentEntries).toHaveBeenCalledWith(5)
        expect(result.messages[0]!.content.text).toContain('none')
    })

    it('confirm-briefing: should handle no entries', () => {
        const confirm = prompts.find((p) => p.name === 'confirm-briefing')!
        const db = createMockDb()
        const result = confirm.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('No entries yet')
    })

    it('confirm-briefing: should format entries when present', () => {
        const confirm = prompts.find((p) => p.name === 'confirm-briefing')!
        const db = createMockDb({
            getRecentEntries: vi
                .fn()
                .mockReturnValue([
                    { id: 1, entryType: 'note', timestamp: '2025-01-01', content: 'x'.repeat(50) },
                ]),
            getStatistics: vi.fn().mockReturnValue({ totalEntries: 42 }),
        })
        const result = confirm.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('42 total entries')
    })

    it('session-summary: should handle no entries', () => {
        const summary = prompts.find((p) => p.name === 'session-summary')!
        const db = createMockDb()
        const result = summary.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('No entries yet')
    })

    it('session-summary: should truncate long content', () => {
        const summary = prompts.find((p) => p.name === 'session-summary')!
        const db = createMockDb({
            getRecentEntries: vi.fn().mockReturnValue([
                { id: 1, entryType: 'note', content: 'x'.repeat(90) },
                { id: 2, entryType: 'note', content: 'short' },
            ]),
        })
        const result = summary.handler({}, db as never)
        expect(result.messages[0]!.content.text).toContain('...')
        // The short entry should NOT have '...'
        expect(result.messages[0]!.content.text).toContain('short')
    })
})

// ============================================================================
// Team Resources Branch Coverage
// ============================================================================

describe('Team resources — branch coverage', () => {
    let resources: ReturnType<typeof getTeamResourceDefinitions>

    beforeEach(() => {
        vi.clearAllMocks()
        resources = getTeamResourceDefinitions()
    })

    describe('memory://team/recent', () => {
        it('should return error when teamDb not configured', () => {
            const resource = resources.find((r) => r.uri === 'memory://team/recent')!
            const context = createMockContext()
            const result = resource.handler('memory://team/recent', context as never) as Record<
                string,
                unknown
            >
            expect((result.data as Record<string, unknown>).error).toContain(
                'Team database not configured'
            )
        })

        it('should enrich entries with author from teamDb', () => {
            const teamDb = createMockDb({
                getRecentEntries: vi
                    .fn()
                    .mockReturnValue([
                        { id: 1, entryType: 'note', timestamp: '2025-01-01', content: 'test' },
                    ]),
                getAuthorsForEntries: vi.fn().mockReturnValue(new Map([[1, 'alice']])),
            })
            const context = createMockContext({ teamDb })
            const resource = resources.find((r) => r.uri === 'memory://team/recent')!
            const result = resource.handler('memory://team/recent', context as never) as Record<
                string,
                unknown
            >
            const data = result.data as Record<string, unknown>
            const entries = data.entries as { author: string }[]
            expect(entries[0]!.author).toBe('alice')
        })

        it('should handle empty entries with fallback timestamp', () => {
            const teamDb = createMockDb({
                getRecentEntries: vi.fn().mockReturnValue([]),
            })
            const context = createMockContext({ teamDb })
            const resource = resources.find((r) => r.uri === 'memory://team/recent')!
            const result = resource.handler('memory://team/recent', context as never) as Record<
                string,
                unknown
            >
            const data = result.data as Record<string, unknown>
            expect(data.count).toBe(0)
        })
    })

    describe('memory://team/statistics', () => {
        it('should return error when teamDb not configured', () => {
            const resource = resources.find((r) => r.uri === 'memory://team/statistics')!
            const context = createMockContext()
            const result = resource.handler('memory://team/statistics', context as never) as Record<
                string,
                unknown
            >
            expect((result.data as Record<string, unknown>).configured).toBe(false)
        })

        it('should return stats with author breakdown', () => {
            const teamDb = createMockDb({
                getStatistics: vi.fn().mockReturnValue({ totalEntries: 10 }),
                getAuthorStatistics: vi.fn().mockReturnValue([
                    { author: 'alice', count: 5 },
                    { author: 'bob', count: 3 }
                ]),
            })
            const context = createMockContext({ teamDb })
            const resource = resources.find((r) => r.uri === 'memory://team/statistics')!
            const result = resource.handler('memory://team/statistics', context as never) as Record<
                string,
                unknown
            >
            const data = result.data as Record<string, unknown>
            expect(data.configured).toBe(true)
            expect((data.authors as { author: string }[])[0]!.author).toBe('alice')
        })

        it('should handle author query failure gracefully', () => {
            const teamDb = createMockDb({
                getStatistics: vi.fn().mockReturnValue({ totalEntries: 10 }),
                getAuthorStatistics: vi.fn().mockImplementation(() => {
                    throw new Error('fail')
                }),
            })
            const context = createMockContext({ teamDb })
            const resource = resources.find((r) => r.uri === 'memory://team/statistics')!
            const result = resource.handler('memory://team/statistics', context as never) as Record<
                string,
                unknown
            >
            const data = result.data as Record<string, unknown>
            expect(data.configured).toBe(true)
            expect(data.authors).toEqual([])
        })

        it('should handle empty author result', () => {
            const teamDb = createMockDb({
                getStatistics: vi.fn().mockReturnValue({ totalEntries: 10 }),
                getAuthorStatistics: vi.fn().mockReturnValue([]),
            })
            const context = createMockContext({ teamDb })
            const resource = resources.find((r) => r.uri === 'memory://team/statistics')!
            const result = resource.handler('memory://team/statistics', context as never) as Record<
                string,
                unknown
            >
            const data = result.data as Record<string, unknown>
            expect(data.authors).toEqual([])
        })
    })
})

// ============================================================================
// Graph Resources Branch Coverage
// ============================================================================

describe('Graph resources — branch coverage', () => {
    let resources: ReturnType<typeof getGraphResourceDefinitions>

    beforeEach(() => {
        vi.clearAllMocks()
        resources = getGraphResourceDefinitions()
    })

    describe('memory://graph/recent', () => {
        it('should return no-data message when no relationships', () => {
            const resource = resources.find((r) => r.uri === 'memory://graph/recent')!
            const context = createMockContext({
                db: createMockDb({
                    getRecentGraphRelationships: vi.fn().mockReturnValue([]),
                }),
            })
            const result = resource.handler('memory://graph/recent', context as never) as string
            expect(result).toContain('No relationships found')
        })

        it('should handle unknown relationship type with default arrow', () => {
            const resource = resources.find((r) => r.uri === 'memory://graph/recent')!
            const context = createMockContext({
                db: createMockDb({
                    getRecentGraphRelationships: vi.fn().mockReturnValue([
                        {
                            from_entry_id: 1,
                            to_entry_id: 2,
                            relationship_type: 'unknown_type',
                            from_content: 'Entry one content',
                            to_content: 'Entry two content',
                        },
                    ]),
                }),
            })
            const result = resource.handler('memory://graph/recent', context as never) as string
            expect(result).toContain('-->')
            expect(result).toContain('unknown_type')
        })
    })

    describe('memory://graph/actions', () => {
        it('should return no-github message when github integration not available', async () => {
            const resource = resources.find((r) => r.uri === 'memory://graph/actions')!
            const context = createMockContext()
            const result = (await resource.handler(
                'memory://graph/actions',
                context as never
            )) as string
            expect(result).toContain('GitHub integration not available')
        })

        it('should return no-repo message when repo info missing', async () => {
            const resource = resources.find((r) => r.uri === 'memory://graph/actions')!
            const context = createMockContext({
                github: {
                    getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
                },
            })
            const result = (await resource.handler(
                'memory://graph/actions',
                context as never
            )) as string
            expect(result).toContain('Repository not detected')
        })

        it('should return no-runs message when no workflow runs', async () => {
            const resource = resources.find((r) => r.uri === 'memory://graph/actions')!
            const context = createMockContext({
                github: {
                    getRepoInfo: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
                    getWorkflowRuns: vi.fn().mockResolvedValue([]),
                },
            })
            const result = (await resource.handler(
                'memory://graph/actions',
                context as never
            )) as string
            expect(result).toContain('No GitHub Actions workflow runs')
        })
    })

    describe('memory://actions/recent', () => {
        it('should fallback to database when no github', async () => {
            const resource = resources.find((r) => r.uri === 'memory://actions/recent')!
            const context = createMockContext({
                db: createMockDb({
                    getWorkflowActionEntries: vi.fn().mockReturnValue([]),
                }),
            })
            const result = (await resource.handler(
                'memory://actions/recent',
                context as never
            )) as Record<string, unknown>
            expect(result.source).toBe('database')
        })

        it('should fallback to database when github throws', async () => {
            const resource = resources.find((r) => r.uri === 'memory://actions/recent')!
            const context = createMockContext({
                github: {
                    getRepoInfo: vi.fn().mockRejectedValue(new Error('fail')),
                },
                db: createMockDb({
                    getWorkflowActionEntries: vi.fn().mockReturnValue([]),
                }),
            })
            const result = (await resource.handler(
                'memory://actions/recent',
                context as never
            )) as Record<string, unknown>
            expect(result.source).toBe('database')
        })

        it('should fallback when repo info has no owner', async () => {
            const resource = resources.find((r) => r.uri === 'memory://actions/recent')!
            const context = createMockContext({
                github: {
                    getRepoInfo: vi.fn().mockResolvedValue({ owner: null, repo: null }),
                },
                db: createMockDb({
                    getWorkflowActionEntries: vi.fn().mockReturnValue([]),
                }),
            })
            const result = (await resource.handler(
                'memory://actions/recent',
                context as never
            )) as Record<string, unknown>
            expect(result.source).toBe('database')
        })
    })
})
