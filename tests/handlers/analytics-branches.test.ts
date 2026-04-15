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
            activityTrend: {
                currentPeriod: '2025-W03',
                previousPeriod: '2025-W02',
                growthPercent: 15,
            },
            causalMetrics: { blocked_by: 1, resolved: 2, caused: 3 },
        }),
        _executeRawQueryUnsafe: vi.fn(),
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

            handler({
                group_by: 'month',
                start_date: '2025-01-01',
                end_date: '2025-01-31',
                project_breakdown: true,
            })

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
                getCrossProjectInsights: vi.fn().mockReturnValue({ projects: [], inactiveProjects: [] }),
            })
            const handler = getInsightsHandler(db)

            const result = handler({}) as Record<string, unknown>
            expect(result['project_count']).toBe(0)
            expect(result['message']).toContain('No projects found')
        })

        it('should filter by start_date and end_date', () => {
            const db = createMockDb({
                getCrossProjectInsights: vi.fn().mockReturnValue({ projects: [], inactiveProjects: [] }),
            })
            const handler = getInsightsHandler(db)

            handler({ start_date: '2025-01-01', end_date: '2025-03-31' })

            // First call should include both date params
            const mockFn = db.getCrossProjectInsights as ReturnType<typeof vi.fn>
            expect(mockFn).toHaveBeenCalledWith({
                startDate: '2025-01-01',
                endDate: '2025-03-31',
                minEntries: 3,
                inactiveThresholdDays: expect.any(Number)
            })
        })

        it('should compute project data with tags and distribution', () => {
            const db = createMockDb({
                getCrossProjectInsights: vi.fn().mockReturnValue({
                    projects: [
                        { project_number: 1, entry_count: 10, first_entry: '2025-01-01', last_entry: '2025-01-10', active_days: 5, top_tags: [{name: 'bug', count: 8}, {name: 'feature', count: 4}] },
                        { project_number: 2, entry_count: 5, first_entry: '2025-01-05', last_entry: '2025-01-08', active_days: 3, top_tags: [{name: 'docs', count: 3}] }
                    ],
                    inactiveProjects: [
                        { project_number: 2, last_entry_date: '2025-01-08' }
                    ]
                })
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
                getCrossProjectInsights: vi.fn().mockReturnValue({
                    projects: [
                        { project_number: 1, entry_count: 10, first_entry: '2025-01-01', last_entry: '2025-01-10', active_days: 5, top_tags: [] }
                    ],
                    inactiveProjects: []
                })
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
