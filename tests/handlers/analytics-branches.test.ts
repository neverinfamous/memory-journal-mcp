/**
 * memory-journal-mcp — Analytics Tools Branch Coverage Tests
 *
 * Targeted tests for uncovered branches in get_cross_project_insights:
 * date range filtering, empty results, tags, inactive detection, error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/error-helpers.js', () => ({
    formatHandlerError: vi.fn().mockImplementation((err: Error) => ({
        success: false,
        error: err.message,
    })),
}))

import { getAnalyticsTools } from '../../src/handlers/tools/analytics.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        getStatistics: vi.fn().mockReturnValue({
            totalEntries: 100,
            entriesByType: { note: 50, bug_fix: 30, planning: 20 },
            entriesByPeriod: [{ period: '2025-W03', count: 10 }],
            decisionDensity: [{ period: '2025-W03', significantCount: 2 }],
            relationshipComplexity: { totalRelationships: 5, avgPerEntry: 0.05 },
            activityTrend: { currentPeriod: '2025-W03', previousPeriod: '2025-W02', growthPercent: 15 },
            causalMetrics: { blocked_by: 1, resolved: 2, caused: 3 },
        }),
        executeRawQuery: vi.fn(),
        ...overrides,
    }
}

function getInsightsHandler(db: ReturnType<typeof createMockDb>) {
    const tools = getAnalyticsTools({ db, progress: null } as never)
    return tools.find((t) => t.name === 'get_cross_project_insights')!.handler
}

function getStatisticsHandler(db: ReturnType<typeof createMockDb>) {
    const tools = getAnalyticsTools({ db, progress: null } as never)
    return tools.find((t) => t.name === 'get_statistics')!.handler
}

// ============================================================================
// Tests
// ============================================================================

describe('analytics tools — branch coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ========================================================================
    // get_statistics branches
    // ========================================================================

    describe('get_statistics', () => {
        it('should pass start_date and end_date to db.getStatistics', () => {
            const db = createMockDb()
            const handler = getStatisticsHandler(db)

            handler({ group_by: 'month', start_date: '2025-01-01', end_date: '2025-01-31', project_breakdown: true })

            expect(db.getStatistics).toHaveBeenCalledWith('month', '2025-01-01', '2025-01-31', true)
        })

        it('should handle error with formatHandlerError', () => {
            const db = createMockDb({
                getStatistics: vi.fn().mockImplementation(() => {
                    throw new Error('db error')
                }),
            })
            const handler = getStatisticsHandler(db)

            const result = handler({}) as Record<string, unknown>
            expect(result['success']).toBe(false)
        })
    })

    // ========================================================================
    // get_cross_project_insights branches
    // ========================================================================

    describe('get_cross_project_insights', () => {
        it('should return empty result when no projects match', () => {
            const db = createMockDb({
                executeRawQuery: vi.fn().mockReturnValue([{ columns: [], values: [] }]),
            })
            const handler = getInsightsHandler(db)

            const result = handler({}) as Record<string, unknown>
            expect(result['project_count']).toBe(0)
            expect(result['message']).toContain('No projects found')
        })

        it('should filter by start_date and end_date', () => {
            const db = createMockDb({
                executeRawQuery: vi.fn().mockReturnValue([{ columns: [], values: [] }]),
            })
            const handler = getInsightsHandler(db)

            handler({ start_date: '2025-01-01', end_date: '2025-03-31' })

            // First call should include both date params
            const firstCall = db.executeRawQuery.mock.calls[0] as [string, unknown[]]
            expect(firstCall[0]).toContain('DATE(timestamp) >= DATE(?)')
            expect(firstCall[0]).toContain('DATE(timestamp) <= DATE(?)')
            expect(firstCall[1]).toContain('2025-01-01')
            expect(firstCall[1]).toContain('2025-03-31')
        })

        it('should compute project data with tags and distribution', () => {
            const db = createMockDb({
                executeRawQuery: vi
                    .fn()
                    // 1st call: project stats
                    .mockReturnValueOnce([
                        {
                            columns: ['project_number', 'entry_count', 'first_entry', 'last_entry', 'active_days'],
                            values: [
                                [1, 10, '2025-01-01', '2025-01-10', 5],
                                [2, 5, '2025-01-05', '2025-01-08', 3],
                            ],
                        },
                    ])
                    // 2nd call: tags per project
                    .mockReturnValueOnce([
                        {
                            columns: ['project_number', 'name', 'count'],
                            values: [
                                [1, 'bug', 8],
                                [1, 'feature', 4],
                                [2, 'docs', 3],
                            ],
                        },
                    ])
                    // 3rd call: inactive projects
                    .mockReturnValueOnce([
                        {
                            columns: ['project_number', 'last_entry_date'],
                            values: [[2, '2025-01-08']],
                        },
                    ]),
            })
            const handler = getInsightsHandler(db)

            const result = handler({}) as Record<string, unknown>

            expect(result['project_count']).toBe(2)
            expect(result['total_entries']).toBe(15)

            const projects = result['projects'] as Record<string, unknown>[]
            expect(projects[0]!['top_tags']).toHaveLength(2)

            const distribution = result['time_distribution'] as Record<string, unknown>[]
            expect(distribution[0]!['percentage']).toBe('66.7')

            const inactive = result['inactive_projects'] as Record<string, unknown>[]
            expect(inactive).toHaveLength(1)
            expect(inactive[0]!['project_number']).toBe(2)
        })

        it('should handle missing tag results gracefully', () => {
            const db = createMockDb({
                executeRawQuery: vi
                    .fn()
                    .mockReturnValueOnce([
                        {
                            columns: ['project_number', 'entry_count', 'first_entry', 'last_entry', 'active_days'],
                            values: [[1, 10, '2025-01-01', '2025-01-10', 5]],
                        },
                    ])
                    // Tags: no results
                    .mockReturnValueOnce([])
                    // Inactive: no results
                    .mockReturnValueOnce([]),
            })
            const handler = getInsightsHandler(db)

            const result = handler({}) as Record<string, unknown>

            const projects = result['projects'] as Record<string, unknown>[]
            expect(projects[0]!['top_tags']).toEqual([])
            expect(result['inactive_projects']).toEqual([])
        })

        it('should handle Zod validation error', () => {
            const db = createMockDb()
            const handler = getInsightsHandler(db)

            // Invalid date format triggers Zod error in handler
            const result = handler({ start_date: 'not-a-date' }) as Record<string, unknown>
            expect(result['success']).toBe(false)
        })
    })
})
