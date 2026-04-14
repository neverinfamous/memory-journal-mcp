import { describe, it, expect, vi } from 'vitest'
import {
    digestInsightsResource,
    teamCollaborationResource,
} from '../../src/handlers/resources/insights.js'
import type { ResourceContext } from '../../src/handlers/resources/shared.js'

describe('Insights Resources', () => {
    describe('memory://insights/digest', () => {
        it('should return scheduler digest if available', () => {
            const context: ResourceContext = {
                scheduler: {
                    getLatestDigest: vi.fn().mockReturnValue({ scheduled: true }),
                } as any,
            }
            const result = digestInsightsResource.handler('memory://insights/digest', context)
            expect(result.data.success).toBe(true)
            expect((result.data as any).snapshot).toEqual({ scheduled: true })
        })

        it('should return db digest if scheduler not available but DB snapshot exists', () => {
            const context: ResourceContext = {
                scheduler: {},
                db: {
                    getLatestAnalyticsSnapshot: vi.fn().mockReturnValue({
                        data: { db_snapshot: true },
                        createdAt: '2026-04-11T12:00:00Z',
                    }),
                } as any,
            }
            const result = digestInsightsResource.handler('memory://insights/digest', context)
            expect(result.data.success).toBe(true)
            expect((result.data as any).snapshot).toEqual({ db_snapshot: true })
            expect((result.data as any).source).toBe('persisted')
            expect(result.annotations?.lastModified).toBe('2026-04-11T12:00:00Z')
        })

        it('should return no digest available if neither scheduler nor db has one', () => {
            const context: ResourceContext = {
                scheduler: {},
                db: {
                    getLatestAnalyticsSnapshot: vi.fn().mockReturnValue(null),
                } as any,
            }
            const result = digestInsightsResource.handler('memory://insights/digest', context)
            expect(result.data.success).toBe(true)
            expect((result.data as any).snapshot).toBeNull()
            expect((result.data as any).message).toContain('No digest available')
        })
    })

    describe('memory://insights/team-collaboration', () => {
        it('should return not configured if no teamDb', () => {
            const context: ResourceContext = {}
            const result = teamCollaborationResource.handler(
                'memory://insights/team-collaboration',
                context
            )
            expect(result.data.success).toBe(true)
            expect((result.data as any).matrix).toBeNull()
        })

        it('should return matrix if teamDb provides it', () => {
            // Mocking the queryRow / queryRows indirectly via teamDb interface
            // The computeTeamCollaborationMatrix uses execQuery, which calls `teamDb.getRawDb()`
            const teamDb = {
                _executeRawQueryUnsafe: vi
                    .fn()
                    .mockReturnValueOnce([{ author: 'Alice', period: '2026-04', entry_count: 5 }]) // Activity
                    .mockReturnValueOnce([
                        { from_author: 'Alice', to_author: 'Bob', link_count: 2 },
                    ]) // Cross links
                    .mockReturnValueOnce([{ author: 'Bob', inbound_links: 2 }]) // Impact
                    .mockReturnValueOnce([{ total_authors: 2, total_entries: 10 }]), // Totals
            }
            const context: ResourceContext = { teamDb: teamDb as any }
            const result = teamCollaborationResource.handler(
                'memory://insights/team-collaboration',
                context
            )
            expect(result.data.success).toBe(true)
            expect((result.data as any).matrix.authorActivity).toBeDefined()
            expect((result.data as any).matrix.crossAuthorLinks).toBeDefined()
            expect((result.data as any).matrix.impactFactor).toBeDefined()
        })

        it('should handle errors from computation', () => {
            const teamDb = {
                _executeRawQueryUnsafe: vi.fn().mockImplementation(() => {
                    throw new Error('Database connection failed')
                }),
            }
            const context: ResourceContext = { teamDb: teamDb as any }
            const result = teamCollaborationResource.handler(
                'memory://insights/team-collaboration',
                context
            )
            expect(result.data.success).toBe(false)
            expect((result.data as any).error).toBe('Database connection failed')
        })
    })
})
