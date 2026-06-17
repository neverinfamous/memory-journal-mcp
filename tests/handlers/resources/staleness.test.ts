import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getStalenessResourceDefinitions } from '../../../src/handlers/resources/staleness.js'
import type { ResourceContext } from '../../../src/handlers/resources/shared.js'

describe('Staleness Resources', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = process.env
        process.env = {
            ...originalEnv,
            STALENESS_ACTIVE_HOURS: '24',
            STALENESS_RECENT_DAYS: '7',
            STALENESS_STALE_DAYS: '30'
        }
    })

    afterEach(() => {
        process.env = originalEnv
    })

    describe('memory://staleness', () => {
        it('should correctly group projects by staleness thresholds', () => {
            const now = Date.now()
            const activeTime = new Date(now - 12 * 60 * 60 * 1000).toISOString() // 12 hours ago
            const recentTime = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
            const staleTime = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString() // 15 days ago
            const inactiveTime = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString() // 40 days ago

            const mockDb = {
                searchEntries: vi.fn().mockImplementation((query, options) => {
                    if (options.projectNumber === 1) return { entries: [{ id: 1, timestamp: activeTime, entryType: 'note', content: 'test' }] }
                    if (options.projectNumber === 2) return { entries: [{ id: 2, timestamp: recentTime, entryType: 'note', content: 'test' }] }
                    if (options.projectNumber === 3) return { entries: [{ id: 3, timestamp: staleTime, entryType: 'note', content: 'test' }] }
                    if (options.projectNumber === 4) return { entries: [{ id: 4, timestamp: inactiveTime, entryType: 'note', content: 'test' }] }
                    if (options.projectNumber === 5) return { entries: [] }
                    return { entries: [] }
                })
            }

            const context = {
                db: mockDb,
                briefingConfig: {
                    projectRegistry: {
                        project1: { path: '/path/1', project_number: 1 },
                        project2: { path: '/path/2', project_number: 2 },
                        project3: { path: '/path/3', project_number: 3 },
                        project4: { path: '/path/4', project_number: 4 },
                        project5: { path: '/path/5', project_number: 5 },
                        noNumber: { path: '/path/6' }
                    }
                }
            } as unknown as ResourceContext

            const definitions = getStalenessResourceDefinitions()
            const handler = definitions.find(d => d.uri === 'memory://staleness')!.handler

            const result = handler('memory://staleness', context) as any
            const data = result.data.projects

            expect(data.active).toHaveLength(1)
            expect(data.active[0].project_number).toBe(1)
            
            expect(data.recent).toHaveLength(1)
            expect(data.recent[0].project_number).toBe(2)

            expect(data.stale).toHaveLength(1)
            expect(data.stale[0].project_number).toBe(3)

            expect(data.inactive).toHaveLength(2)
            const inactiveIds = data.inactive.map((p: any) => p.project_number)
            expect(inactiveIds).toContain(4)
            expect(inactiveIds).toContain(5)
        })
    })

    describe('memory://staleness/{project_number}', () => {
        it('should return detailed breakdown for a single project', () => {
            const now = new Date()
            const activeTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()

            const mockDb = {
                searchEntries: vi.fn().mockReturnValue({
                    entries: [
                        { id: 10, timestamp: activeTime, entryType: 'milestone', content: 'some milestone content' },
                        { id: 9, timestamp: activeTime, entryType: 'note', content: 'some note content' }
                    ]
                }),
                getSearchFacets: vi.fn().mockReturnValue({
                    tags: [{ name: 'frontend', count: 3 }],
                    entryTypes: [{ name: 'milestone', count: 1 }, { name: 'note', count: 1 }]
                }),
                searchByDateRange: vi.fn().mockReturnValue({
                    entries: [1, 2, 3] // mock 3 entries in last 7 days
                })
            }

            const context = {
                db: mockDb
            } as unknown as ResourceContext

            const definitions = getStalenessResourceDefinitions()
            const handler = definitions.find(d => d.uri === 'memory://staleness/{project_number}')!.handler

            const result = handler('memory://staleness/123', context) as any
            const data = result.data

            expect(data.project_number).toBe(123)
            expect(data.status).toBe('active')
            expect(data.last_5_entries).toHaveLength(2)
            expect(data.tag_breakdown).toEqual({ frontend: 3 })
            expect(data.type_breakdown).toEqual({ milestone: 1, note: 1 })
            expect(data.weekly_trend.new_entries_last_7_days).toBe(3)
        })

        it('should handle invalid project number', () => {
            const context = {} as unknown as ResourceContext
            const definitions = getStalenessResourceDefinitions()
            const handler = definitions.find(d => d.uri === 'memory://staleness/{project_number}')!.handler

            const result = handler('memory://staleness/abc', context) as any
            expect(result.data.error).toBe('Project number must be a valid integer')
        })
    })
})
