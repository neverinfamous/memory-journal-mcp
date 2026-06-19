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
        searchEntries: vi.fn().mockReturnValue({ entries: [] }),
        searchByDateRange: vi.fn().mockReturnValue({ entries: [] }),
        getRecentEntries: vi.fn().mockReturnValue({ entries: [] }),
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

    it('time-period-analysis: should format standup entries', () => {
        const analysis = prompts.find((p) => p.name === 'time-period-analysis')!
        const db = createMockDb()
        const result = analysis.handler({ period_type: 'standup' }, db as never)
        expect(result.messages[0]!.content.text).toContain('standup')
    })

    it('time-period-analysis: should use provided dates for custom period', () => {
        const analysis = prompts.find((p) => p.name === 'time-period-analysis')!
        const db = createMockDb()
        const result = analysis.handler(
            { period_type: 'custom', start_date: '2025-01-01', end_date: '2025-01-31' },
            db as never
        )
        expect(result.messages[0]!.content.text).toContain('2025-01-01 to 2025-01-31')
    })

    it('time-period-analysis: should handle missing date args for custom', () => {
        const analysis = prompts.find((p) => p.name === 'time-period-analysis')!
        const db = createMockDb()
        const result = analysis.handler({ period_type: 'custom' }, db as never)
        expect(result.messages[0]!.content.text).toContain('Analyze the period')
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
            getRecentEntries: vi.fn().mockReturnValue({ entries: [
                { id: 1, entryType: 'note', content: 'x'.repeat(90) },
                { id: 2, entryType: 'note', content: 'short' },
            ]}),
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
                    .mockReturnValue({ entries: [
                        { id: 1, entryType: 'note', timestamp: '2025-01-01', content: 'test' },
                    ]}),
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
                getRecentEntries: vi.fn().mockReturnValue({ entries: [] }),
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
                    { author: 'bob', count: 3 },
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
